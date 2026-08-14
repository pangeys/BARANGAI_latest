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

function require_admin_session() {
    $user = $_SESSION['user'] ?? null;

    if (!$user || empty($user['id'])) {
        respond(['error' => 'Authentication required'], 401);
    }

    if (!isAdministrativeUser($user)) {
        respond(['error' => 'Administrator access required'], 403);
    }

    if (isBarangayAdmin($user)) {
        $barangayId = $user['barangay_id'] === null
            ? null
            : (int)$user['barangay_id'];

        if ($barangayId === null || $barangayId <= 0) {
            respond([
                'error' => 'Administrator barangay is not configured'
            ], 403);
        }
    }

    return $user;
}

// Require a fully authenticated admin before any database work.
$admin = require_admin_session();

$isSuperAdmin = isSuperAdmin($admin);

$barangay_id = $admin['barangay_id'] === null
    ? null
    : (int)$admin['barangay_id'];

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

    if ($isSuperAdmin) {

        $stmt = $db->prepare(
            'UPDATE complaints
                SET status = ?, status_badge = ?, resolved_at = ?
              WHERE complaint_id = ?'
        );

        $stmt->bind_param(
            'ssss',
            $status,
            $status_badge,
            $resolved_at,
            $complaint_id
        );

    } else {

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
    }

} else {

    // Clear resolved_at if a previously resolved case
    // is moved to another status.

    if ($isSuperAdmin) {

        $stmt = $db->prepare(
            'UPDATE complaints
                SET status = ?, status_badge = ?, resolved_at = NULL
              WHERE complaint_id = ?'
        );

        $stmt->bind_param(
            'sss',
            $status,
            $status_badge,
            $complaint_id
        );

    } else {

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
    'error' => $isSuperAdmin
        ? 'Complaint not found or no change was made'
        : 'Complaint not found in your barangay or no change was made'
], 404);
}

$db->close();

respond([
    'success'  => true,
    'affected' => $affected
]);