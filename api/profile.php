<?php
if (session_status() === PHP_SESSION_NONE) session_start();
require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');

function out($ok, $data = [], $code = 200) {
    http_response_code($code);
    echo json_encode(['ok' => $ok] + $data);
    exit;
}

function current_user() {
    return $_SESSION['user'] ?? null;
}

function is_super_admin($u) {
    return (($u['role'] ?? '') === 'super_admin');
}

function is_barangay_admin($u) {
    return (($u['role'] ?? '') === 'admin');
}

function is_administrative_user($u) {
    return in_array(
        ($u['role'] ?? ''),
        ['admin', 'super_admin'],
        true
    );
}

function require_login() {
    $u = current_user();

    if (!$u) {
        out(false, ['error' => 'Not logged in.'], 401);
    }

    return $u;
}

function require_admin() {
    $u = require_login();

    if (!is_administrative_user($u)) {
        out(false, ['error' => 'Administrators only.'], 403);
    }

    if (
        is_barangay_admin($u) &&
        (
            !isset($u['barangay_id']) ||
            $u['barangay_id'] === null ||
            (int)$u['barangay_id'] <= 0
        )
    ) {
        out(false, ['error' => 'Administrator barangay is not configured.'], 403);
    }

    return $u;
}

function log_activity($db, $action, $detail = '') {
    $u    = current_user();
    $uid  = $u['id']          ?? null;
    $un   = $u['name']        ?? null;
    $bid  = $u['barangay_id'] ?? null;
    $ip   = $_SERVER['REMOTE_ADDR'] ?? null;
    $stmt = $db->prepare(
        'INSERT INTO activity_log (user_id, user_name, barangay_id, action, detail, ip_address)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->bind_param('isisss', $uid, $un, $bid, $action, $detail, $ip);
    $stmt->execute();
    $stmt->close();
}

$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? ($input['action'] ?? '');
$db     = getDB();

switch ($action) {

case 'get_profile':
    $u = require_login();
    $stmt = $db->prepare(
        'SELECT id, username, full_name, email, phone, address, role,
                last_login, login_count, profile_completed, created_at
           FROM users WHERE id = ? LIMIT 1'
    );
    $stmt->bind_param('i', $u['id']);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row) out(false, ['error' => 'User not found.'], 404);
    out(true, ['profile' => $row]);

case 'update_profile':
    $u       = require_login();
    $name    = trim($input['full_name'] ?? '');
    $email   = trim($input['email']     ?? '');
    $phone   = trim($input['phone']     ?? '');
    $address = trim($input['address']   ?? '');
    $newpw   = $input['password']        ?? '';
    if ($name === '' || $email === '') out(false, ['error' => 'Name and email are required.'], 422);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) out(false, ['error' => 'Invalid email address.'], 422);
    $chk = $db->prepare('SELECT id FROM users WHERE email = ? AND id <> ?');
    $chk->bind_param('si', $email, $u['id']);
    $chk->execute(); $chk->store_result();
    if ($chk->num_rows > 0) { $chk->close(); out(false, ['error' => 'Email already in use.'], 409); }
    $chk->close();
    $pcCheck = $db->prepare('SELECT password_hash, profile_completed FROM users WHERE id = ? LIMIT 1');
    $pcCheck->bind_param('i', $u['id']);
    $pcCheck->execute();
    $pcRow = $pcCheck->get_result()->fetch_assoc();
    $pcCheck->close();
    $alreadySetup = $pcRow && (int)$pcRow['profile_completed'] === 1;
    if ($alreadySetup) {
        $current = $input['current_password'] ?? '';
        if ($current === '') out(false, ['error' => 'Enter your current password to save changes.'], 422);
        if (!password_verify($current, $pcRow['password_hash']))
            out(false, ['error' => 'Current password is incorrect.'], 401);
    }
    if ($newpw !== '') {
        $pwError = password_strength_error($newpw);
        if ($pwError) out(false, ['error' => $pwError], 422);
        $hash = password_hash($newpw, PASSWORD_DEFAULT);
        $stmt = $db->prepare('UPDATE users SET full_name=?, email=?, phone=?, address=?, password_hash=?, profile_completed=1 WHERE id=?');
        $stmt->bind_param('sssssi', $name, $email, $phone, $address, $hash, $u['id']);
    } else {
        $stmt = $db->prepare('UPDATE users SET full_name=?, email=?, phone=?, address=?, profile_completed=1 WHERE id=?');
        $stmt->bind_param('ssssi', $name, $email, $phone, $address, $u['id']);
    }
    $ok = $stmt->execute(); $stmt->close();
    if (!$ok) out(false, ['error' => 'Update failed.'], 500);
    $_SESSION['user']['name'] = $name;
    // action = 'profile_updated' — appears in Activity Log only
    log_activity($db, 'profile_updated', 'Updated own profile');
    out(true, ['message' => 'Profile saved.', 'name' => $name]);

