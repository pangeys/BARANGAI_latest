<?php
error_reporting(0);
ini_set('display_errors', 0);

if (session_status() === PHP_SESSION_NONE) session_start();

require_once __DIR__ . '/api/config.php';

header("Content-Type: application/json; charset=utf-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function isSuperAdmin($user) {
    return (($user['role'] ?? '') === 'super_admin');
}

function isBarangayAdmin($user) {
    return (($user['role'] ?? '') === 'admin');
}

function isAdministrativeUser($user) {
    return in_array(
        ($user['role'] ?? ''),
        ['admin', 'super_admin'],
        true
    );
}

function logActivity($conn, $userId, $userName, $barangayId, $action, $detail) {
    $ip   = $_SERVER['REMOTE_ADDR'] ?? '';
    $stmt = $conn->prepare(
        "INSERT INTO activity_log (user_id, user_name, barangay_id, action, detail, ip_address)
         VALUES (?, ?, ?, ?, ?, ?)"
    );
    $stmt->bind_param('isisss', $userId, $userName, $barangayId, $action, $detail, $ip);
    $stmt->execute();
    $stmt->close();
}

$sessionUser = $_SESSION['user'] ?? null;

/*
 * SECURITY GATE:
 * This root api.php powers the administrator dashboard only.
 * Password verification + successful 2FA must already have created
 * $_SESSION['user'] before any dashboard data can be read or modified.
 */
if (!$sessionUser || empty($sessionUser['id'])) {
    respond(['error' => 'Authentication required'], 401);
}

if (!isAdministrativeUser($sessionUser)) {
    respond(['error' => 'Administrator access required'], 403);
}

$isSuperAdmin = isSuperAdmin($sessionUser);

$barangay_id = $sessionUser['barangay_id'] === null
    ? null
    : (int)$sessionUser['barangay_id'];

$userId   = (int)$sessionUser['id'];
$userName = $sessionUser['name'] ?? 'Unknown';

if (isBarangayAdmin($sessionUser) && ($barangay_id === null || $barangay_id <= 0)) {
    respond(['error' => 'Administrator barangay is not configured'], 403);
}

/* Connect only after authentication/authorization succeeds. */
$conn = getDB();

$method = $_SERVER['REQUEST_METHOD'];
$type   = $_GET['type'] ?? '';
$body   = json_decode(file_get_contents("php://input"), true) ?? [];
$action = $body['action'] ?? '';

/* ════════════════════════════════════════════════════
   SUPER ADMIN — BARANGAY MANAGEMENT
════════════════════════════════════════════════════ */


/*
 * GET ?type=barangays
 *
 * Super Admin only.
 * Returns all barangays for the global context switcher
 * and Barangays management module.
 */
if ($method === 'GET' && $type === 'barangays') {

    if (!$isSuperAdmin) {
        respond([
            'ok' => false,
            'error' => 'Super Administrator access required'
        ], 403);
    }

    $result = $conn->query(
        "SELECT
            id,
            name,
            municipality,
            admin_email,
            status
         FROM barangays
         ORDER BY name ASC"
    );

    if (!$result) {
        respond([
            'ok' => false,
            'error' => 'Could not load barangays'
        ], 500);
    }

    $barangays = [];

    while ($row = $result->fetch_assoc()) {
        $barangays[] = [
            'id'           => (int)$row['id'],
            'name'         => (string)$row['name'],
            'municipality' => (string)($row['municipality'] ?? ''),
            'admin_email'  => (string)($row['admin_email'] ?? ''),
            'status'       => (string)($row['status'] ?? 'Active'),
        ];
    }

    respond([
        'ok' => true,
        'barangays' => $barangays
    ]);
}


/*
 * PUT action=update_barangay_status
 *
 * Super Admin only.
 *
 * Allowed lifecycle values:
 * Active
 * Inactive
 * Suspended
 */
