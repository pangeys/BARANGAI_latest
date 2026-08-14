<?php
// ═══════════════════════════════════════════════════════
//  BarangAI — api/complaints.php
//  ADMIN-ONLY complaints endpoint.
//  GET  /api/complaints.php        → complaints for admin's barangay
//  GET  /api/complaints.php?id=5   → one complaint in admin's barangay
//  POST /api/complaints.php        → create complaint for admin's barangay
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

// IMPORTANT: Require a fully authenticated admin session before opening DB.
$admin = require_admin_session();

$isSuperAdmin = isSuperAdmin($admin);

$barangay_id = $admin['barangay_id'] === null
    ? null
    : (int)$admin['barangay_id'];

$db = getDB();

// ══════════════════════════════════════════════════════════════════
//  POST — Admin wizard submits a new complaint
// ══════════════════════════════════════════════════════════════════
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);

    if (!is_array($body)) {
        respond(['error' => 'Invalid JSON body'], 400);
    }
        /*
     * Resolve complaint target barangay.
     *
     * Barangay Admin:
     *   always creates inside own barangay.
     *
     * Super Admin:
     *   must explicitly provide barangay_id.
     */
    if ($isSuperAdmin) {

        $targetBarangayId = (int)($body['barangay_id'] ?? 0);

        if ($targetBarangayId <= 0) {
            $db->close();

            respond([
                'error' => 'Super Admin must explicitly select a barangay.'
            ], 422);
        }

    } else {

        $targetBarangayId = $barangay_id;
    }
        /*
     * Validate target barangay.
     */
    $barangayCheck = $db->prepare(
        'SELECT id FROM barangays WHERE id = ? LIMIT 1'
    );

    $barangayCheck->bind_param(
        'i',
        $targetBarangayId
    );

    $barangayCheck->execute();

    $barangayExists = $barangayCheck
        ->get_result()
        ->fetch_assoc();

    $barangayCheck->close();

    if (!$barangayExists) {
        $db->close();

        respond([
            'error' => 'Selected barangay does not exist.'
        ], 422);
    }

    $complaint_id  = $body['id']          ?? '#000';
    $date_filed    = date('Y-m-d');
    $incident_date = $body['date']        ?? null;
    $incident_time = $body['time']        ?? null;
    $location      = $body['location']    ?? '';
    $description   = $body['description'] ?? '';
    $complainant   = $body['complainant'] ?? 'Anonymous';
    $affected      = (int)($body['affected'] ?? 1);
    $category      = $body['category']    ?? '';
    $confidence    = (float)($body['confidence'] ?? 0);
    $priority      = $body['priority']    ?? 'Low';
    $score         = (float)($body['score'] ?? 0);
    $officer       = $body['officer']     ?? '—';
    $status        = $body['status']      ?? 'Open';

    $priority_badge = 'b-gray';
    if ($priority === 'Critical')      $priority_badge = 'b-red';
    elseif ($priority === 'High')      $priority_badge = 'b-amber';
    elseif ($priority === 'Medium')    $priority_badge = 'b-blue';
    elseif ($priority === 'Low')       $priority_badge = 'b-green';

    $status_badge = 'b-gray';
    if ($status === 'Resolved')        $status_badge = 'b-green';
    elseif ($status === 'In Progress') $status_badge = 'b-blue';
    elseif ($status === 'For Hearing') $status_badge = 'b-amber';

    $stmt = $db->prepare("
        INSERT INTO complaints
          (complaint_id, date_filed, incident_date, incident_time, location,
           description, complainant, affected, category, confidence,
           priority, priority_badge, score, officer, status, status_badge, barangay_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");

    $stmt->bind_param(
        'sssssssissssdssi',
        $complaint_id, $date_filed, $incident_date, $incident_time,
        $location, $description, $complainant, $affected,
        $category, $confidence, $priority, $priority_badge,
        $score, $officer, $status, $status_badge, $targetBarangayId
    );

    if ($stmt->execute()) {
        $insertedId = $db->insert_id;
        $stmt->close();
        $db->close();
        respond(['success' => true, 'inserted_id' => $insertedId]);
    }

    $error = $stmt->error;
    $stmt->close();
    $db->close();
    respond(['error' => $error], 500);
}

// ══════════════════════════════════════════════════════════════════
//  GET — complaints belonging only to the authenticated admin's barangay
// ══════════════════════════════════════════════════════════════════
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        /*
     * Resolve complaint read scope.
     */
    if ($isSuperAdmin) {

        $requestedBarangayId = isset($_GET['barangay_id'])
            ? (int)$_GET['barangay_id']
            : 0;

        $requestedScope = trim(
            (string)($_GET['scope'] ?? '')
        );

        if ($requestedBarangayId > 0) {

            $barangayCheck = $db->prepare(
                'SELECT id FROM barangays WHERE id = ? LIMIT 1'
            );
            $barangayCheck->bind_param('i', $requestedBarangayId);
            $barangayCheck->execute();

            $barangayExists = $barangayCheck
                ->get_result()
                ->fetch_assoc();

            $barangayCheck->close();

            if (!$barangayExists) {
                $db->close();
                respond([
                    'error' => 'Selected barangay does not exist'
                ], 422);
            }

            $targetBarangayId = $requestedBarangayId;
            $globalScope = false;

        } elseif ($requestedScope === 'all') {

            $targetBarangayId = null;
            $globalScope = true;

        } else {

            $db->close();

            respond([
                'error' => 'Super Admin must select a barangay or explicitly request scope=all'
            ], 422);
        }

    } else {

        $targetBarangayId = $barangay_id;
        $globalScope = false;
    }

    if (isset($_GET['id'])) {
        $id = (int)$_GET['id'];

        if ($id <= 0) {
            $db->close();
            respond(['error' => 'Invalid complaint id'], 422);
        }

        if ($globalScope) {

        $stmt = $db->prepare(
            'SELECT * FROM complaints
            WHERE id = ?
            LIMIT 1'
        );
        $stmt->bind_param('i', $id);

        } else {

            $stmt = $db->prepare(
                'SELECT * FROM complaints
                WHERE id = ?
                AND barangay_id = ?
                LIMIT 1'
            );
            $stmt->bind_param(
                'ii',
                $id,
                $targetBarangayId
            );
        }
        $stmt->execute();
        $row = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $db->close();

        if (!$row) {
            respond(['error' => 'Complaint not found'], 404);
        }

        respond($row);
    }

    if ($globalScope) {

    $stmt = $db->prepare(
        'SELECT * FROM complaints
         ORDER BY date_filed DESC'
    );

    } else {

    $stmt = $db->prepare(
        'SELECT * FROM complaints
         WHERE barangay_id = ?
         ORDER BY date_filed DESC'
    );

    $stmt->bind_param(
        'i',
        $targetBarangayId
    );
    }
    $stmt->execute();
    $result = $stmt->get_result();

    $rows = [];
    while ($row = $result->fetch_assoc()) {
        $rows[] = $row;
    }

    $stmt->close();
    $db->close();
    respond($rows);
}

$db->close();
respond(['error' => 'Method not allowed'], 405);