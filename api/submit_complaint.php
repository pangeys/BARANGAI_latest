<?php
if (session_status() === PHP_SESSION_NONE) session_start();
require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');
// Complaint tracking and submission responses are live data, never cache them.
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

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

/*
 * RUNTIME SETTINGS COMPATIBILITY
 * Older BarangAI databases may not yet have the two runtime-setting columns.
 * Read them only when they exist; otherwise fall back to the safe defaults
 * used by the original system. settings.php will create these columns when
 * an administrator saves the General settings page.
 */
function getResidentRuntimeSettings($db, $barangayId) {
    $defaults = [
        'auto_classify'   => 1,
        'allow_anonymous' => 1,
    ];

    $columns = [];
    $res = $db->query('SHOW COLUMNS FROM barangays');
    if ($res) {
        while ($row = $res->fetch_assoc()) $columns[] = $row['Field'];
        $res->free();
    }

    $select = [];
    if (in_array('auto_classify', $columns, true))   $select[] = 'auto_classify';
    if (in_array('allow_anonymous', $columns, true)) $select[] = 'allow_anonymous';

    if (!$select) return $defaults;

    $stmt = $db->prepare('SELECT ' . implode(', ', $select) . ' FROM barangays WHERE id = ? LIMIT 1');
    if (!$stmt) return $defaults;
    $stmt->bind_param('i', $barangayId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc() ?: [];
    $stmt->close();

    if (array_key_exists('auto_classify', $row))   $defaults['auto_classify'] = (int)$row['auto_classify'];
    if (array_key_exists('allow_anonymous', $row)) $defaults['allow_anonymous'] = (int)$row['allow_anonymous'];
    return $defaults;
}


/*
 * Small resident-side change token used by the My Complaints live tracker.
 * It changes when this resident files a complaint, when a complaint status
 * history row is added, or when an officer assignment timestamp changes.
 */
function getResidentComplaintSyncStamp($db, $uid) {
    $maxComplaintId = 0;
    $maxHistoryId = 0;
    $maxAssignmentTime = 0;
    $maxClassificationReviewTime = 0;
    $classificationStateHash = '0';

    $stmt = $db->prepare(
        'SELECT COALESCE(MAX(id), 0) AS v FROM complaints WHERE submitted_by = ?'
    );
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $maxComplaintId = (int)($stmt->get_result()->fetch_assoc()['v'] ?? 0);
    $stmt->close();

    $stmt = $db->prepare(
        'SELECT COALESCE(MAX(h.id), 0) AS v
           FROM complaint_status_history h
           INNER JOIN complaints c ON c.complaint_id = h.complaint_id
          WHERE c.submitted_by = ?'
    );
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $maxHistoryId = (int)($stmt->get_result()->fetch_assoc()['v'] ?? 0);
    $stmt->close();

    $stmt = $db->prepare(
        'SELECT COALESCE(MAX(UNIX_TIMESTAMP(officer_assigned_at)), 0) AS v
           FROM complaints
          WHERE submitted_by = ?'
    );
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $maxAssignmentTime = (int)($stmt->get_result()->fetch_assoc()['v'] ?? 0);
    $stmt->close();

    $stmt = $db->prepare(
        'SELECT COALESCE(MAX(UNIX_TIMESTAMP(cr.updated_at)), 0) AS v
           FROM classification_reviews cr
           INNER JOIN complaints c ON c.complaint_id = cr.complaint_id
          WHERE c.submitted_by = ?'
    );
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $maxClassificationReviewTime = (int)($stmt->get_result()->fetch_assoc()['v'] ?? 0);
    $stmt->close();

    $stmt = $db->prepare(
        "SELECT COALESCE(SUM(CRC32(CONCAT_WS('|',
                    c.complaint_id,
                    COALESCE(c.category, ''),
                    COALESCE(c.score, ''),
                    COALESCE(cr.status, ''),
                    COALESCE(cr.corrected_category, '')
                ))), 0) AS v
           FROM complaints c
           LEFT JOIN classification_reviews cr ON cr.complaint_id = c.complaint_id
          WHERE c.submitted_by = ?"
    );
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $classificationStateHash = (string)($stmt->get_result()->fetch_assoc()['v'] ?? '0');
    $stmt->close();

    return $maxComplaintId . ':' . $maxHistoryId . ':' . $maxAssignmentTime . ':' . $maxClassificationReviewTime . ':' . $classificationStateHash;
}