if ($method === 'PUT' && $action === 'update_barangay_status') {

    if (!$isSuperAdmin) {
        respond([
            'ok' => false,
            'error' => 'Super Administrator access required'
        ], 403);
    }

    $targetBarangayId = (int)($body['barangay_id'] ?? 0);
    $status = trim((string)($body['status'] ?? ''));

    if ($targetBarangayId <= 0) {
        respond([
            'ok' => false,
            'error' => 'barangay_id is required'
        ], 422);
    }

    $allowedStatuses = [
        'Active',
        'Inactive',
        'Suspended'
    ];

    if (!in_array($status, $allowedStatuses, true)) {
        respond([
            'ok' => false,
            'error' => 'Invalid barangay status'
        ], 422);
    }

    /*
     * Load the barangay first so:
     * 1. nonexistent IDs cannot be updated;
     * 2. the audit log contains the real DB name.
     */
    $check = $conn->prepare(
        "SELECT id, name, status
         FROM barangays
         WHERE id = ?
         LIMIT 1"
    );
    $check->bind_param('i', $targetBarangayId);
    $check->execute();

    $barangay = $check
        ->get_result()
        ->fetch_assoc();

    $check->close();

    if (!$barangay) {
        respond([
            'ok' => false,
            'error' => 'Barangay not found'
        ], 404);
    }

    $oldStatus = (string)($barangay['status'] ?? 'Active');
    $barangayName = (string)$barangay['name'];

    /*
     * No database write is needed when nothing changed.
     */
    if ($oldStatus === $status) {
        respond([
            'ok' => true,
            'changed' => false,
            'barangay_id' => $targetBarangayId,
            'status' => $status
        ]);
    }

    $stmt = $conn->prepare(
        "UPDATE barangays
         SET status = ?
         WHERE id = ?"
    );
    $stmt->bind_param(
        'si',
        $status,
        $targetBarangayId
    );

    $ok = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();

    if (!$ok || $affected !== 1) {
        respond([
            'ok' => false,
            'error' => 'Could not update barangay status'
        ], 500);
    }

    /*
     * Attribute this system-level modification to the
     * barangay that was changed.
     */
    logActivity(
        $conn,
        $userId,
        $userName,
        $targetBarangayId,
        'barangay_updated',
        "Barangay '$barangayName' status changed from '$oldStatus' to '$status'"
    );

    respond([
        'ok' => true,
        'changed' => true,
        'barangay_id' => $targetBarangayId,
        'status' => $status
    ]);
}

if ($method === 'GET' && $type === 'init') {
    $complaints = [];
    if ($barangay_id !== null && $barangay_id > 0) {
    $stmt = $conn->prepare("SELECT * FROM complaints WHERE barangay_id = ? ORDER BY created_at DESC");
    $stmt->bind_param('i', $barangay_id);
    $stmt->execute();
    $r = $stmt->get_result();
    $stmt->close();
    } elseif ($isSuperAdmin) {
    $r = $conn->query("SELECT * FROM complaints ORDER BY created_at DESC");
    } else {
    respond(['error' => 'Invalid barangay scope'], 403);
    }
    while ($row = $r->fetch_assoc()) {
        $complaints[] = [
            'id'          => $row['complaint_id'],
            'date'        => $row['date_filed'],
            'description' => $row['description'],
            'location'    => $row['location'],
            'time'        => $row['incident_time'],
            'complainant' => $row['complainant'],
            'affected'    => strval($row['affected']),
            'category'    => $row['category'],
            'confidence'  => intval($row['confidence']),
            'score'       => $row['score'],
            'priority'    => $row['priority'],
            'pb'          => $row['priority_badge'],
            'officer'     => $row['officer'],
            'officer_id'  => intval($row['officer_id'] ?? 0),
            'status'      => $row['status'],
            'sb'          => $row['status_badge'],
            'resolvedAt'  => $row['resolved_at'],
            'closeReason' => $row['close_reason'] ?? '',
            'barangay_id' => intval($row['barangay_id']),
        ];
    }
    $notifs = [];
    if ($barangay_id !== null && $barangay_id > 0) {
        $stmt = $conn->prepare(
            "SELECT * FROM notifications
            WHERE barangay_id = ? OR barangay_id IS NULL
            ORDER BY created_at DESC"
        );
        $stmt->bind_param('i', $barangay_id);
        $stmt->execute();
        $r2 = $stmt->get_result();
        $stmt->close();
    } elseif ($isSuperAdmin) {
        $r2 = $conn->query(
            "SELECT * FROM notifications ORDER BY created_at DESC"
        );
    } else {
        respond(['error' => 'Invalid barangay scope'], 403);
    }
    while ($row = $r2->fetch_assoc()) {
        $notifs[] = ['msg'=>$row['msg'],'type'=>$row['type'],'time'=>$row['time'],'isRead'=>intval($row['is_read'] ?? 0)];
    }
    $r3     = $conn->query("SELECT next_id FROM id_counter WHERE id = 1");
    $nextId = intval($r3->fetch_assoc()['next_id'] ?? 1);
    $officersList = [];
    if ($barangay_id !== null && $barangay_id > 0) {
    $stmt = $conn->prepare(
        "SELECT id, name, `rank`, contact, email, status, barangay_id
         FROM officers
         WHERE barangay_id = ?
         ORDER BY name ASC"
    );
    $stmt->bind_param('i', $barangay_id);
    $stmt->execute();
    $ro = $stmt->get_result();
    $stmt->close();
    } elseif ($isSuperAdmin) {
        $ro = $conn->query(
        "SELECT id, name, `rank`, contact, email, status, barangay_id
         FROM officers
         ORDER BY name ASC"
        );
    } else {
        respond(['error' => 'Invalid barangay scope'], 403);
    }
    while ($row = $ro->fetch_assoc()) $officersList[] = $row;
    respond(['complaints'=>$complaints,'notifications'=>$notifs,'nextId'=>$nextId,'officers'=>$officersList]);
}

