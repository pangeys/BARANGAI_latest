<?php
// ═══════════════════════════════════════════════════════
// BarangAI — api/update_status.php
// ADMIN / SUPER ADMIN complaint status update endpoint
// ═══════════════════════════════════════════════════════

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');


function respond($data, $code = 200) {
    http_response_code($code);

    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE
    );

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


function requireAdminSession() {

    $user = $_SESSION['user'] ?? null;

    if (!$user || empty($user['id'])) {
        respond([
            'error' => 'Authentication required'
        ], 401);
    }

    if (!isAdministrativeUser($user)) {
        respond([
            'error' => 'Administrator access required'
        ], 403);
    }

    /*
     * Barangay Admin must always have
     * a valid barangay scope.
     *
     * Super Admin may legitimately have NULL.
     */
    if (isBarangayAdmin($user)) {

        $barangayId =
            $user['barangay_id'] === null
                ? null
                : (int)$user['barangay_id'];

        if (
            $barangayId === null ||
            $barangayId <= 0
        ) {
            respond([
                'error' =>
                    'Administrator barangay is not configured'
            ], 403);
        }
    }

    return $user;
}


function logStatusActivity(
    $db,
    $user,
    $barangayId,
    $complaintId,
    $oldStatus,
    $newStatus
) {

    $uid =
        (int)($user['id'] ?? 0);

    $name =
        (string)($user['name'] ?? 'Unknown');

    $ip =
        $_SERVER['REMOTE_ADDR'] ?? '';

    $action =
        $newStatus === 'Resolved'
            ? 'complaint_resolved'
            : 'complaint_status_updated';

    $detail =
        "Complaint $complaintId status changed " .
        "from '$oldStatus' to '$newStatus'";

    $stmt = $db->prepare(
        'INSERT INTO activity_log
            (
                user_id,
                user_name,
                barangay_id,
                action,
                detail,
                ip_address
            )
         VALUES (?, ?, ?, ?, ?, ?)'
    );

    $stmt->bind_param(
        'isisss',
        $uid,
        $name,
        $barangayId,
        $action,
        $detail,
        $ip
    );

    $stmt->execute();
    $stmt->close();
}


/*
 * Authentication first.
 */
$user = requireAdminSession();

$isSuperAdmin =
    isSuperAdmin($user);

$sessionBarangayId =
    $user['barangay_id'] === null
        ? null
        : (int)$user['barangay_id'];


/*
 * POST only.
 */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond([
        'error' => 'Method not allowed'
    ], 405);
}


$body = json_decode(
    file_get_contents('php://input'),
    true
);

if (!is_array($body)) {
    respond([
        'error' => 'Invalid JSON'
    ], 400);
}


$complaintId = trim(
    (string)(
        $body['complaint_id']
        ?? $body['complaint_no']
        ?? ''
    )
);

$status = trim(
    (string)($body['status'] ?? '')
);


if ($complaintId === '') {
    respond([
        'error' => 'Complaint id is required'
    ], 422);
}


$allowedStatuses = [
    'Open',
    'In Progress',
    'For Hearing',
    'Resolved',
    'Closed'
];

if (
    !in_array(
        $status,
        $allowedStatuses,
        true
    )
) {
    respond([
        'error' => 'Invalid complaint status'
    ], 422);
}


/*
 * resolved_at is used only when the
 * resulting status is Resolved.
 */
$resolvedAt = null;

if ($status === 'Resolved') {

    if (!empty($body['resolved_at'])) {

        $timestamp =
            strtotime(
                (string)$body['resolved_at']
            );

        if ($timestamp === false) {
            respond([
                'error' =>
                    'Invalid resolved_at value'
            ], 422);
        }

        $resolvedAt =
            date(
                'Y-m-d H:i:s',
                $timestamp
            );

    } else {

        $resolvedAt =
            date('Y-m-d H:i:s');
    }
}


/*
 * Derive badge on the server.
 */
$statusBadges = [
    'Open'        => 'b-gray',
    'In Progress' => 'b-blue',
    'For Hearing' => 'b-amber',
    'Resolved'    => 'b-green',
    'Closed'      => 'b-gray'
];

$statusBadge =
    $statusBadges[$status] ?? 'b-gray';


$db = getDB();


/*
 * Load target complaint FIRST.
 *
 * This tells us:
 * - whether it exists;
 * - which barangay actually owns it;
 * - whether a normal Admin is allowed to touch it;
 * - its previous status for audit logging.
 */
$targetStmt = $db->prepare(
    'SELECT
        complaint_id,
        barangay_id,
        status
     FROM complaints
     WHERE complaint_id = ?
     LIMIT 1'
);

$targetStmt->bind_param(
    's',
    $complaintId
);

$targetStmt->execute();

$target =
    $targetStmt
        ->get_result()
        ->fetch_assoc();

$targetStmt->close();


if (!$target) {
    $db->close();

    respond([
        'error' => 'Complaint not found'
    ], 404);
}


$targetBarangayId =
    $target['barangay_id'] === null
        ? null
        : (int)$target['barangay_id'];

$oldStatus =
    (string)($target['status'] ?? '');


/*
 * Barangay Admin:
 * complaint MUST belong to their barangay.
 *
 * Super Admin:
 * may operate globally.
 */
if (!$isSuperAdmin) {

    if (
        $targetBarangayId !==
        $sessionBarangayId
    ) {
        $db->close();

        respond([
            'error' =>
                'Complaint does not belong to your barangay'
        ], 403);
    }
}


/*
 * Nothing changed.
 */
if ($oldStatus === $status) {

    $db->close();

    respond([
        'success' => true,
        'changed' => false,
        'status'  => $status
    ]);
}


/*
 * Perform update.
 */
if ($status === 'Resolved') {

    $stmt = $db->prepare(
        'UPDATE complaints
            SET status = ?,
                status_badge = ?,
                resolved_at = ?
          WHERE complaint_id = ?'
    );

    $stmt->bind_param(
        'ssss',
        $status,
        $statusBadge,
        $resolvedAt,
        $complaintId
    );

} else {

    $stmt = $db->prepare(
        'UPDATE complaints
            SET status = ?,
                status_badge = ?,
                resolved_at = NULL
          WHERE complaint_id = ?'
    );

    $stmt->bind_param(
        'sss',
        $status,
        $statusBadge,
        $complaintId
    );
}


$ok =
    $stmt->execute();

$affected =
    $stmt->affected_rows;

$stmt->close();


if (!$ok || $affected !== 1) {

    $db->close();

    respond([
        'error' =>
            'Could not update complaint status'
    ], 500);
}


/*
 * Audit against the TARGET barangay,
 * not Super Admin's NULL session barangay.
 */
logStatusActivity(
    $db,
    $user,
    $targetBarangayId,
    $complaintId,
    $oldStatus,
    $status
);


$db->close();


respond([
    'success' => true,
    'changed' => true,
    'status'  => $status
]);