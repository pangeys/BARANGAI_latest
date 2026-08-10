<?php
// ═══════════════════════════════════════════════════════
//  BICTS — api/complaints.php
//  GET  /api/complaints.php        → fetch complaints (filtered by barangay)
//  GET  /api/complaints.php?id=5   → fetch single complaint
//  POST /api/complaints.php        → save a new complaint (admin wizard)
// ═══════════════════════════════════════════════════════

if (session_status() === PHP_SESSION_NONE) session_start();
require_once 'config.php';
$db = getDB();

// ── Helper: get logged-in admin's barangay_id ──────────────────────
// Returns null if not logged in (fallback: show all — for dev/testing)
function getAdminBarangayId() {
    if (!empty($_SESSION['user']) && $_SESSION['user']['role'] === 'admin') {
        return (int)$_SESSION['user']['barangay_id'];
    }
    return null;
}

// ══════════════════════════════════════════════════════════════════
//  POST — Admin wizard submits a new complaint
// ══════════════════════════════════════════════════════════════════
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!$body) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON body']);
        exit();
    }

    // tag complaint with admin's barangay
    $barangay_id = getAdminBarangayId();

    $complaint_id  = $body['id']           ?? '#000';
    $date_filed    = date('Y-m-d');
    $incident_date = $body['date']         ?? null;
    $incident_time = $body['time']         ?? null;
    $location      = $body['location']     ?? '';
    $description   = $body['description']  ?? '';
    $complainant   = $body['complainant']  ?? 'Anonymous';
    $affected      = (int)($body['affected'] ?? 1);
    $category      = $body['category']     ?? '';
    $confidence    = (float)($body['confidence'] ?? 0);
    $priority      = $body['priority']     ?? 'Low';
    $score         = (float)($body['score'] ?? 0);
    $officer       = $body['officer']      ?? '—';
    $status        = $body['status']       ?? 'Open';

    // derive badge values
    $priority_badge = 'b-gray';
    if ($priority === 'Critical') $priority_badge = 'b-red';
    elseif ($priority === 'High') $priority_badge = 'b-amber';
    elseif ($priority === 'Medium') $priority_badge = 'b-blue';
    elseif ($priority === 'Low')  $priority_badge = 'b-green';

    $status_badge = 'b-gray';
    if ($status === 'Resolved')    $status_badge = 'b-green';
    if ($status === 'In Progress') $status_badge = 'b-blue';
    if ($status === 'For Hearing') $status_badge = 'b-amber';

    if ($barangay_id) {
        // with barangay_id
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
            $score, $officer, $status, $status_badge, $barangay_id
        );
    } else {
        // no session (fallback — keeps old behavior)
        $stmt = $db->prepare("
            INSERT INTO complaints
              (complaint_id, date_filed, incident_date, incident_time, location,
               description, complainant, affected, category, confidence,
               priority, score, officer, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->bind_param(
            'sssssssissddss',
            $complaint_id, $date_filed, $incident_date, $incident_time,
            $location, $description, $complainant, $affected,
            $category, $confidence, $priority, $score, $officer, $status
        );
    }

    if ($stmt->execute()) {
        echo json_encode(['success' => true, 'inserted_id' => $db->insert_id]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => $stmt->error]);
    }
    $stmt->close();
    exit();
}

// ══════════════════════════════════════════════════════════════════
//  GET — Fetch complaints (filtered by admin's barangay)
// ══════════════════════════════════════════════════════════════════
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $barangay_id = getAdminBarangayId();

    if (isset($_GET['id'])) {
        // ── Single complaint ──
        $id   = (int)$_GET['id'];

        if ($barangay_id) {
            // only fetch if it belongs to this admin's barangay
            $stmt = $db->prepare("SELECT * FROM complaints WHERE id = ? AND barangay_id = ?");
            $stmt->bind_param('ii', $id, $barangay_id);
        } else {
            $stmt = $db->prepare("SELECT * FROM complaints WHERE id = ?");
            $stmt->bind_param('i', $id);
        }

        $stmt->execute();
        echo json_encode($stmt->get_result()->fetch_assoc());
        $stmt->close();

    } else {
        // ── All complaints — filtered by barangay ──
        if ($barangay_id) {
            $stmt = $db->prepare("
                SELECT * FROM complaints
                WHERE barangay_id = ? 
                ORDER BY date_filed DESC
            ");
            $stmt->bind_param('i', $barangay_id);
            $stmt->execute();
            $result = $stmt->get_result();
        } else {
            // no session — return all (fallback)
            $result = $db->query("SELECT * FROM complaints ORDER BY date_filed DESC");
        }

        $rows = [];
        while ($row = $result->fetch_assoc()) $rows[] = $row;
        echo json_encode($rows);
    }
    exit();
}

$db->close();