if ($method === 'GET' && $type === 'officers') {
    $officersList = [];
    if ($barangay_id !== null && $barangay_id > 0) {
        $stmt = $conn->prepare(
            "SELECT id, name, `rank`, contact, email, status, barangay_id
            FROM officers
            WHERE barangay_id = ?
            ORDER BY name ASC"
        );
        $stmt->bind_param('i', $barangay_id);
        $stmt->execute();
        $ro = $stmt->get_result();
        $stmt->close();
    } elseif ($isSuperAdmin) {
        $ro = $conn->query(
            "SELECT id, name, `rank`, contact, email, status, barangay_id
            FROM officers
            ORDER BY name ASC"
    );
    } else {
        respond(['error' => 'Invalid barangay scope'], 403);
    }
    while ($row = $ro->fetch_assoc()) $officersList[] = $row;
    respond(['officers'=>$officersList]);
}

if ($method === 'GET' && $type === 'notes') {
    $complaint_id = trim($_GET['complaint_id'] ?? '');
    if ($complaint_id === '') respond(['error' => 'complaint_id required'], 400);
    if (!$isSuperAdmin) {
        $stmt = $conn->prepare(
            "SELECT n.id, n.complaint_id, n.author, n.author_role, n.content, n.created_at, n.updated_at
             FROM case_notes n INNER JOIN complaints c ON c.complaint_id = n.complaint_id
             WHERE n.complaint_id = ? AND c.barangay_id = ? ORDER BY n.created_at ASC"
        );
        $stmt->bind_param('si', $complaint_id, $barangay_id);
    } else {
        $stmt = $conn->prepare(
            "SELECT id, complaint_id, author, author_role, content, created_at, updated_at
             FROM case_notes WHERE complaint_id = ? ORDER BY created_at ASC"
        );
        $stmt->bind_param('s', $complaint_id);
    }
    $stmt->execute();
    $r = $stmt->get_result();
    $notes = [];
    while ($row = $r->fetch_assoc()) $notes[] = $row;
    $stmt->close();
    respond(['notes' => $notes]);
}

if ($method === 'POST' && $action === 'add_note') {
    $complaint_id = trim((string)($body['complaint_id'] ?? ''));
    $content      = trim((string)($body['content']      ?? ''));
    $author       = trim((string)($body['author']       ?? 'Unknown'));
    $author_role  = trim((string)($body['author_role']  ?? ''));
    if ($isSuperAdmin) {
        $targetStmt = $conn->prepare(
        "SELECT barangay_id
         FROM complaints
         WHERE complaint_id = ?
         LIMIT 1"
        );
            $targetStmt->bind_param('s', $complaint_id);
            $targetStmt->execute();
            $targetRow = $targetStmt->get_result()->fetch_assoc();
            $targetStmt->close();

        if (!$targetRow) {
            respond(['success' => false, 'error' => 'Complaint not found'], 404);
        }

        $bid = $targetRow['barangay_id'] === null
            ? null
            : (int)$targetRow['barangay_id'];
    } else {
        $bid = $barangay_id;
    }
    if ($complaint_id === '' || $content === '') respond(['success' => false, 'error' => 'complaint_id and content are required'], 400);
    $stmt = $conn->prepare("INSERT INTO case_notes (complaint_id, author, author_role, content, barangay_id) VALUES (?, ?, ?, ?, ?)");
    $stmt->bind_param('ssssi', $complaint_id, $author, $author_role, $content, $bid);
    $ok    = $stmt->execute();
    $newId = $conn->insert_id;
    $createdAt = date('Y-m-d H:i:s');
    $stmt->close();
    if ($ok) logActivity($conn, $userId, $userName, $barangay_id, 'note_added', "Note #$newId added to complaint $complaint_id");
    respond(['success'=>(bool)$ok,'id'=>$newId,'created_at'=>$createdAt,'updated_at'=>$createdAt]);
}

if ($method === 'POST' && $action === 'edit_note') {
    $id      = (int)($body['id']      ?? 0);
    $content = trim((string)($body['content'] ?? ''));
    if ($id === 0 || $content === '') respond(['success' => false, 'error' => 'id and content are required'], 400);
    if (!$isSuperAdmin) {
        $stmt = $conn->prepare("UPDATE case_notes n INNER JOIN complaints c ON c.complaint_id = n.complaint_id SET n.content = ? WHERE n.id = ? AND c.barangay_id = ?");
        $stmt->bind_param('sii', $content, $id, $barangay_id);
    } else {
        $stmt = $conn->prepare("UPDATE case_notes SET content = ? WHERE id = ?");
        $stmt->bind_param('si', $content, $id);
    }
    $ok = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();
    if ($ok && $affected > 0) logActivity($conn, $userId, $userName, $barangay_id, 'note_edited', "Note #$id updated");
    respond(['success'=>$ok && $affected > 0,'updated_at'=>date('Y-m-d H:i:s')]);
}

