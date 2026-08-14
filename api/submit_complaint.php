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
$barangay_id = (int)($user['barangay_id'] ?? 0);

if ($barangay_id <= 0) {
    out(false, ['error' => 'No barangay on your account.'], 400);
}
if ($user['role'] !== 'resident') out(false, ['error' => 'Residents only.'], 403);

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
$input = json_decode(file_get_contents('php://input'), true) ?? [];

// Honeypot check — a real resident's browser leaves this field empty since
// it's invisible on the page. Only an automated script filling every field
// blindly would send a value here. Reject silently as if it succeeded, so
// bots don't learn their submission was specifically detected and blocked.
if (!empty($input['website'])) {
    out(true, ['complaint_no' => 'RES-0000-00000']);
}

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
$allowedPriorities = [
    'Critical',
    'High',
    'Medium',
    'Low'
];

if (!in_array($priority, $allowedPriorities, true)) {
    $priority = 'Low';
}

$priorityBadges = [
    'Critical' => 'b-red',
    'High'     => 'b-amber',
    'Medium'   => 'b-blue',
    'Low'      => 'b-green'
];

$priority_badge = $priorityBadges[$priority] ?? 'b-green';
$score          = $input['score']          ?? '';

if (!$incident_date || !$location || !$description)
    out(false, ['error' => 'Date, location, and description are required.'], 422);

/* ── Anti-spam Layer: rate limit + duplicate detection ──────────────
   Prevents one resident account from flooding the priority queue,
   whether by accident (double-click) or intentional abuse. Both checks
   are scoped to submitted_by = this resident's own account only. */
$uid = (int)$user['id'];

// 1. Daily cap: max 3 complaints per resident per rolling 24 hours
$capStmt = $db->prepare(
    'SELECT COUNT(*) FROM complaints
      WHERE submitted_by = ? AND created_at >= NOW() - INTERVAL 24 HOUR'
);
$capStmt->bind_param('i', $uid);
$capStmt->execute();
$recentCount = (int)$capStmt->get_result()->fetch_row()[0];
$capStmt->close();

if ($recentCount >= 3)
    out(false, ['error' => 'You have reached the limit of 3 complaints per day. Please try again tomorrow, or contact your barangay office directly for urgent matters.'], 429);

// 2. Duplicate guard: same resident, near-identical description, within 10 minutes
$dupStmt = $db->prepare(
    'SELECT COUNT(*) FROM complaints
      WHERE submitted_by = ? AND description = ?
        AND created_at >= NOW() - INTERVAL 10 MINUTE'
);
$dupStmt->bind_param('is', $uid, $description);
$dupStmt->execute();
$dupCount = (int)$dupStmt->get_result()->fetch_row()[0];
$dupStmt->close();

if ($dupCount > 0)
    out(false, ['error' => 'This looks like a complaint you already submitted a few minutes ago. Please check "My Complaints" before submitting again.'], 409);

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
    $$barangay_id,
    $uid
);

if ($stmt->execute()) {
    $stmt->close(); $db->close();
    out(true, ['complaint_no' => $complaint_id]);
} else {
    $err = $stmt->error;
    $stmt->close(); $db->close();
    out(false, ['error' => 'DB error: ' . $err], 500);
}