<?php
// ═══════════════════════════════════════════════════════
//  BICTS — api/update_status.php
//  Updates complaint status + status_badge
//  POST body: { complaint_id, status, resolved_at? }
// ═══════════════════════════════════════════════════════

if (session_status() === PHP_SESSION_NONE) session_start();
require_once 'config.php';
$db = getDB();

$body = json_decode(file_get_contents('php://input'), true);
if (!$body) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit();
}

// accept both 'complaint_id' and 'complaint_no' for backward compatibility
$complaint_id = $body['complaint_id'] ?? ($body['complaint_no'] ?? '');
$status       = $body['status']       ?? 'Open';
$resolved_at  = isset($body['resolved_at'])
    ? date('Y-m-d H:i:s', strtotime($body['resolved_at']))
    : null;

// derive status_badge from status
$status_badge = 'b-gray';
if ($status === 'Resolved')    $status_badge = 'b-green';
if ($status === 'In Progress') $status_badge = 'b-blue';
if ($status === 'For Hearing') $status_badge = 'b-amber';
if ($status === 'Closed')      $status_badge = 'b-gray';

// optional: restrict to admin's own barangay
$barangay_id = null;
if (!empty($_SESSION['user']) && $_SESSION['user']['role'] === 'admin') {
    $barangay_id = (int)$_SESSION['user']['barangay_id'];
}

if ($status === 'Resolved' && $resolved_at) {
    if ($barangay_id) {
        $stmt = $db->prepare("
            UPDATE complaints
            SET status = ?, status_badge = ?, resolved_at = ?
            WHERE complaint_id = ? AND (barangay_id = ? OR barangay_id IS NULL)
        ");
        $stmt->bind_param('ssssi', $status, $status_badge, $resolved_at, $complaint_id, $barangay_id);
    } else {
        $stmt = $db->prepare("
            UPDATE complaints SET status = ?, status_badge = ?, resolved_at = ?
            WHERE complaint_id = ?
        ");
        $stmt->bind_param('ssss', $status, $status_badge, $resolved_at, $complaint_id);
    }
} else {
    if ($barangay_id) {
        $stmt = $db->prepare("
            UPDATE complaints SET status = ?, status_badge = ?
            WHERE complaint_id = ? AND (barangay_id = ? OR barangay_id IS NULL)
        ");
        $stmt->bind_param('sssi', $status, $status_badge, $complaint_id, $barangay_id);
    } else {
        $stmt = $db->prepare("
            UPDATE complaints SET status = ?, status_badge = ?
            WHERE complaint_id = ?
        ");
        $stmt->bind_param('sss', $status, $status_badge, $complaint_id);
    }
}

if ($stmt->execute()) {
    echo json_encode(['success' => true, 'affected' => $stmt->affected_rows]);
} else {
    http_response_code(500);
    echo json_encode(['error' => $stmt->error]);
}

$stmt->close();
$db->close();