/*
 * LIVE ACCOUNT STATUS GATE
 * Do not rely only on the role/status cached in $_SESSION. An admin may
 * disable this resident while the session is still open on another device.
 * Every resident complaint request re-checks the current users row first.
 */
$uid = (int)($user['id'] ?? 0);
$accountStmt = $db->prepare(
    'SELECT role, status, barangay_id FROM users WHERE id = ? LIMIT 1'
);
$accountStmt->bind_param('i', $uid);
$accountStmt->execute();
$liveAccount = $accountStmt->get_result()->fetch_assoc();
$accountStmt->close();

if (!$liveAccount) {
    $_SESSION = [];
    session_destroy();
    out(false, [
        'error'  => 'Your account is no longer available. Please contact your barangay office.',
        'reason' => 'account_unavailable'
    ], 403);
}

if (($liveAccount['status'] ?? '') !== 'active') {
    $reason = ($liveAccount['status'] ?? '') === 'pending'
        ? 'account_pending'
        : 'account_disabled';
    $message = $reason === 'account_pending'
        ? 'Your account is awaiting approval from your barangay office.'
        : 'Your account has been temporarily disabled by a barangay administrator. Please contact your barangay office for assistance.';

    $_SESSION = [];
    session_destroy();
    out(false, ['error' => $message, 'reason' => $reason], 403);
}

if (($liveAccount['role'] ?? '') !== 'resident') {
    out(false, [
        'error'  => 'Your account no longer has resident access.',
        'reason' => 'role_changed'
    ], 403);
}

/* Refresh server-side scope from the live account record. */
$barangay_id = (int)($liveAccount['barangay_id'] ?? 0);
$_SESSION['user']['role']        = $liveAccount['role'];
$_SESSION['user']['status']      = $liveAccount['status'];
$_SESSION['user']['barangay_id'] = $barangay_id;

if ($barangay_id <= 0) {
    out(false, ['error' => 'No barangay on your account.'], 400);
}

/* ════════════════════════════════════════════════════
   GET ?action=my_complaints
   Returns ONLY the complaints submitted by this resident.
   Privacy: filtered server-side by submitted_by = own id.
════════════════════════════════════════════════════ */
$action = $_GET['action'] ?? '';

// Runtime settings are exposed only to the authenticated resident of this barangay.
if ($action === 'runtime_settings') {
    $settingsRow = getResidentRuntimeSettings($db, $barangay_id);
    $db->close();
    out(true, ['settings' => $settingsRow]);
}

if ($action === 'my_complaints_stamp') {
    $stamp = getResidentComplaintSyncStamp($db, (int)$user['id']);
    $db->close();
    out(true, ['stamp' => $stamp]);
}

