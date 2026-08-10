<?php
error_reporting(0);
ini_set('display_errors', 0);

if (session_status() === PHP_SESSION_NONE) session_start();

require_once __DIR__ . '/config.php';

header("Content-Type: application/json; charset=utf-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$conn = getDB();

function respond($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
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

$sessionUser = $_SESSION['user'] ?? [];
$barangay_id = isset($sessionUser['barangay_id']) ? (int)$sessionUser['barangay_id'] : 0;
$userId      = isset($sessionUser['id'])          ? (int)$sessionUser['id']          : 0;
$userName    = $sessionUser['name']               ?? 'Unknown';

$method = $_SERVER['REQUEST_METHOD'];
$body   = json_decode(file_get_contents("php://input"), true) ?? [];
$action = $_GET['action'] ?? ($body['action'] ?? '');

/* ── GET settings ── */
if ($method === 'GET' && $action === 'get') {
    $defaults = [
        'system_name'      => 'BICTS – Barangay Intelligent Case Tracking System',
        'barangay_name'    => '',
        'municipality'     => '',
        'admin_email'      => '',
        'auto_classify'    => 1,
        'allow_anonymous'  => 1,
        'confidence_flag'  => 1,
        'human_validation' => 0,
        'bilstm_fallback'  => 0,
    ];
    if ($barangay_id > 0) {
        $stmt = $conn->prepare("SELECT * FROM barangays WHERE id = ?");
        $stmt->bind_param('i', $barangay_id);
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if ($row) {
            respond(['ok' => true, 'settings' => [
                'system_name'      => $defaults['system_name'],
                'barangay_name'    => $row['name']             ?? '',
                'municipality'     => $row['municipality']     ?? '',
                'admin_email'      => $row['admin_email']      ?? '',
                'auto_classify'    => isset($row['auto_classify'])    ? (int)$row['auto_classify']    : $defaults['auto_classify'],
                'allow_anonymous'  => isset($row['allow_anonymous'])  ? (int)$row['allow_anonymous']  : $defaults['allow_anonymous'],
                'confidence_flag'  => isset($row['confidence_flag'])  ? (int)$row['confidence_flag']  : $defaults['confidence_flag'],
                'human_validation' => isset($row['human_validation']) ? (int)$row['human_validation'] : $defaults['human_validation'],
                'bilstm_fallback'  => isset($row['bilstm_fallback'])  ? (int)$row['bilstm_fallback']  : $defaults['bilstm_fallback'],
            ]]);
        }
    }
    respond(['ok' => true, 'settings' => $defaults]);
}

/* ── POST save settings ── */
if ($method === 'POST' && $action === 'save') {
    $barangayName    = trim((string)($body['barangay_name']    ?? ''));
    $municipality    = trim((string)($body['municipality']     ?? ''));
    $adminEmail      = trim((string)($body['admin_email']      ?? ''));
    $autoClassify    = isset($body['auto_classify'])    ? (int)(bool)$body['auto_classify']    : 1;
    $allowAnonymous  = isset($body['allow_anonymous'])  ? (int)(bool)$body['allow_anonymous']  : 1;
    $confidenceFlag  = isset($body['confidence_flag'])  ? (int)(bool)$body['confidence_flag']  : 1;
    $humanValidation = isset($body['human_validation']) ? (int)(bool)$body['human_validation'] : 0;
    $bilstmFallback  = isset($body['bilstm_fallback'])  ? (int)(bool)$body['bilstm_fallback']  : 0;

    if ($barangay_id > 0) {
        $cols = [];
        $res  = $conn->query("SHOW COLUMNS FROM barangays");
        while ($col = $res->fetch_assoc()) $cols[] = $col['Field'];
        $hasExtras = in_array('municipality', $cols);

        if ($hasExtras) {
            $stmt = $conn->prepare(
                "UPDATE barangays SET name=?, municipality=?, admin_email=?,
                 auto_classify=?, allow_anonymous=?, confidence_flag=?,
                 human_validation=?, bilstm_fallback=? WHERE id=?"
            );
            $stmt->bind_param('sssiiiii i',
                $barangayName, $municipality, $adminEmail,
                $autoClassify, $allowAnonymous, $confidenceFlag,
                $humanValidation, $bilstmFallback, $barangay_id
            );
        } else {
            $stmt = $conn->prepare("UPDATE barangays SET name=? WHERE id=?");
            $stmt->bind_param('si', $barangayName, $barangay_id);
        }
        $ok = $stmt->execute();
        $stmt->close();

        if ($ok) {
            // action = 'settings_saved' — only this appears in Audit Log
            logActivity($conn, $userId, $userName, $barangay_id,
                'settings_saved', 'System settings updated');
        }
        respond(['ok' => (bool)$ok]);
    }
    respond(['ok' => false, 'error' => 'No barangay session'], 401);
}

/* ── GET audit log — SYSTEM CONFIG CHANGES ONLY ── */
if ($method === 'GET' && $action === 'audit') {
    // Only show settings/config-related actions — NOT logins, complaints, etc.
    $auditActions = ['settings_saved', 'barangay_updated', 'model_changed', 'category_updated'];
    $placeholders = implode(',', array_fill(0, count($auditActions), '?'));
    $rows = [];

    if ($barangay_id > 0) {
        $stmt = $conn->prepare(
            "SELECT user_name, action, detail, ip_address, created_at
               FROM activity_log
              WHERE barangay_id = ?
                AND action IN ($placeholders)
              ORDER BY created_at DESC
              LIMIT 100"
        );
        $types = 'i' . str_repeat('s', count($auditActions));
        $params = array_merge([$barangay_id], $auditActions);
        $stmt->bind_param($types, ...$params);
        $stmt->execute();
        $r = $stmt->get_result();
        $stmt->close();
        while ($row = $r->fetch_assoc()) $rows[] = $row;
    } else {
        $stmt = $conn->prepare(
            "SELECT user_name, action, detail, ip_address, created_at
               FROM activity_log
              WHERE action IN ($placeholders)
              ORDER BY created_at DESC
              LIMIT 100"
        );
        $types = str_repeat('s', count($auditActions));
        $stmt->bind_param($types, ...$auditActions);
        $stmt->execute();
        $r = $stmt->get_result();
        $stmt->close();
        while ($row = $r->fetch_assoc()) $rows[] = $row;
    }
    respond(['ok' => true, 'log' => $rows]);
}

respond(['error' => 'Unknown request'], 400);