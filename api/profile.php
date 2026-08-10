<?php
if (session_status() === PHP_SESSION_NONE) session_start();
require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');

function out($ok, $data = [], $code = 200) {
    http_response_code($code);
    echo json_encode(['ok' => $ok] + $data);
    exit;
}

function current_user() { return $_SESSION['user'] ?? null; }
function require_login() {
    $u = current_user();
    if (!$u) out(false, ['error' => 'Not logged in.'], 401);
    return $u;
}
function require_admin() {
    $u = require_login();
    if (($u['role'] ?? '') !== 'admin') out(false, ['error' => 'Admins only.'], 403);
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
    $bid   = (int)$admin['barangay_id'];
    $stmt  = $db->prepare('SELECT id, username, full_name, email, phone, role, status, last_login, login_count FROM users WHERE barangay_id = ? ORDER BY role, full_name');
    $stmt->bind_param('i', $bid);
    $stmt->execute();
    $res = $stmt->get_result(); $list = [];
    while ($r = $res->fetch_assoc()) $list[] = $r;
    $stmt->close();
    out(true, ['users' => $list]);

case 'create_user':
    $admin = require_admin();
    $name  = trim($input['full_name'] ?? '');
    $email = trim($input['email']     ?? '');
    $uname = trim($input['username']  ?? '');
    $role  = trim($input['role']      ?? 'staff');
    $pw    = $input['password']        ?? '';
    $allowedRoles = ['admin','staff','viewer'];
    if (!in_array($role, $allowedRoles, true)) $role = 'staff';
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
    $bid  = (int)$admin['barangay_id'];
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
    if ($id <= 0) out(false, ['error' => 'Missing user id.'], 422);
    if ($id === (int)$admin['id'] && $role && $role !== 'admin')
        out(false, ['error' => "You can't remove your own admin role."], 422);
    $allowedRoles  = ['admin','staff','viewer'];
    $allowedStatus = ['active','disabled','pending'];
    if ($role   && !in_array($role,   $allowedRoles,  true)) out(false, ['error' => 'Bad role.'], 422);
    if ($status && !in_array($status, $allowedStatus, true)) out(false, ['error' => 'Bad status.'], 422);
    $bid  = (int)$admin['barangay_id'];
    $stmt = $db->prepare('UPDATE users SET role=COALESCE(NULLIF(?,""),role), status=COALESCE(NULLIF(?,""),status) WHERE id=? AND barangay_id=?');
    $stmt->bind_param('ssii', $role, $status, $id, $bid);
    $ok = $stmt->execute(); $stmt->close();
    if (!$ok) out(false, ['error' => 'Update failed.'], 500);
    // action = 'user_updated' — Activity Log only
    log_activity($db, 'user_updated', "Updated user #$id (role=$role, status=$status)");
    out(true, ['message' => 'User updated.']);

/* ── ACTIVITY LOG — user actions only (login, user mgmt, profile) ── */
case 'activity_log':
    $admin = require_admin();
    $bid   = (int)$admin['barangay_id'];
    $limit = min(200, max(1, (int)($_GET['limit'] ?? 50)));
    // Only user-related actions — NOT settings saves, NOT complaint events
    $userActions  = ['login','logout','profile_updated','user_created','user_updated','user_disabled','user_enabled'];
    $placeholders = implode(',', array_fill(0, count($userActions), '?'));
    $stmt = $db->prepare(
        "SELECT user_name, action, detail, ip_address, created_at
           FROM activity_log
          WHERE (barangay_id = ? OR barangay_id IS NULL)
            AND action IN ($placeholders)
          ORDER BY created_at DESC
          LIMIT ?"
    );
    $types  = 'i' . str_repeat('s', count($userActions)) . 'i';
    $params = array_merge([$bid], $userActions, [$limit]);
    $stmt->bind_param($types, ...$params);
    $stmt->execute();
    $res = $stmt->get_result(); $log = [];
    while ($r = $res->fetch_assoc()) $log[] = $r;
    $stmt->close();
    out(true, ['log' => $log]);

/* ── STAFF STATS ── */
case 'staff_stats':
    $admin = require_admin();
    $bid   = (int)$admin['barangay_id'];
    $stmt  = $db->prepare(
        "SELECT user_name, action, detail
           FROM activity_log
          WHERE barangay_id = ?
            AND action IN ('complaint_resolved','complaint_closed')"
    );
    $stmt->bind_param('i', $bid);
    $stmt->execute();
    $res = $stmt->get_result(); $byUser = [];
    while ($r = $res->fetch_assoc()) {
        $name = $r['user_name'] ?: 'Unknown';
        if (!isset($byUser[$name])) $byUser[$name] = ['resolved'=>0,'closed'=>0,'cats'=>[]];
        if ($r['action'] === 'complaint_resolved') $byUser[$name]['resolved']++;
        else                                        $byUser[$name]['closed']++;
        if (preg_match('/\[cat:([^\]]*)\]/', $r['detail']??'', $m)) {
            $cat = trim($m[1]);
            if ($cat !== '') $byUser[$name]['cats'][$cat] = ($byUser[$name]['cats'][$cat] ?? 0) + 1;
        }
    }
    $stmt->close();
    $u = $db->prepare("SELECT full_name, role FROM users WHERE barangay_id=? AND role IN ('admin','staff')");
    $u->bind_param('i', $bid); $u->execute();
    $ur = $u->get_result(); $roleOf = [];
    while ($row = $ur->fetch_assoc()) {
        $roleOf[$row['full_name']] = $row['role'];
        if (!isset($byUser[$row['full_name']])) $byUser[$row['full_name']] = ['resolved'=>0,'closed'=>0,'cats'=>[]];
    }
    $u->close();
    $stats = [];
    foreach ($byUser as $name => $d) {
        arsort($d['cats']); $parts = [];
        foreach ($d['cats'] as $cat => $n) $parts[] = $n . '× ' . $cat;
        $stats[] = [
            'full_name' => $name,
            'role'      => $roleOf[$name] ?? 'admin',
            'resolved'  => $d['resolved'],
            'closed'    => $d['closed'],
            'handled'   => $d['resolved'] + $d['closed'],
            'cats'      => implode(', ', $parts),
        ];
    }
    usort($stats, fn($a,$b) => $b['handled'] - $a['handled']);
    out(true, ['stats' => $stats]);

default:
    out(false, ['error' => 'Unknown action.'], 400);
}