if ($action === 'my_complaints') {
    $uid = (int)$user['id'];
    $stmt = $db->prepare(
        "SELECT c.complaint_id, c.date_filed, c.created_at, c.description, c.location,
                c.incident_date, c.incident_time,
                CASE WHEN cr.status = 'resolved' THEN c.category ELSE NULL END AS category,
                CASE WHEN cr.status = 'resolved' THEN c.confidence ELSE NULL END AS confidence,
                c.priority, c.priority_badge, c.officer, c.officer_assigned_at,
                c.status, c.status_badge, c.resolved_at, c.closed_at, c.close_reason,
                cr.status AS classification_review_status,
                cr.requested_at AS classification_review_requested_at,
                CASE WHEN cr.status = 'resolved' THEN cr.original_category ELSE NULL END AS classification_review_original_category,
                CASE WHEN cr.status = 'resolved' THEN cr.corrected_category ELSE NULL END AS classification_review_corrected_category,
                cr.corrected_at AS classification_review_corrected_at
           FROM complaints c
           LEFT JOIN classification_reviews cr ON cr.complaint_id = c.complaint_id
          WHERE c.submitted_by = ?
          ORDER BY c.created_at DESC"
    );
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $res  = $stmt->get_result();
    $list = [];
    while ($row = $res->fetch_assoc()) {
        // Missing legacy review rows are pending until an authorized official
        // explicitly verifies the classification.
        if (($row['classification_review_status'] ?? '') !== 'resolved') {
            $row['classification_review_status'] = 'pending';
            $row['category'] = null;
            $row['confidence'] = null;
        }
        $row['status_history'] = [];
        $list[] = $row;
    }
    $stmt->close();

    // Load the exact status timestamps for only this resident's own complaints.
    $historyStmt = $db->prepare(
        "SELECT h.complaint_id, h.status, h.changed_by_name, h.source, h.created_at
           FROM complaint_status_history h
           INNER JOIN complaints c ON c.complaint_id = h.complaint_id
          WHERE c.submitted_by = ?
          ORDER BY h.created_at ASC, h.id ASC"
    );
    $historyStmt->bind_param('i', $uid);
    $historyStmt->execute();
    $historyRes = $historyStmt->get_result();
    $historyMap = [];
    while ($h = $historyRes->fetch_assoc()) {
        $cid = (string)$h['complaint_id'];
        if (!isset($historyMap[$cid])) $historyMap[$cid] = [];
        $historyMap[$cid][] = $h;
    }
    $historyStmt->close();

    foreach ($list as &$complaintRow) {
        $cid = (string)$complaintRow['complaint_id'];
        $complaintRow['status_history'] = $historyMap[$cid] ?? [];
    }
    unset($complaintRow);

    $syncStamp = getResidentComplaintSyncStamp($db, $uid);
    $db->close();
    out(true, ['complaints' => $list, 'sync_stamp' => $syncStamp]);
}