if ($method === 'DELETE' && $action === 'delete_note') {
    $id = (int)($body['id'] ?? 0);
    if ($id === 0) respond(['success' => false, 'error' => 'id required'], 400);
    if (!$isSuperAdmin) {
        $stmt = $conn->prepare("DELETE n FROM case_notes n INNER JOIN complaints c ON c.complaint_id = n.complaint_id WHERE n.id = ? AND c.barangay_id = ?");
        $stmt->bind_param('ii', $id, $barangay_id);
    } else {
        $stmt = $conn->prepare("DELETE FROM case_notes WHERE id = ?");
        $stmt->bind_param('i', $id);
    }
    $ok = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();
    if ($ok && $affected > 0) logActivity($conn, $userId, $userName, $barangay_id, 'note_deleted', "Note #$id deleted");
    respond(['success' => $ok && $affected > 0]);
}

if ($method === 'POST' && $action === 'add_officer') {
    $name    = trim((string)($body['name']    ?? ''));
    $rank    = trim((string)($body['rank']    ?? ''));
    $contact = trim((string)($body['contact'] ?? ''));
    $email   = trim((string)($body['email']   ?? ''));
    $status  = in_array(($body['status'] ?? ''), ['Active', 'Inactive']) ? $body['status'] : 'Active';
    if ($isSuperAdmin) {
        respond([
            'success' => false,
            'error' => 'Super Admin must explicitly select a barangay when adding an officer.'
        ], 422);
    }

    $bid = $barangay_id;
    if ($name === '') respond(['success' => false, 'error' => 'Officer name is required'], 400);
    $stmt = $conn->prepare("INSERT INTO officers (name, `rank`, contact, email, status, barangay_id) VALUES (?, ?, ?, ?, ?, ?)");
    $stmt->bind_param('sssssi', $name, $rank, $contact, $email, $status, $bid);
    $ok    = $stmt->execute();
    $newId = $conn->insert_id;
    $stmt->close();
    if ($ok) logActivity($conn, $userId, $userName, $barangay_id, 'officer_added', "Officer '$name' added (ID: $newId)");
    respond(['success' => (bool)$ok, 'id' => $newId]);
}

if ($method === 'POST' && $action === 'edit_officer') {
    $id      = (int)($body['id']      ?? 0);
    $name    = trim((string)($body['name']    ?? ''));
    $rank    = trim((string)($body['rank']    ?? ''));
    $contact = trim((string)($body['contact'] ?? ''));
    $email   = trim((string)($body['email']   ?? ''));
    $status  = in_array(($body['status'] ?? ''), ['Active', 'Inactive']) ? $body['status'] : 'Active';
    if ($id === 0 || $name === '') respond(['success' => false, 'error' => 'id and name are required'], 400);
    if (!$isSuperAdmin) {
        $stmt = $conn->prepare("UPDATE officers SET name = ?, `rank` = ?, contact = ?, email = ?, status = ? WHERE id = ? AND barangay_id = ?");
        $stmt->bind_param('sssssii', $name, $rank, $contact, $email, $status, $id, $barangay_id);
    } else {
        $stmt = $conn->prepare("UPDATE officers SET name = ?, `rank` = ?, contact = ?, email = ?, status = ? WHERE id = ?");
        $stmt->bind_param('sssssi', $name, $rank, $contact, $email, $status, $id);
    }
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) {
        if (!$isSuperAdmin) {
            $s2 = $conn->prepare("UPDATE complaints SET officer = ? WHERE officer_id = ? AND barangay_id = ?");
            $s2->bind_param('sii', $name, $id, $barangay_id);
        } else {
            $s2 = $conn->prepare("UPDATE complaints SET officer = ? WHERE officer_id = ?");
            $s2->bind_param('si', $name, $id);
        }
        $s2->execute();
        $s2->close();
        logActivity($conn, $userId, $userName, $barangay_id, 'officer_edited', "Officer ID $id updated to '$name'");
    }
    respond(['success' => (bool)$ok]);
}