case 'list_users':
    $admin = require_admin();

    if (is_super_admin($admin)) {
        $stmt = $db->prepare(
            'SELECT id, username, full_name, email, phone, role,
                    status, last_login, login_count, barangay_id
               FROM users
              ORDER BY role, full_name'
        );
    } else {
        $bid = (int)$admin['barangay_id'];

        $stmt = $db->prepare(
            'SELECT id, username, full_name, email, phone, role,
                    status, last_login, login_count, barangay_id
               FROM users
              WHERE barangay_id = ?
              ORDER BY role, full_name'
        );
        $stmt->bind_param('i', $bid);
    }

    $stmt->execute();

    $res  = $stmt->get_result();
    $list = [];

    while ($r = $res->fetch_assoc()) {
        $list[] = $r;
    }

    $stmt->close();

    out(true, ['users' => $list]);

case 'create_user':
    $admin = require_admin();
    $name  = trim($input['full_name'] ?? '');
    $email = trim($input['email']     ?? '');
    $uname = trim($input['username']  ?? '');
    $role  = trim($input['role']      ?? 'staff');
    $pw    = $input['password']        ?? '';
    if (is_super_admin($admin)) {
    $allowedRoles = ['admin', 'staff', 'viewer', 'resident'];
    } else {
        $allowedRoles = ['admin', 'staff', 'viewer', 'resident'];
    }

    if ($role === 'super_admin') {
        out(false, [
            'error' => 'Super Admin accounts cannot be created through this action.'
        ], 403);
    }

    if (!in_array($role, $allowedRoles, true)) {
        $role = 'staff';
    }
    if ($name===''||$email===''||$uname==='')
        out(false, ['error' => 'All fields are required.'], 422);
    $pwError = password_strength_error($pw);
    if ($pwError) out(false, ['error' => $pwError], 422);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) out(false, ['error' => 'Invalid email.'], 422);
    $chk = $db->prepare('SELECT id FROM users WHERE email = ? OR username = ?');
    $chk->bind_param('ss', $email, $uname);
    $chk->execute(); $chk->store_result();
    if ($chk->num_rows > 0) { $chk->close(); out(false, ['error' => 'Username or email already exists.'], 409); }
    $chk->close();
    $hash = password_hash($pw, PASSWORD_DEFAULT);
    if (is_super_admin($admin)) {
    $bid = (int)($input['barangay_id'] ?? 0);

    if ($bid <= 0) {
        out(false, [
            'error' => 'A barangay must be selected for this user.'
        ], 422);
    }

    $barangayCheck = $db->prepare(
        'SELECT id FROM barangays WHERE id = ? LIMIT 1'
    );
    $barangayCheck->bind_param('i', $bid);
    $barangayCheck->execute();
    $barangayExists = $barangayCheck->get_result()->fetch_assoc();
    $barangayCheck->close();

    if (!$barangayExists) {
        out(false, [
            'error' => 'Selected barangay does not exist.'
        ], 422);
    }
    } else {
        $bid = (int)$admin['barangay_id'];
    }
    $stmt = $db->prepare('INSERT INTO users (username, full_name, email, password_hash, role, barangay_id, status, profile_completed) VALUES (?, ?, ?, ?, ?, ?, "active", 0)');
    $stmt->bind_param('sssssi', $uname, $name, $email, $hash, $role, $bid);
    $ok = $stmt->execute(); $stmt->close();
    if (!$ok) out(false, ['error' => 'Could not create user.'], 500);
    // action = 'user_created' — Activity Log only
    log_activity($db, 'user_created', "Created user: $name ($role)");
    out(true, ['message' => 'User created.']);