/* ════════════════════════════════════════════════════
   POST ?action=request_classification_review
   Resident can flag the system-generated category for human review.
   The complaint remains filed and keeps its current category until an
   authorized barangay administrator reviews it.
════════════════════════════════════════════════════ */
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'request_classification_review') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $complaintId = trim((string)($input['complaint_id'] ?? ''));

    if ($complaintId === '') {
        out(false, ['error' => 'Complaint number is required.'], 422);
    }

    $stmt = $db->prepare(
        "SELECT complaint_id, category, barangay_id
           FROM complaints
          WHERE complaint_id = ? AND submitted_by = ?
          LIMIT 1"
    );
    $stmt->bind_param('si', $complaintId, $uid);
    $stmt->execute();
    $complaint = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$complaint) {
        out(false, ['error' => 'Complaint not found in your account.'], 404);
    }

    $currentCategory = (string)($complaint['category'] ?? 'Unclassified');
    $targetBarangayId = (int)($complaint['barangay_id'] ?? $barangay_id);
    $officialClock = new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));
    $officialNow = $officialClock->format('Y-m-d H:i:s');

    $existingStmt = $db->prepare(
        "SELECT status FROM classification_reviews WHERE complaint_id = ? LIMIT 1"
    );
    $existingStmt->bind_param('s', $complaintId);
    $existingStmt->execute();
    $existing = $existingStmt->get_result()->fetch_assoc();
    $existingStmt->close();

    if (($existing['status'] ?? '') === 'pending') {
        $db->close();
        out(true, ['already_pending' => true]);
    }

    $reviewStmt = $db->prepare(
        "INSERT INTO classification_reviews
            (complaint_id, barangay_id, resident_id, original_category,
             requested_at, status, corrected_category, corrected_by,
             corrected_by_name, corrected_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE
             barangay_id = VALUES(barangay_id),
             resident_id = VALUES(resident_id),
             original_category = VALUES(original_category),
             requested_at = VALUES(requested_at),
             status = 'pending',
             corrected_category = NULL,
             corrected_by = NULL,
             corrected_by_name = NULL,
             corrected_at = NULL,
             updated_at = VALUES(updated_at)"
    );
    $reviewStmt->bind_param(
        'siissss',
        $complaintId,
        $targetBarangayId,
        $uid,
        $currentCategory,
        $officialNow,
        $officialNow,
        $officialNow
    );

    if (!$reviewStmt->execute()) {
        $err = $reviewStmt->error;
        $reviewStmt->close();
        out(false, ['error' => 'Could not request classification review: ' . $err], 500);
    }
    $reviewStmt->close();

    $notifMessage = 'Classification review requested — ' . $complaintId . ' · Current category: ' . $currentCategory;
    $notifTime = $officialClock->format('h:i A');
    $notifStmt = $db->prepare(
        "INSERT INTO notifications (msg, type, time, created_at, barangay_id, is_read)
         VALUES (?, 'info', ?, ?, ?, 0)"
    );
    if ($notifStmt) {
        $notifStmt->bind_param('sssi', $notifMessage, $notifTime, $officialNow, $targetBarangayId);
        $notifStmt->execute();
        $notifStmt->close();
    }

    $residentName = (string)($user['name'] ?? 'Resident');
    $logStmt = $db->prepare(
        "INSERT INTO activity_log
            (user_id, user_name, barangay_id, action, detail, ip_address, created_at)
         VALUES (?, ?, ?, 'classification_review_requested', ?, ?, ?)"
    );
    if ($logStmt) {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '';
        $detail = 'Resident requested classification review for ' . $complaintId . ' [current:' . $currentCategory . ']';
        $logStmt->bind_param('isisss', $uid, $residentName, $targetBarangayId, $detail, $ip, $officialNow);
        $logStmt->execute();
        $logStmt->close();
    }

    $db->close();
    out(true, ['requested_at' => $officialNow]);
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

// Re-read runtime settings on every submission so UI settings cannot be bypassed.
$runtimeSettings = getResidentRuntimeSettings($db, $barangay_id);
$autoClassify   = (int)$runtimeSettings['auto_classify'];
$allowAnonymous = (int)$runtimeSettings['allow_anonymous'];

$incident_date = $input['incident_date'] ?? '';
$incident_time = $input['incident_time'] ?: null;
$location      = trim($input['location']    ?? '');
$description   = trim($input['description'] ?? '');
$complainantRaw = trim($input['complainant'] ?? '');
if (!$allowAnonymous && $complainantRaw === '') {
    out(false, ['error' => 'Anonymous complaints are currently disabled by your barangay. Please provide your name.'], 422);
}
$complainant   = $complainantRaw !== '' ? $complainantRaw : 'Anonymous';
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

if (!$autoClassify) {
    $category = 'Unclassified';
    $confidence = 0;
}

if (!$incident_date || !$location || !$description)
    out(false, ['error' => 'Date, location, and description are required.'], 422);

/* ── Anti-spam Layer: rate limit + duplicate detection ──────────────
   Prevents one resident account from flooding the priority queue,
   whether by accident (double-click) or intentional abuse. Both checks
   are scoped to submitted_by = this resident's own account only. */
$uid = (int)$user['id'];

// 1. Daily cap: max 3 complaints per resident per rolling 24 hours
$officialClock = new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));
$officialNow   = $officialClock->format('Y-m-d H:i:s');
$dayCutoff     = $officialClock->modify('-24 hours')->format('Y-m-d H:i:s');
$duplicateCutoff = $officialClock->modify('-10 minutes')->format('Y-m-d H:i:s');

$capStmt = $db->prepare(
    'SELECT COUNT(*) FROM complaints
      WHERE submitted_by = ? AND created_at >= ?'
);
$capStmt->bind_param('is', $uid, $dayCutoff);
$capStmt->execute();
$recentCount = (int)$capStmt->get_result()->fetch_row()[0];
$capStmt->close();

if ($recentCount >= 3)
    out(false, ['error' => 'You have reached the limit of 3 complaints per day. Please try again tomorrow, or contact your barangay office directly for urgent matters.'], 429);

// 2. Duplicate guard: same resident, near-identical description, within 10 minutes
$dupStmt = $db->prepare(
    'SELECT COUNT(*) FROM complaints
      WHERE submitted_by = ? AND description = ?
        AND created_at >= ?'
);
$dupStmt->bind_param('iss', $uid, $description, $duplicateCutoff);
$dupStmt->execute();
$dupCount = (int)$dupStmt->get_result()->fetch_row()[0];
$dupStmt->close();

if ($dupCount > 0)
    out(false, ['error' => 'This looks like a complaint you already submitted a few minutes ago. Please check "My Complaints" before submitting again.'], 409);

