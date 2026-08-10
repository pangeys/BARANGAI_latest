<?php
error_reporting(0);
ini_set('display_errors', 0);

define('DB_HOST', 'sql113.infinityfree.com');
define('DB_USER', 'if0_42015849');
define('DB_PASS', 'thesisdemarizo');
define('DB_NAME', 'if0_42015849_bai');

function getDB() {
    $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
    if ($conn->connect_error) {
        http_response_code(500);
        if (!headers_sent()) {
            header('Content-Type: application/json');
        }
        die(json_encode(['error' => 'Database connection failed: ' . $conn->connect_error]));
    }
    $conn->set_charset('utf8mb4');
    return $conn;
}

/* ── Shared password strength rule ─────────────────────────────────
   Used everywhere a password is set: resident signup (auth.php),
   profile password change, and admin-created accounts (profile.php).
   Requires: 8+ characters, at least one uppercase, one lowercase,
   one number, and one special character.
   Returns '' if the password passes, or a user-facing error message
   naming exactly what's missing. */
function password_strength_error($pw) {
    if (strlen($pw) < 8)
        return 'Password must be at least 8 characters long.';
    if (!preg_match('/[A-Z]/', $pw))
        return 'Password must include at least one uppercase letter.';
    if (!preg_match('/[a-z]/', $pw))
        return 'Password must include at least one lowercase letter.';
    if (!preg_match('/[0-9]/', $pw))
        return 'Password must include at least one number.';
    if (!preg_match('/[^A-Za-z0-9]/', $pw))
        return 'Password must include at least one special character (e.g. ! @ # $ %).';
    return '';
}

$callingFile = basename($_SERVER['SCRIPT_FILENAME']);
if ($callingFile !== 'generate_report.php') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Content-Type: application/json');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(200);
        exit();
    }
} else {
    header('Access-Control-Allow-Origin: *');
}