case 'update_user':
    $admin  = require_admin();
    $id     = (int)($input['id']    ?? 0);
    $role   = trim($input['role']   ?? '');
    $status = trim($input['status'] ?? '');

    if ($id <= 0) {
        out(false, ['error' => 'Missing user id.'], 422);
    }

    $targetStmt = $db->prepare(
        'SELECT id, role, barangay_id
           FROM users
          WHERE id = ?
          LIMIT 1'
    );
    $targetStmt->bind_param('i', $id);
    $targetStmt->execute();
    $target = $targetStmt->get_result()->fetch_assoc();
    $targetStmt->close();

    if (!$target) {
        out(false, ['error' => 'User not found.'], 404);
    }

    $targetBarangayId = $target['barangay_id'] === null
        ? null
        : (int)$target['barangay_id'];

    /*
     * Barangay Admin can modify only users from their own barangay.
     */
    if (!is_super_admin($admin)) {
        if ($targetBarangayId !== (int)$admin['barangay_id']) {
            out(false, [
                'error' => 'You cannot manage users from another barangay.'
            ], 403);
        }
    }

    /*
     * Super Admin role is protected.
     * This ordinary endpoint cannot create, assign,
     * remove, disable, or otherwise modify a Super Admin account.
     */
    if (($target['role'] ?? '') === 'super_admin') {
        out(false, [
            'error' => 'Super Admin accounts require secure verification.'
        ], 403);
    }

    if ($role === 'super_admin') {
        out(false, [
            'error' => 'Super Admin promotion requires secure verification.'
        ], 403);
    }

    if (
        $id === (int)$admin['id'] &&
        $role !== '' &&
        $role !== ($admin['role'] ?? '')
    ) {
        out(false, [
            'error' => "You can't remove your own administrative role."
        ], 422);
    }

    $allowedRoles = ['admin', 'staff', 'viewer', 'resident'];
    $allowedStatus = ['active', 'disabled', 'pending'];

    if ($role !== '' && !in_array($role, $allowedRoles, true)) {
        out(false, ['error' => 'Bad role.'], 422);
    }

    if ($status !== '' && !in_array($status, $allowedStatus, true)) {
        out(false, ['error' => 'Bad status.'], 422);
    }

    $stmt = $db->prepare(
        'UPDATE users
            SET role = COALESCE(NULLIF(?, ""), role),
                status = COALESCE(NULLIF(?, ""), status)
          WHERE id = ?'
    );
    $stmt->bind_param('ssi', $role, $status, $id);

    $ok = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();

    if (!$ok) {
        out(false, ['error' => 'Update failed.'], 500);
    }

    log_activity(
        $db,
        'user_updated',
        "Updated user #$id (role=$role, status=$status)"
    );

    out(true, [
        'message' => 'User updated.',
        'changed' => $affected > 0
    ]);

/* ── ACTIVITY LOG — user actions only (login, user mgmt, profile) ── */
case 'activity_log':
    $admin = require_admin();
    $limit = min(200, max(1, (int)($_GET['limit'] ?? 50)));

    // User/account-related actions
    $userActions = [
        'login',
        'logout',
        'profile_updated',
        'user_created',
        'user_updated',
        'user_disabled',
        'user_enabled'
    ];

    $placeholders = implode(
        ',',
        array_fill(0, count($userActions), '?')
    );

    if (is_super_admin($admin)) {

        /*
         * Super Admin:
         * activity from every barangay and system-level activity.
         */
        $stmt = $db->prepare(
            "SELECT user_name,
                    barangay_id,
                    action,
                    detail,
                    ip_address,
                    created_at
               FROM activity_log
              WHERE action IN ($placeholders)
              ORDER BY created_at DESC
              LIMIT ?"
        );

        $types  = str_repeat('s', count($userActions)) . 'i';
        $params = array_merge($userActions, [$limit]);

        $stmt->bind_param($types, ...$params);

    } else {

        /*
         * Barangay Admin:
         * own barangay + system-wide NULL entries only.
         */
        $bid = (int)$admin['barangay_id'];

        $stmt = $db->prepare(
            "SELECT user_name,
                    barangay_id,
                    action,
                    detail,
                    ip_address,
                    created_at
               FROM activity_log
              WHERE (barangay_id = ? OR barangay_id IS NULL)
                AND action IN ($placeholders)
              ORDER BY created_at DESC
              LIMIT ?"
        );

        $types  = 'i' . str_repeat('s', count($userActions)) . 'i';
        $params = array_merge([$bid], $userActions, [$limit]);

        $stmt->bind_param($types, ...$params);
    }

    $stmt->execute();

    $res = $stmt->get_result();
    $log = [];

    while ($r = $res->fetch_assoc()) {
        $log[] = $r;
    }

    $stmt->close();

    out(true, ['log' => $log]);