if ($method === 'DELETE' && $action === 'delete_officer') {
    $id = (int)($body['id'] ?? 0);
    if ($id === 0) respond(['success' => false, 'error' => 'id required'], 400);
    if (!$isSuperAdmin) {
        $stmt = $conn->prepare("DELETE FROM officers WHERE id = ? AND barangay_id = ?");
        $stmt->bind_param('ii', $id, $barangay_id);
    } else {
        $stmt = $conn->prepare("DELETE FROM officers WHERE id = ?");
        $stmt->bind_param('i', $id);
    }
    $ok = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();
    if ($ok && $affected > 0) {
        if (!$isSuperAdmin) {
            $s2 = $conn->prepare("UPDATE complaints SET officer = '—', officer_id = NULL WHERE officer_id = ? AND barangay_id = ?");
            $s2->bind_param('ii', $id, $barangay_id);
        } else {
            $s2 = $conn->prepare("UPDATE complaints SET officer = '—', officer_id = NULL WHERE officer_id = ?");
            $s2->bind_param('i', $id);
        }
        $s2->execute();
        $s2->close();
        logActivity($conn, $userId, $userName, $barangay_id, 'officer_deleted', "Officer ID $id deleted");
    }
    respond(['success' => $ok && $affected > 0]);
}

if ($method === 'POST' && $action === 'add_complaint') {
    $d = $body['data'] ?? [];
    $conn->begin_transaction();
    $conn->query("UPDATE id_counter SET next_id = next_id + 1 WHERE id = 1");
    $r      = $conn->query("SELECT next_id FROM id_counter WHERE id = 1");
    $nextId = intval($r->fetch_assoc()['next_id']);
    $conn->commit();
    $num = $nextId - 1;
    $cid = '#' . str_pad($num, 3, '0', STR_PAD_LEFT);
    $dateFiled = (string)($d['date_filed']  ?? date('M j'));
    $desc      = (string)($d['description'] ?? '');
    $loc       = (string)($d['location']    ?? '');
    $incDate   = (string)($d['date']        ?? '');
    $incTime   = (string)($d['time']        ?? '');
    $comp      = (string)($d['complainant'] ?? 'Anonymous');
    $affected  = (int)($d['affected']       ?? 1);
    $cat       = (string)($d['category']    ?? '');
    $conf      = (int)($d['confidence']     ?? 0);
    $score     = (string)($d['score']       ?? '0');
    $priority  = (string)($d['priority']    ?? 'Low');
    $pb        = (string)($d['pb']          ?? 'b-gray');
    $officer   = (string)($d['officer']     ?? '—');
    $status    = (string)($d['status']      ?? 'Open');
    $sb        = (string)($d['sb']          ?? 'b-gray');
    if ($isSuperAdmin) {
        respond([
            'success' => false,
            'error' => 'Super Admin must explicitly select a barangay when creating a complaint.'
        ], 422);
    }

    $bid = $barangay_id;
    $sql = "INSERT INTO complaints (complaint_id, date_filed, description, location, incident_date, incident_time, complainant, affected, category, confidence, score, priority, priority_badge, officer, status, status_badge, barangay_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    $stmt = $conn->prepare($sql);
    $stmt->bind_param('sssssssisissssssi', $cid, $dateFiled, $desc, $loc, $incDate, $incTime, $comp, $affected, $cat, $conf, $score, $priority, $pb, $officer, $status, $sb, $bid);
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) respond(["success" => true, "id" => $cid]);
    else     respond(["success" => false, "error" => $conn->error], 500);
}

