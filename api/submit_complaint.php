<?php
if (session_status() === PHP_SESSION_NONE) session_start();
require_once 'config.php';

function out($ok, $data = [], $code = 200) {
    http_response_code($code);
    echo json_encode(['ok' => $ok] + $data);
    exit;
}

if (empty($_SESSION['user']))     out(false, ['error' => 'Not logged in.'], 401);
$user = $_SESSION['user'];
if ($user['role'] !== 'resident') out(false, ['error' => 'Residents only.'], 403);
if (!$user['barangay_id'])        out(false, ['error' => 'No barangay on your account.'], 400);

$db = getDB();

/* ════════════════════════════════════════════════════
   GET ?action=my_complaints
   Returns ONLY the complaints submitted by this resident.
   Privacy: filtered server-side by submitted_by = own id.
════════════════════════════════════════════════════ */
$action = $_GET['action'] ?? '';
if ($action === 'my_complaints') {
    $uid = (int)$user['id'];
    $stmt = $db->prepare(
        "SELECT complaint_id, date_filed, description, location,
                incident_date, incident_time, category, confidence,
                priority, priority_badge, officer, status, status_badge,
                resolved_at, close_reason
           FROM complaints
          WHERE submitted_by = ?
          ORDER BY created_at DESC"
    );
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $res  = $stmt->get_result();
    $list = [];
    while ($row = $res->fetch_assoc()) $list[] = $row;
    $stmt->close();
    $db->close();
    out(true, ['complaints' => $list]);
}

/* ════════════════════════════════════════════════════
   POST (default) — submit a new complaint
════════════════════════════════════════════════════ */
$input         = json_decode(file_get_contents('php://input'), true) ?? [];
$incident_date = $input['incident_date'] ?? '';
$incident_time = $input['incident_time'] ?: null;
$location      = trim($input['location']    ?? '');
$description   = trim($input['description'] ?? '');
$complainant   = trim($input['complainant'] ?? '') ?: 'Anonymous';
$affected      = isset($input['affected']) && $input['affected'] !== '' ? (int)$input['affected'] : 1;

// AI classification results sent from resident.html
$category       = $input['category']       ?? '';
$confidence     = (int)($input['confidence']  ?? 0);
$priority       = $input['priority']       ?? 'Low';
$priority_badge = $input['priority_badge'] ?? 'b-gray';
$score          = $input['score']          ?? '';

if (!$incident_date || !$location || !$description)
    out(false, ['error' => 'Date, location, and description are required.'], 422);

$year = date('Y');
$cnt  = (int)$db->query("SELECT COUNT(*) FROM complaints WHERE submitted_by IS NOT NULL")->fetch_row()[0];
$complaint_id = 'RES-' . $year . '-' . str_pad($cnt + 1, 5, '0', STR_PAD_LEFT);
$date_filed   = date('Y-m-d');

$stmt = $db->prepare('
    INSERT INTO complaints
        (complaint_id, date_filed, description, location,
         incident_date, incident_time, complainant, affected,
         category, confidence, score, priority, priority_badge,
         officer, status, status_badge, barangay_id, submitted_by)
    VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "—", "Open", "b-gray", ?, ?)
');

// 15 ? marks: s×7, i×1, s×1, i×1, s×3, i×2
$stmt->bind_param(
    'sssssssisisssii',
    $complaint_id,
    $date_filed,
    $description,
    $location,
    $incident_date,
    $incident_time,
    $complainant,
    $affected,
    $category,
    $confidence,
    $score,
    $priority,
    $priority_badge,
    $user['barangay_id'],
    $user['id']
);

if ($stmt->execute()) {
    $stmt->close(); $db->close();
    out(true, ['complaint_no' => $complaint_id]);
} else {
    $err = $stmt->error;
    $stmt->close(); $db->close();
    out(false, ['error' => 'DB error: ' . $err], 500);
}