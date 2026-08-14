<?php
// ═══════════════════════════════════════════════════════
//  BarangAI — api/settings.php
//  ADMIN-ONLY barangay settings and configuration audit.
// ═══════════════════════════════════════════════════════

error_reporting(0);
ini_set('display_errors', 0);

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

    /*
     * Barangay Admin must always have a valid barangay.
     * Super Admin may legitimately have barangay_id = NULL.
     */
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

function logActivity($conn, $userId, $userName, $barangayId, $action, $detail) {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';

    $stmt = $conn->prepare(
        'INSERT INTO activity_log
            (user_id, user_name, barangay_id, action, detail, ip_address)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->bind_param(
        'isisss',
        $userId,
        $userName,
        $barangayId,
        $action,
        $detail,
        $ip
    );
    $stmt->execute();
    $stmt->close();
}

// All settings routes require a fully authenticated administrator session.
$sessionUser = require_admin_session();

$isSuperAdmin = isSuperAdmin($sessionUser);

$barangay_id = $sessionUser['barangay_id'] === null
    ? null
    : (int)$sessionUser['barangay_id'];
$userId      = (int)$sessionUser['id'];
$userName    = (string)($sessionUser['name'] ?? 'Unknown');

$conn = getDB();

$method = $_SERVER['REQUEST_METHOD'];
$body   = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? ($body['action'] ?? '');
/*
 * Resolve barangay scope only for barangay-specific
 * settings actions.
 *
 * GET audit is intentionally allowed to run globally
 * for Super Admin.
 */
$target_barangay_id = null;

if (in_array($action, ['get', 'save'], true)) {

    if ($isSuperAdmin) {

        if (isset($_GET['barangay_id'])) {
            $target_barangay_id = (int)$_GET['barangay_id'];
        } elseif (isset($body['barangay_id'])) {
            $target_barangay_id = (int)$body['barangay_id'];
        }

        if (!$target_barangay_id || $target_barangay_id <= 0) {
            $conn->close();

            respond([
                'ok' => false,
                'error' => 'Super Admin must explicitly select a barangay.'
            ], 422);
        }

    } else {

        $target_barangay_id = $barangay_id;
    }
}
// ── GET settings ──────────────────────────────────────────────────
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

    $stmt = $conn->prepare(
    'SELECT * FROM barangays WHERE id = ? LIMIT 1'
    );
    $stmt->bind_param('i', $target_barangay_id);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$row) {
        $conn->close();
        respond(['error' => 'Barangay record not found'], 404);
    }

    $settings = [
        'system_name'      => $defaults['system_name'],
        'barangay_name'    => $row['name'] ?? '',
        'municipality'     => $row['municipality'] ?? '',
        'admin_email'      => $row['admin_email'] ?? '',
        'auto_classify'    => isset($row['auto_classify'])
            ? (int)$row['auto_classify']
            : $defaults['auto_classify'],
        'allow_anonymous'  => isset($row['allow_anonymous'])
            ? (int)$row['allow_anonymous']
            : $defaults['allow_anonymous'],
        'confidence_flag'  => isset($row['confidence_flag'])
            ? (int)$row['confidence_flag']
            : $defaults['confidence_flag'],
        'human_validation' => isset($row['human_validation'])
            ? (int)$row['human_validation']
            : $defaults['human_validation'],
        'bilstm_fallback'  => isset($row['bilstm_fallback'])
            ? (int)$row['bilstm_fallback']
            : $defaults['bilstm_fallback'],
    ];

    $conn->close();
    respond(['ok' => true, 'settings' => $settings]);
}