if ($method === 'PUT' && $action === 'assign_officer') {
    $complaintId = trim((string)($body['complaint_id'] ?? ''));
    $officerId   = (int)($body['officer_id'] ?? 0);

    if ($complaintId === '' || $officerId <= 0) {
        respond([
            'success' => false,
            'error'   => 'complaint_id and officer_id are required'
        ], 400);
    }

    /*
     * Load the actual officer record from the database.
     * Do not trust officer_name supplied by the browser.
     */
    $officerStmt = $conn->prepare(
        "SELECT id, name, barangay_id, status
         FROM officers
         WHERE id = ?
         LIMIT 1"
    );
    $officerStmt->bind_param('i', $officerId);
    $officerStmt->execute();
    $officerRow = $officerStmt->get_result()->fetch_assoc();
    $officerStmt->close();

    if (!$officerRow) {
        respond([
            'success' => false,
            'error'   => 'Officer not found'
        ], 404);
    }

    if (($officerRow['status'] ?? '') !== 'Active') {
        respond([
            'success' => false,
            'error'   => 'Only active officers can be assigned'
        ], 422);
    }

    $officerName       = (string)$officerRow['name'];
    $officerBarangayId = $officerRow['barangay_id'] === null
        ? null
        : (int)$officerRow['barangay_id'];

    /*
     * Barangay Admin:
     * complaint and officer must both belong to the admin's barangay.
     */
    if (!$isSuperAdmin) {

        if ($officerBarangayId !== $barangay_id) {
            respond([
                'success' => false,
                'error'   => 'Officer does not belong to your barangay'
            ], 403);
        }

        $stmt = $conn->prepare(
            "UPDATE complaints
             SET officer = ?, officer_id = ?
             WHERE complaint_id = ?
               AND barangay_id = ?"
        );
        $stmt->bind_param(
            'sisi',
            $officerName,
            $officerId,
            $complaintId,
            $barangay_id
        );

    } else {

        /*
         * Super Admin:
         * officer must belong to the same barangay as the complaint.
         */
        $complaintStmt = $conn->prepare(
            "SELECT barangay_id
             FROM complaints
             WHERE complaint_id = ?
             LIMIT 1"
        );
        $complaintStmt->bind_param('s', $complaintId);
        $complaintStmt->execute();
        $complaintRow = $complaintStmt->get_result()->fetch_assoc();
        $complaintStmt->close();

        if (!$complaintRow) {
            respond([
                'success' => false,
                'error'   => 'Complaint not found'
            ], 404);
        }

        $complaintBarangayId = $complaintRow['barangay_id'] === null
            ? null
            : (int)$complaintRow['barangay_id'];

        if (
            $complaintBarangayId === null ||
            $officerBarangayId === null ||
            $complaintBarangayId !== $officerBarangayId
        ) {
            respond([
                'success' => false,
                'error'   => 'Officer must belong to the same barangay as the complaint'
            ], 422);
        }

        $stmt = $conn->prepare(
            "UPDATE complaints
             SET officer = ?, officer_id = ?
             WHERE complaint_id = ?"
        );
        $stmt->bind_param(
            'sis',
            $officerName,
            $officerId,
            $complaintId
        );
    }

    $ok = $stmt->execute();
    $affected = $stmt->affected_rows;
    $stmt->close();

    if (!$ok || $affected < 1) {
        respond([
            'success' => false,
            'error'   => 'Complaint not found or officer assignment did not change'
        ], 404);
    }

    $logBarangayId = $isSuperAdmin
        ? $officerBarangayId
        : $barangay_id;

    logActivity(
        $conn,
        $userId,
        $userName,
        $logBarangayId,
        'officer_assigned',
        "Officer '$officerName' (ID: $officerId) assigned to complaint $complaintId"
    );

    respond(['success' => true]);
}

/*
 * POST action=create_barangay
 *
 * Super Admin only.
 * Creates a new barangay without creating an administrator account.
 */
if ($method === 'POST' && $action === 'create_barangay') {

    if (!$isSuperAdmin) {
        respond([
            'ok' => false,
            'error' => 'Super Administrator access required'
        ], 403);
    }

    $name = trim((string)($body['name'] ?? ''));
    $municipality = trim((string)($body['municipality'] ?? ''));
    $adminEmail = trim((string)($body['admin_email'] ?? ''));
    $status = trim((string)($body['status'] ?? 'Active'));

    if ($name === '') {
        respond([
            'ok' => false,
            'error' => 'Barangay name is required'
        ], 422);
    }

    if (strlen($name) > 150) {
        respond([
            'ok' => false,
            'error' => 'Barangay name is too long'
        ], 422);
    }

    if (strlen($municipality) > 150) {
        respond([
            'ok' => false,
            'error' => 'Municipality name is too long'
        ], 422);
    }

    if (
        $adminEmail !== '' &&
        !filter_var($adminEmail, FILTER_VALIDATE_EMAIL)
    ) {
        respond([
            'ok' => false,
            'error' => 'Invalid administrator email address'
        ], 422);
    }

    $allowedStatuses = [
        'Active',
        'Inactive',
        'Suspended'
    ];

    if (!in_array($status, $allowedStatuses, true)) {
        respond([
            'ok' => false,
            'error' => 'Invalid barangay status'
        ], 422);
    }

    /*
     * Prevent duplicate barangay names.
     * Comparison is case-insensitive under the normal
     * MariaDB text collation.
     */
    $check = $conn->prepare(
        "SELECT id
         FROM barangays
         WHERE name = ?
         LIMIT 1"
    );
    $check->bind_param('s', $name);
    $check->execute();

    $existing = $check
        ->get_result()
        ->fetch_assoc();

    $check->close();

    if ($existing) {
        respond([
            'ok' => false,
            'error' => 'A barangay with this name already exists'
        ], 409);
    }

    $stmt = $conn->prepare(
        "INSERT INTO barangays
            (name, municipality, admin_email, status)
         VALUES (?, ?, ?, ?)"
    );

    $stmt->bind_param(
        'ssss',
        $name,
        $municipality,
        $adminEmail,
        $status
    );

    $ok = $stmt->execute();
    $newId = (int)$conn->insert_id;
    $stmt->close();

    if (!$ok || $newId <= 0) {
        respond([
            'ok' => false,
            'error' => 'Could not create barangay'
        ], 500);
    }

    logActivity(
        $conn,
        $userId,
        $userName,
        $newId,
        'barangay_created',
        "Barangay '$name' created with status '$status'"
    );

    respond([
        'ok' => true,
        'barangay' => [
            'id' => $newId,
            'name' => $name,
            'municipality' => $municipality,
            'admin_email' => $adminEmail,
            'status' => $status
        ]
    ]);
}