/* ── STAFF STATS ── */
case 'staff_stats':
    $admin = require_admin();

    /*
     * Load resolved/closed activity.
     */
    if (is_super_admin($admin)) {

        $stmt = $db->prepare(
            "SELECT user_id,
                    user_name,
                    barangay_id,
                    action,
                    detail
               FROM activity_log
              WHERE action IN ('complaint_resolved','complaint_closed')"
        );

    } else {

        $bid = (int)$admin['barangay_id'];

        $stmt = $db->prepare(
            "SELECT user_id,
                    user_name,
                    barangay_id,
                    action,
                    detail
               FROM activity_log
              WHERE barangay_id = ?
                AND action IN ('complaint_resolved','complaint_closed')"
        );

        $stmt->bind_param('i', $bid);
    }

    $stmt->execute();

    $res    = $stmt->get_result();
    $byUser = [];

    while ($r = $res->fetch_assoc()) {

        /*
         * Use database user ID whenever available.
         * This prevents users with identical names in
         * different barangays from being merged together.
         */
        if (!empty($r['user_id'])) {
            $key = 'id:' . (int)$r['user_id'];
        } else {
            $key = 'name:' .
                (string)($r['barangay_id'] ?? 'null') .
                ':' .
                (string)($r['user_name'] ?? 'Unknown');
        }

        if (!isset($byUser[$key])) {
            $byUser[$key] = [
                'user_id'     => $r['user_id'] ?? null,
                'full_name'   => $r['user_name'] ?: 'Unknown',
                'barangay_id' => $r['barangay_id'] === null
                    ? null
                    : (int)$r['barangay_id'],
                'role'        => 'admin',
                'resolved'    => 0,
                'closed'      => 0,
                'cats'        => []
            ];
        }

        if ($r['action'] === 'complaint_resolved') {
            $byUser[$key]['resolved']++;
        } elseif ($r['action'] === 'complaint_closed') {
            $byUser[$key]['closed']++;
        }

        if (
            preg_match(
                '/\[cat:([^\]]*)\]/',
                $r['detail'] ?? '',
                $m
            )
        ) {
            $cat = trim($m[1]);

            if ($cat !== '') {
                $byUser[$key]['cats'][$cat] =
                    ($byUser[$key]['cats'][$cat] ?? 0) + 1;
            }
        }
    }

    $stmt->close();


    /*
     * Load the actual Admin/Staff accounts.
     */
    if (is_super_admin($admin)) {

        $u = $db->prepare(
            "SELECT id,
                    full_name,
                    role,
                    barangay_id
               FROM users
              WHERE role IN ('admin','staff')"
        );

    } else {

        $bid = (int)$admin['barangay_id'];

        $u = $db->prepare(
            "SELECT id,
                    full_name,
                    role,
                    barangay_id
               FROM users
              WHERE barangay_id = ?
                AND role IN ('admin','staff')"
        );

        $u->bind_param('i', $bid);
    }

    $u->execute();

    $ur = $u->get_result();

    while ($row = $ur->fetch_assoc()) {

        $key = 'id:' . (int)$row['id'];

        if (!isset($byUser[$key])) {
            $byUser[$key] = [
                'user_id'     => (int)$row['id'],
                'full_name'   => $row['full_name'],
                'barangay_id' => $row['barangay_id'] === null
                    ? null
                    : (int)$row['barangay_id'],
                'role'        => $row['role'],
                'resolved'    => 0,
                'closed'      => 0,
                'cats'        => []
            ];
        } else {
            $byUser[$key]['full_name']   = $row['full_name'];
            $byUser[$key]['role']        = $row['role'];
            $byUser[$key]['barangay_id'] = $row['barangay_id'] === null
                ? null
                : (int)$row['barangay_id'];
        }
    }

    $u->close();


    /*
     * Format for the existing frontend.
     */
    $stats = [];

    foreach ($byUser as $d) {

        arsort($d['cats']);

        $parts = [];

        foreach ($d['cats'] as $cat => $n) {
            $parts[] = $n . '× ' . $cat;
        }

        $stats[] = [
            'user_id'     => $d['user_id'],
            'full_name'   => $d['full_name'],
            'barangay_id' => $d['barangay_id'],
            'role'        => $d['role'],
            'resolved'    => $d['resolved'],
            'closed'      => $d['closed'],
            'handled'     => $d['resolved'] + $d['closed'],
            'cats'        => implode(', ', $parts)
        ];
    }

    usort(
        $stats,
        fn($a, $b) => $b['handled'] - $a['handled']
    );

    out(true, ['stats' => $stats]);

default:
    out(false, ['error' => 'Unknown action.'], 400);
}