// ── POST save settings ─────────────────────────────────────────────
if ($method === 'POST' && $action === 'save') {
    $barangayName   = trim((string)($body['barangay_name'] ?? ''));
    $municipality   = trim((string)($body['municipality'] ?? ''));
    $adminEmail     = trim((string)($body['admin_email'] ?? ''));
    $autoClassify   = isset($body['auto_classify'])
        ? (int)(bool)$body['auto_classify'] : 1;
    $allowAnonymous = isset($body['allow_anonymous'])
        ? (int)(bool)$body['allow_anonymous'] : 1;
    $confidenceFlag = isset($body['confidence_flag'])
        ? (int)(bool)$body['confidence_flag'] : 1;
    $humanValidation = isset($body['human_validation'])
        ? (int)(bool)$body['human_validation'] : 0;
    $bilstmFallback = isset($body['bilstm_fallback'])
        ? (int)(bool)$body['bilstm_fallback'] : 0;

    if ($barangayName === '') {
        $conn->close();
        respond(['ok' => false, 'error' => 'Barangay name is required'], 422);
    }

    if ($adminEmail !== '' && !filter_var($adminEmail, FILTER_VALIDATE_EMAIL)) {
        $conn->close();
        respond(['ok' => false, 'error' => 'Invalid admin email address'], 422);
    }

    // Detect whether the newer optional settings columns exist.
    $cols = [];
    $res = $conn->query('SHOW COLUMNS FROM barangays');

    while ($col = $res->fetch_assoc()) {
        $cols[] = $col['Field'];
    }

    $requiredExtras = [
        'municipality',
        'admin_email',
        'auto_classify',
        'allow_anonymous',
        'confidence_flag',
        'human_validation',
        'bilstm_fallback',
    ];

    $hasExtras = count(array_diff($requiredExtras, $cols)) === 0;

    if ($hasExtras) {
        $stmt = $conn->prepare(
            'UPDATE barangays
                SET name = ?,
                    municipality = ?,
                    admin_email = ?,
                    auto_classify = ?,
                    allow_anonymous = ?,
                    confidence_flag = ?,
                    human_validation = ?,
                    bilstm_fallback = ?
              WHERE id = ?'
        );

        // Corrected type string: 3 strings + 6 integers.
        $stmt->bind_param(
            'sssiiiiii',
            $barangayName,
            $municipality,
            $adminEmail,
            $autoClassify,
            $allowAnonymous,
            $confidenceFlag,
            $humanValidation,
            $bilstmFallback,
            $target_barangay_id
        );
    } else {
        // Backward-compatible fallback for an older barangays table.
        $stmt = $conn->prepare(
            'UPDATE barangays SET name = ? WHERE id = ?'
        );
        $stmt->bind_param('si', $barangayName, $target_barangay_id);
    }

    $ok = $stmt->execute();
    $stmt->close();

    if (!$ok) {
        $conn->close();
        respond(['ok' => false, 'error' => 'Could not save settings'], 500);
    }

    logActivity(
        $conn,
        $userId,
        $userName,
        $target_barangay_id,
        'settings_saved',
        'System settings updated'
    );

    $conn->close();
    respond(['ok' => true]);
}

// ── GET audit log — SYSTEM CONFIG CHANGES ONLY ────────────────────
if ($method === 'GET' && $action === 'audit') {
    $auditActions = [
        'settings_saved',
        'barangay_updated',
        'model_changed',
        'category_updated',
    ];

    $placeholders = implode(
        ',',
        array_fill(0, count($auditActions), '?')
    );

    if ($isSuperAdmin) {

    /*
     * Super Admin:
     * - no barangay_id = global audit
     * - barangay_id=N  = selected barangay audit
     */
    $auditBarangayId = isset($_GET['barangay_id'])
        ? (int)$_GET['barangay_id']
        : 0;

    if ($auditBarangayId > 0) {

        $stmt = $conn->prepare(
            "SELECT user_name,
                    barangay_id,
                    action,
                    detail,
                    ip_address,
                    created_at
               FROM activity_log
              WHERE barangay_id = ?
                AND action IN ($placeholders)
              ORDER BY created_at DESC
              LIMIT 100"
        );

        $types  = 'i' . str_repeat('s', count($auditActions));
        $params = array_merge(
            [$auditBarangayId],
            $auditActions
        );

        $stmt->bind_param($types, ...$params);

    } else {

        $stmt = $conn->prepare(
            "SELECT user_name,
                    barangay_id,
                    action,
                    detail,
                    ip_address,
                    created_at
               FROM activity_log
              WHERE action IN ($placeholders)
              ORDER BY created_at DESC
              LIMIT 100"
        );

        $types  = str_repeat('s', count($auditActions));
        $params = $auditActions;

        $stmt->bind_param($types, ...$params);
    }

    } else {

        /*
         * Barangay Admin:
         * configuration changes for own barangay only.
         */
        $stmt = $conn->prepare(
            "SELECT user_name,
                    barangay_id,
                    action,
                    detail,
                    ip_address,
                    created_at
               FROM activity_log
              WHERE barangay_id = ?
                AND action IN ($placeholders)
              ORDER BY created_at DESC
              LIMIT 100"
        );

        $types  = 'i' . str_repeat('s', count($auditActions));
        $params = array_merge(
            [$barangay_id],
            $auditActions
        );

        $stmt->bind_param($types, ...$params);
    }

    $stmt->execute();

    $result = $stmt->get_result();
    $rows = [];

    while ($row = $result->fetch_assoc()) {
        $rows[] = $row;
    }

    $stmt->close();
    $conn->close();

    respond([
        'ok' => true,
        'log' => $rows
    ]);
}

$conn->close();
respond(['error' => 'Unknown request'], 400);