$year = $officialClock->format('Y');
$cnt  = (int)$db->query("SELECT COUNT(*) FROM complaints WHERE submitted_by IS NOT NULL")->fetch_row()[0];
$complaint_id = 'RES-' . $year . '-' . str_pad($cnt + 1, 5, '0', STR_PAD_LEFT);
$date_filed   = $officialClock->format('Y-m-d');

$stmt = $db->prepare('
    INSERT INTO complaints
        (complaint_id, date_filed, description, location,
         incident_date, incident_time, complainant, affected,
         category, confidence, score, priority, priority_badge,
         officer, status, status_badge, barangay_id, submitted_by, created_at)
    VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "—", "Open", "b-gray", ?, ?, ?)
');

// 15 ? marks: s×7, i×1, s×1, i×1, s×3, i×2
$stmt->bind_param(
    'sssssssisisssiis',
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
    $barangay_id,
    $uid,
    $officialNow
);

if ($stmt->execute()) {
    $stmt->close();

    // Resident submissions always begin with an internal AI proposal that is
    // hidden from the resident until Admin/Super Admin verification.
    $reviewStmt = $db->prepare(
        "INSERT INTO classification_reviews
            (complaint_id, barangay_id, resident_id, original_category,
             requested_at, status, corrected_category, corrected_by,
             corrected_by_name, corrected_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, NULL, ?, ?)"
    );
    $reviewStmt->bind_param(
        'siissss',
        $complaint_id,
        $barangay_id,
        $uid,
        $category,
        $officialNow,
        $officialNow,
        $officialNow
    );
    if (!$reviewStmt->execute()) {
        $err = $reviewStmt->error;
        $reviewStmt->close();
        $deleteStmt = $db->prepare('DELETE FROM complaints WHERE complaint_id = ? AND submitted_by = ?');
        $deleteStmt->bind_param('si', $complaint_id, $uid);
        $deleteStmt->execute();
        $deleteStmt->close();
        $db->close();
        out(false, ['error' => 'Could not create classification verification: ' . $err], 500);
    }
    $reviewStmt->close();

    // Initial Open event: server timestamp is the official filed/progress time.
    $historyStmt = $db->prepare(
        "INSERT INTO complaint_status_history
            (complaint_id, barangay_id, status, changed_by, changed_by_name, source, created_at)
         VALUES (?, ?, 'Open', ?, ?, 'resident_submission', ?)"
    );
    if ($historyStmt) {
        $residentName = (string)($user['name'] ?? 'Resident');
        $historyStmt->bind_param('siiss', $complaint_id, $barangay_id, $uid, $residentName, $officialNow);
        $historyStmt->execute();
        $historyStmt->close();
    }

    // Create an unread in-app alert for the complaint's barangay admins.
    // This also changes the admin live-sync stamp, so an open dashboard refreshes
    // within a few seconds without a manual page reload.
    $notifCategory = $category !== '' ? $category : 'Unclassified';
    $notifMessage = 'New resident complaint — ' . $notifCategory . ' · Priority: ' . $priority;
    $notifTime = $officialClock->format('h:i A');
    $notifStmt = $db->prepare(
        "INSERT INTO notifications (msg, type, time, created_at, barangay_id, is_read)
         VALUES (?, 'info', ?, ?, ?, 0)"
    );
    if ($notifStmt) {
        $notifStmt->bind_param('sssi', $notifMessage, $notifTime, $officialNow, $barangay_id);
        $notifStmt->execute();
        $notifStmt->close();
    }

    // Return the authoritative filed time for immediate UI display if needed.
    $timeStmt = $db->prepare('SELECT created_at FROM complaints WHERE complaint_id = ? LIMIT 1');
    $timeStmt->bind_param('s', $complaint_id);
    $timeStmt->execute();
    $createdAt = $timeStmt->get_result()->fetch_assoc()['created_at'] ?? null;
    $timeStmt->close();

    $db->close();
    out(true, ['complaint_no' => $complaint_id, 'created_at' => $createdAt]);
} else {
    $err = $stmt->error;
    $stmt->close(); $db->close();
    out(false, ['error' => 'DB error: ' . $err], 500);
}