/*
 * PUT action=update_barangay
 *
 * Super Admin only.
 * Updates barangay identity/contact information.
 * Status changes remain handled by update_barangay_status.
 */
if ($method === 'PUT' && $action === 'update_barangay') {

    if (!$isSuperAdmin) {
        respond([
            'ok' => false,
            'error' => 'Super Administrator access required'
        ], 403);
    }

    $targetBarangayId = (int)($body['barangay_id'] ?? 0);
    $name = trim((string)($body['name'] ?? ''));
    $municipality = trim((string)($body['municipality'] ?? ''));
    $adminEmail = trim((string)($body['admin_email'] ?? ''));

    if ($targetBarangayId <= 0) {
        respond([
            'ok' => false,
            'error' => 'barangay_id is required'
        ], 422);
    }

    if ($name === '') {
        respond([
            'ok' => false,
            'error' => 'Barangay name is required'
        ], 422);
    }

    if (strlen($name) > 150) {
        respond([
            'ok' => false,
            'error' => 'Barangay name is too long'
        ], 422);
    }

    if (strlen($municipality) > 150) {
        respond([
            'ok' => false,
            'error' => 'Municipality name is too long'
        ], 422);
    }

    if (
        $adminEmail !== '' &&
        !filter_var($adminEmail, FILTER_VALIDATE_EMAIL)
    ) {
        respond([
            'ok' => false,
            'error' => 'Invalid administrator email address'
        ], 422);
    }

    /*
     * Load the existing record first.
     */
    $existingStmt = $conn->prepare(
        "SELECT
            id,
            name,
            municipality,
            admin_email,
            status
         FROM barangays
         WHERE id = ?
         LIMIT 1"
    );

    $existingStmt->bind_param(
        'i',
        $targetBarangayId
    );

    $existingStmt->execute();

    $existing = $existingStmt
        ->get_result()
        ->fetch_assoc();

    $existingStmt->close();

    if (!$existing) {
        respond([
            'ok' => false,
            'error' => 'Barangay not found'
        ], 404);
    }

    /*
     * Another barangay may not already use the new name.
     */
    $duplicateStmt = $conn->prepare(
        "SELECT id
         FROM barangays
         WHERE name = ?
           AND id <> ?
         LIMIT 1"
    );

    $duplicateStmt->bind_param(
        'si',
        $name,
        $targetBarangayId
    );

    $duplicateStmt->execute();

    $duplicate = $duplicateStmt
        ->get_result()
        ->fetch_assoc();

    $duplicateStmt->close();

    if ($duplicate) {
        respond([
            'ok' => false,
            'error' => 'A barangay with this name already exists'
        ], 409);
    }

    $oldName = (string)$existing['name'];
    $oldMunicipality = (string)($existing['municipality'] ?? '');
    $oldAdminEmail = (string)($existing['admin_email'] ?? '');

    /*
     * If nothing changed, return successfully without
     * creating unnecessary audit entries.
     */
    if (
        $oldName === $name &&
        $oldMunicipality === $municipality &&
        $oldAdminEmail === $adminEmail
    ) {
        respond([
            'ok' => true,
            'changed' => false,
            'barangay' => [
                'id' => $targetBarangayId,
                'name' => $name,
                'municipality' => $municipality,
                'admin_email' => $adminEmail,
                'status' => (string)($existing['status'] ?? 'Active')
            ]
        ]);
    }

    $stmt = $conn->prepare(
        "UPDATE barangays
         SET name = ?,
             municipality = ?,
             admin_email = ?
         WHERE id = ?"
    );

    $stmt->bind_param(
        'sssi',
        $name,
        $municipality,
        $adminEmail,
        $targetBarangayId
    );

    $ok = $stmt->execute();
    $stmt->close();

    if (!$ok) {
        respond([
            'ok' => false,
            'error' => 'Could not update barangay'
        ], 500);
    }

    logActivity(
        $conn,
        $userId,
        $userName,
        $targetBarangayId,
        'barangay_updated',
        "Barangay '$oldName' updated to '$name'"
    );

    respond([
        'ok' => true,
        'changed' => true,
        'barangay' => [
            'id' => $targetBarangayId,
            'name' => $name,
            'municipality' => $municipality,
            'admin_email' => $adminEmail,
            'status' => (string)($existing['status'] ?? 'Active')
        ]
    ]);
}

