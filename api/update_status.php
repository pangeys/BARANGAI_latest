<?php
// ═══════════════════════════════════════════════════════
//  BarangAI — api/update_status.php
//  ADMIN-ONLY complaint status update endpoint.
//
//  POST body:
//    { complaint_id, status, resolved_at? }
// ═══════════════════════════════════════════════════════

if (session_status() === PHP_SESSION_NONE) session_start();
require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');

function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function require_admin_session() {
    $user = $_SESSION['user'] ?? null;

    if (!$user || empty($user['id'])) {
        respond(['error' => 'Authentication required'], 401);
    }

    if (($user['role'] ?? '') !== 'admin') {
        respond(['error' => 'Administrator access required'], 403);
    }

    $barangayId = (int)($user['barangay_id'] ?? 0);
    if ($barangayId <= 0) {
        respond(['error' => 'Administrator barangay is not configured'], 403);
    }

    return $user;
}

// Require a fully authenticated admin before any database work.
$admin = require_admin_session();
$barangay_id = (int)$admin['barangay_id'];

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$body = json_decode(file_get_contents('php://input'), true);

if (!is_array($body)) {
    respond(['error' => 'Invalid JSON'], 400);
}

// Accept both names for backward compatibility.
$complaint_id = trim((string)(
    $body['complaint_id'] ?? ($body['complaint_no'] ?? '')
));
$status = trim((string)($body['status'] ?? ''));

if ($complaint_id === '') {
    respond(['error' => 'Complaint id is required'], 422);
}

// Restrict status to values BarangAI actually uses.
$allowedStatuses = ['Open', 'In Progress', 'For Hearing', 'Resolved', 'Closed'];

if (!in_array($status, $allowedStatuses, true)) {
    respond(['error' => 'Invalid complaint status'], 422);
}

// resolved_at is only relevant to a resolved complaint.
$resolved_at = null;

if ($status === 'Resolved' && !empty($body['resolved_at'])) {
    $timestamp = strtotime((string)$body['resolved_at']);

    if ($timestamp === false) {
        respond(['error' => 'Invalid resolved_at value'], 422);
    }

    $resolved_at = date('Y-m-d H:i:s', $timestamp);
}

// Derive status_badge server-side.
$status_badge = 'b-gray';

if ($status === 'Resolved') {
    $status_badge = 'b-green';
} elseif ($status === 'In Progress') {
    $status_badge = 'b-blue';
} elseif ($status === 'For Hearing') {
    $status_badge = 'b-amber';
}

$db = getDB();

/*
 * SECURITY:
 * Update only a complaint that belongs to the authenticated admin's barangay.
 * There is deliberately no "no-session" or cross-barangay fallback.
 */
if ($status === 'Resolved') {
    $stmt = $db->prepare(
        'UPDATE complaints
            SET status = ?, status_badge = ?, resolved_at = ?
          WHERE complaint_id = ?
            AND barangay_id = ?'
    );
    $stmt->bind_param(
        'ssssi',
        $status,
        $status_badge,
        $resolved_at,
        $complaint_id,
        $barangay_id
    );
} else {
    // Clear resolved_at if a previously resolved case is moved to another status.
    $stmt = $db->prepare(
        'UPDATE complaints
            SET status = ?, status_badge = ?, resolved_at = NULL
          WHERE complaint_id = ?
            AND barangay_id = ?'
    );
    $stmt->bind_param(
        'sssi',
        $status,
        $status_badge,
        $complaint_id,
        $barangay_id
    );
}

if (!$stmt->execute()) {
    $error = $stmt->error;
    $stmt->close();
    $db->close();
    respond(['error' => $error], 500);
}

$affected = $stmt->affected_rows;
$stmt->close();

if ($affected < 1) {
    $db->close();
    respond([
        'error' => 'Complaint not found in your barangay or no change was made'
    ], 404);
}

$db->close();

respond([
    'success'  => true,
    'affected' => $affected
]);