if ($method === 'POST' && $action === 'add_notification') {
    $msg   = (string)($body['msg']        ?? '');
    $ntype = (string)($body['notif_type'] ?? 'info');
    $time  = (string)($body['time']       ?? '');
    if ($isSuperAdmin) {
        respond([
            'success' => false,
            'error' => 'Super Admin notifications require an explicit target scope.'
        ], 422);
    }

    $bid = $barangay_id;
    $stmt = $conn->prepare("INSERT INTO notifications (msg, type, time, barangay_id) VALUES (?, ?, ?, ?)");
    $stmt->bind_param('sssi', $msg, $ntype, $time, $bid);
    $stmt->execute();
    $stmt->close();
    respond(["success" => true]);
}

if ($method === 'POST' && $action === 'mark_read') {
    if (!$isSuperAdmin) {
        $stmt = $conn->prepare("UPDATE notifications SET is_read = 1 WHERE barangay_id = ? OR barangay_id IS NULL");
        $stmt->bind_param('i', $barangay_id);
        $stmt->execute();
        $stmt->close();
    } else {
        $conn->query("UPDATE notifications SET is_read = 1");
    }
    respond(["success" => true]);
}

/* ════════════════════════════════════════════════════
   PUT action=update_status   (RESOLVE / advance status)
   THIS WAS MISSING — added so resolves persist to the DB.
════════════════════════════════════════════════════ */
if ($method === 'PUT' && $action === 'update_status') {
    $id         = (string)($body['id']          ?? '');
    $status     = (string)($body['status']      ?? '');
    $sb         = (string)($body['sb']          ?? 'b-gray');
    $resolvedAt = (string)($body['resolved_at'] ?? '');

    if ($id === '') respond(['success' => false, 'error' => 'id required'], 400);

    if (!$isSuperAdmin) {
        $stmt = $conn->prepare(
            "UPDATE complaints SET status = ?, status_badge = ?, resolved_at = ?
              WHERE complaint_id = ? AND barangay_id = ?"
        );
        $stmt->bind_param('ssssi', $status, $sb, $resolvedAt, $id, $barangay_id);
    } else {
        $stmt = $conn->prepare(
            "UPDATE complaints SET status = ?, status_badge = ?, resolved_at = ?
              WHERE complaint_id = ?"
        );
        $stmt->bind_param('ssss', $status, $sb, $resolvedAt, $id);
    }
    $ok = $stmt->execute();
    $stmt->close();

    /* Log resolves (with category) so Admin Stats can count them */
    if ($ok && $status === 'Resolved') {
        $cat = '';
        $cs = $conn->prepare("SELECT category FROM complaints WHERE complaint_id = ? LIMIT 1");
        $cs->bind_param('s', $id);
        $cs->execute();
        $cr = $cs->get_result()->fetch_assoc();
        $cs->close();
        if ($cr) $cat = $cr['category'];
        logActivity($conn, $userId, $userName, $barangay_id,
            'complaint_resolved', "Complaint $id resolved [cat:$cat]");
    }
    respond(['success' => (bool)$ok]);
}


/* ════════════════════════════════════════════════════
   PUT action=close_complaint
════════════════════════════════════════════════════ */
if ($method === 'PUT' && $action === 'close_complaint') {
    $id     = (string)($body['id']     ?? '');
    $reason = (string)($body['reason'] ?? 'Closed');
    $sb     = 'b-gray';
    $closedAt = date('h:i A');
    if ($id === '') respond(['success' => false, 'error' => 'id required'], 400);
    if (!$isSuperAdmin) {
        $stmt = $conn->prepare("UPDATE complaints SET status = 'Closed', status_badge = ?, close_reason = ?, resolved_at = ? WHERE complaint_id = ? AND barangay_id = ?");
        $stmt->bind_param('ssssi', $sb, $reason, $closedAt, $id, $barangay_id);
    } else {
        $stmt = $conn->prepare("UPDATE complaints SET status = 'Closed', status_badge = ?, close_reason = ?, resolved_at = ? WHERE complaint_id = ?");
        $stmt->bind_param('ssss', $sb, $reason, $closedAt, $id);
    }
    $ok = $stmt->execute();
    $stmt->close();
    if ($ok) {
        $catC = '';
        $csC = $conn->prepare("SELECT category FROM complaints WHERE complaint_id = ? LIMIT 1");
        $csC->bind_param('s', $id);
        $csC->execute();
        $crC = $csC->get_result()->fetch_assoc();
        $csC->close();
        if ($crC) $catC = $crC['category'];
        logActivity($conn, $userId, $userName, $barangay_id,
            'complaint_closed', "Complaint $id closed — $reason [cat:$catC]");
    }
    respond(['success' => (bool)$ok]);
}

respond(["error" => "Unknown request"], 400);