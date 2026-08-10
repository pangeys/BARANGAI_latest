<?php
if (session_status() === PHP_SESSION_NONE) session_start();
require_once 'config.php';
require_once 'totp.php';
require_once 'security.php';

function out($ok, $data = [], $code = 200) {
    http_response_code($code);
    echo json_encode(['ok' => $ok] + $data);
    exit;
}

$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$action = $_GET['action'] ?? ($input['action'] ?? '');
$db     = getDB();

switch ($action) {

// ── LOGIN ──────────────────────────────────────────────────────────
case 'login':
    $identifier = trim($input['identifier'] ?? '');
    $password   = $input['password'] ?? '';

    if (!$identifier || !$password) {
        out(false, ['error' => 'Missing credentials'], 422);
    }

    $stmt = $db->prepare(
        'SELECT * FROM users WHERE (username = ? OR email = ?) LIMIT 1'
    );
    $stmt->bind_param('ss', $identifier, $identifier);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        out(false, ['error' => 'Invalid username/email or password'], 401);
    }

    if ($user['status'] === 'pending') {
        out(false, [
            'error' => 'Your account is awaiting approval from your barangay office. Please check back later.'
        ], 403);
    }

    if ($user['status'] !== 'active') {
        out(false, [
            'error' => 'Your account has been disabled. Please contact your barangay office.'
        ], 403);
    }

    $prevLogin = $user['last_login'] ?? null;

    $brgyName = '';
    if ($user['barangay_id']) {
        $s = $db->prepare('SELECT name FROM barangays WHERE id = ?');
        $s->bind_param('i', $user['barangay_id']);
        $s->execute();
        $row = $s->get_result()->fetch_assoc();
        $brgyName = $row ? $row['name'] : '';
        $s->close();
    }

    /*
     * ADMIN 2FA GATE — STAGE 1
     *
     * A correct admin password is only authentication factor #1.
     * Do NOT create $_SESSION['user'] yet.
     */
    if ($user['role'] === 'admin') {
        unset($_SESSION['user']);
        unset($_SESSION['pending_2fa']);

        session_regenerate_id(true);

        $_SESSION['pending_2fa'] = [
            'user_id'     => (int)$user['id'],
            'started_at'  => time(),
            'remember_me' => (bool)($input['remember_me'] ?? false),
            'prev_login'  => $prevLogin,
            'attempts'    => 0,
        ];

        out(true, [
            'role'                => 'admin',
            'name'                => $user['full_name'],
            'profile_completed'   => (int)($user['profile_completed'] ?? 0),
            'last_login'          => $prevLogin,
            'requires_2fa'        => true,
            'enrollment_required' => (int)($user['two_factor_enabled'] ?? 0) !== 1,
        ]);
    }

    // Resident login continues with the existing flow.
    unset($_SESSION['pending_2fa']);

    $upd = $db->prepare(
        'UPDATE users
         SET last_login = NOW(), login_count = login_count + 1
         WHERE id = ?'
    );
    $upd->bind_param('i', $user['id']);
    $upd->execute();
    $upd->close();

    session_regenerate_id(true);

    $_SESSION['user'] = [
        'id'          => (int)$user['id'],
        'name'        => $user['full_name'],
        'role'        => $user['role'],
        'barangay_id' => (int)$user['barangay_id'],
        'barangay'    => $brgyName,
    ];

    $rememberMe = (bool)($input['remember_me'] ?? false);

    if ($rememberMe) {
        $cookieParams = session_get_cookie_params();

        setcookie(session_name(), session_id(), [
            'expires'  => time() + (30 * 24 * 60 * 60),
            'path'     => $cookieParams['path'],
            'domain'   => $cookieParams['domain'],
            'secure'   => $cookieParams['secure'],
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    $ip = $_SERVER['REMOTE_ADDR'] ?? null;

    $alog = $db->prepare(
        'INSERT INTO activity_log
            (user_id, user_name, barangay_id, action, detail, ip_address)
         VALUES (?, ?, ?, "login", "Signed in", ?)'
    );

    $uid = (int)$user['id'];
    $un  = $user['full_name'];
    $bid = (int)$user['barangay_id'];

    $alog->bind_param('isis', $uid, $un, $bid, $ip);
    $alog->execute();
    $alog->close();

    out(true, [
        'role'              => $user['role'],
        'name'              => $user['full_name'],
        'profile_completed' => (int)($user['profile_completed'] ?? 0),
        'last_login'        => $prevLogin,
        'requires_2fa'      => false,
    ]);




// ── VERIFY NORMAL ADMIN 2FA LOGIN ──────────────────────────────────
case 'verify_2fa_login':

    $code = preg_replace('/\D/', '', (string)($input['code'] ?? ''));

    if (strlen($code) !== 6) {
        out(false, [
            'error' => 'Enter the 6-digit code from your authenticator app.'
        ], 422);
    }

    $pending = $_SESSION['pending_2fa'] ?? null;

    if (
        !$pending ||
        empty($pending['user_id']) ||
        empty($pending['started_at'])
    ) {
        out(false, [
            'error' => 'Your 2FA login session is missing. Please sign in again.'
        ], 401);
    }

    // Password verification is valid for 10 minutes.
    if ((time() - (int)$pending['started_at']) > 600) {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'Your 2FA login session expired. Please sign in again.'
        ], 401);
    }

    $attempts = (int)($pending['attempts'] ?? 0);

    if ($attempts >= 5) {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'Too many invalid 2FA attempts. Please sign in again.'
        ], 429);
    }

    $pendingUserId = (int)$pending['user_id'];

    $stmt = $db->prepare(
        'SELECT id, full_name, role, status, barangay_id,
                profile_completed, two_factor_enabled,
                two_factor_secret, two_factor_last_used_step
         FROM users
         WHERE id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $pendingUserId);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (
        !$user ||
        $user['role'] !== 'admin' ||
        $user['status'] !== 'active'
    ) {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'This account cannot complete administrator 2FA login.'
        ], 403);
    }

    if (
        (int)$user['two_factor_enabled'] !== 1 ||
        empty($user['two_factor_secret'])
    ) {
        out(false, [
            'error' => 'Two-factor authentication is not fully configured for this administrator.'
        ], 409);
    }

    try {
        $secret = decrypt_2fa_secret(
            (string)$user['two_factor_secret']
        );
    } catch (Throwable $e) {
        out(false, [
            'error' => 'The stored 2FA configuration could not be read.'
        ], 500);
    }

    $lastUsedStep = null;

    if ($user['two_factor_last_used_step'] !== null) {
        $lastUsedStep = (int)$user['two_factor_last_used_step'];
    }

    $matchedStep = totp_verify_code(
        $secret,
        $code,
        1,
        $lastUsedStep
    );

    if ($matchedStep === false) {

        $_SESSION['pending_2fa']['attempts'] = $attempts + 1;

        // Best-effort audit log for failed 2FA verification.
        try {
            $ip = $_SERVER['REMOTE_ADDR'] ?? null;
            $uid = (int)$user['id'];
            $un = (string)$user['full_name'];
            $bid = (int)$user['barangay_id'];

            $alog = $db->prepare(
                'INSERT INTO activity_log
                    (user_id, user_name, barangay_id, action, detail, ip_address)
                 VALUES (?, ?, ?, "two_factor_failed",
                         "Invalid authenticator code during login", ?)'
            );
            $alog->bind_param('isis', $uid, $un, $bid, $ip);
            $alog->execute();
            $alog->close();
        } catch (Throwable $ignored) {}

        $remaining = max(
            0,
            5 - (int)$_SESSION['pending_2fa']['attempts']
        );

        out(false, [
            'error' => 'Invalid or expired authenticator code.',
            'attempts_remaining' => $remaining
        ], 401);
    }

    // Load barangay name for the authenticated session.
    $brgyName = '';

    if ($user['barangay_id']) {
        $s = $db->prepare(
            'SELECT name FROM barangays WHERE id = ? LIMIT 1'
        );
        $s->bind_param('i', $user['barangay_id']);
        $s->execute();
        $row = $s->get_result()->fetch_assoc();
        $brgyName = $row ? $row['name'] : '';
        $s->close();
    }

    $prevLogin = $pending['prev_login'] ?? null;
    $rememberMe = (bool)($pending['remember_me'] ?? false);

    try {
        $db->begin_transaction();

        $step = (int)$matchedStep;

        $upd = $db->prepare(
            'UPDATE users
             SET two_factor_last_used_step = ?,
                 last_login = NOW(),
                 login_count = login_count + 1
             WHERE id = ?
               AND two_factor_enabled = 1'
        );
        $upd->bind_param('ii', $step, $pendingUserId);
        $upd->execute();

        if ($upd->affected_rows !== 1) {
            $upd->close();
            throw new RuntimeException(
                'Could not complete the administrator login.'
            );
        }

        $upd->close();

        $ip = $_SERVER['REMOTE_ADDR'] ?? null;
        $uid = (int)$user['id'];
        $un = (string)$user['full_name'];
        $bid = (int)$user['barangay_id'];

        $alog = $db->prepare(
            'INSERT INTO activity_log
                (user_id, user_name, barangay_id, action, detail, ip_address)
             VALUES (?, ?, ?, "two_factor_verified",
                     "Authenticator code verified during login", ?)'
        );
        $alog->bind_param('isis', $uid, $un, $bid, $ip);
        $alog->execute();
        $alog->close();

        $loginLog = $db->prepare(
            'INSERT INTO activity_log
                (user_id, user_name, barangay_id, action, detail, ip_address)
             VALUES (?, ?, ?, "login", "Signed in with 2FA", ?)'
        );
        $loginLog->bind_param('isis', $uid, $un, $bid, $ip);
        $loginLog->execute();
        $loginLog->close();

        $db->commit();

    } catch (Throwable $e) {
        try { $db->rollback(); } catch (Throwable $ignored) {}

        out(false, [
            'error' => 'Could not complete the administrator login.'
        ], 500);
    }

    /*
     * The administrator is fully authenticated only NOW:
     * password + TOTP have both succeeded.
     */
    unset($_SESSION['pending_2fa']);
    unset($_SESSION['pending_2fa_enrollment']);

    session_regenerate_id(true);

    $_SESSION['user'] = [
        'id'          => (int)$user['id'],
        'name'        => $user['full_name'],
        'role'        => $user['role'],
        'barangay_id' => (int)$user['barangay_id'],
        'barangay'    => $brgyName,
    ];

    if ($rememberMe) {
        $cookieParams = session_get_cookie_params();

        setcookie(session_name(), session_id(), [
            'expires'  => time() + (30 * 24 * 60 * 60),
            'path'     => $cookieParams['path'],
            'domain'   => $cookieParams['domain'],
            'secure'   => $cookieParams['secure'],
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    out(true, [
        'authenticated'     => true,
        'role'              => 'admin',
        'name'              => $user['full_name'],
        'profile_completed' => (int)($user['profile_completed'] ?? 0),
        'last_login'        => $prevLogin,
        'requires_2fa'      => false,
    ]);



// ── VERIFY ADMIN RECOVERY CODE LOGIN ───────────────────────────────
case 'verify_2fa_recovery':

    $recoveryCode = strtoupper(
        preg_replace('/[^A-Za-z0-9]/', '', (string)($input['recovery_code'] ?? ''))
    );

    if (strlen($recoveryCode) !== 10) {
        out(false, [
            'error' => 'Enter a valid BarangAI recovery code.'
        ], 422);
    }

    $pending = $_SESSION['pending_2fa'] ?? null;

    if (
        !$pending ||
        empty($pending['user_id']) ||
        empty($pending['started_at'])
    ) {
        out(false, [
            'error' => 'Your 2FA login session is missing. Please sign in again.'
        ], 401);
    }

    if ((time() - (int)$pending['started_at']) > 600) {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'Your 2FA login session expired. Please sign in again.'
        ], 401);
    }

    $attempts = (int)($pending['attempts'] ?? 0);

    if ($attempts >= 5) {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'Too many invalid 2FA attempts. Please sign in again.'
        ], 429);
    }

    $pendingUserId = (int)$pending['user_id'];

    $stmt = $db->prepare(
        'SELECT id, full_name, role, status, barangay_id, profile_completed,
                two_factor_enabled
         FROM users
         WHERE id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $pendingUserId);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (
        !$user ||
        $user['role'] !== 'admin' ||
        $user['status'] !== 'active' ||
        (int)$user['two_factor_enabled'] !== 1
    ) {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'This account cannot use a 2FA recovery code.'
        ], 403);
    }

    // Load all unused recovery-code hashes for this administrator.
    $codesStmt = $db->prepare(
        'SELECT id, code_hash
         FROM user_recovery_codes
         WHERE user_id = ?
           AND used_at IS NULL
         ORDER BY id ASC'
    );
    $codesStmt->bind_param('i', $pendingUserId);
    $codesStmt->execute();
    $result = $codesStmt->get_result();

    $matchedId = 0;

    while ($row = $result->fetch_assoc()) {
        if (password_verify($recoveryCode, $row['code_hash'])) {
            $matchedId = (int)$row['id'];
            break;
        }
    }

    $codesStmt->close();

    if ($matchedId === 0) {

        $_SESSION['pending_2fa']['attempts'] = $attempts + 1;

        // Best-effort audit log for a failed recovery-code attempt.
        try {
            $ip = $_SERVER['REMOTE_ADDR'] ?? null;
            $uid = (int)$user['id'];
            $un = (string)$user['full_name'];
            $bid = (int)$user['barangay_id'];

            $alog = $db->prepare(
                'INSERT INTO activity_log
                    (user_id, user_name, barangay_id, action, detail, ip_address)
                 VALUES (?, ?, ?, "two_factor_failed",
                         "Invalid recovery code during login", ?)'
            );
            $alog->bind_param('isis', $uid, $un, $bid, $ip);
            $alog->execute();
            $alog->close();
        } catch (Throwable $ignored) {}

        $remainingAttempts = max(
            0,
            5 - (int)$_SESSION['pending_2fa']['attempts']
        );

        out(false, [
            'error' => 'Invalid or already-used recovery code.',
            'attempts_remaining' => $remainingAttempts
        ], 401);
    }

    // Load barangay name for the authenticated session.
    $brgyName = '';

    if ($user['barangay_id']) {
        $s = $db->prepare(
            'SELECT name FROM barangays WHERE id = ? LIMIT 1'
        );
        $s->bind_param('i', $user['barangay_id']);
        $s->execute();
        $row = $s->get_result()->fetch_assoc();
        $brgyName = $row ? $row['name'] : '';
        $s->close();
    }

    $prevLogin = $pending['prev_login'] ?? null;
    $rememberMe = (bool)($pending['remember_me'] ?? false);

    try {
        $db->begin_transaction();

        // Consume the recovery code exactly once.
        $use = $db->prepare(
            'UPDATE user_recovery_codes
             SET used_at = NOW()
             WHERE id = ?
               AND user_id = ?
               AND used_at IS NULL'
        );
        $use->bind_param('ii', $matchedId, $pendingUserId);
        $use->execute();

        if ($use->affected_rows !== 1) {
            $use->close();
            throw new RuntimeException(
                'The recovery code has already been used.'
            );
        }

        $use->close();

        $upd = $db->prepare(
            'UPDATE users
             SET last_login = NOW(),
                 login_count = login_count + 1
             WHERE id = ?
               AND two_factor_enabled = 1'
        );
        $upd->bind_param('i', $pendingUserId);
        $upd->execute();

        if ($upd->affected_rows !== 1) {
            $upd->close();
            throw new RuntimeException(
                'Could not complete recovery-code login.'
            );
        }

        $upd->close();

        $ip = $_SERVER['REMOTE_ADDR'] ?? null;
        $uid = (int)$user['id'];
        $un = (string)$user['full_name'];
        $bid = (int)$user['barangay_id'];

        $recoveryLog = $db->prepare(
            'INSERT INTO activity_log
                (user_id, user_name, barangay_id, action, detail, ip_address)
             VALUES (?, ?, ?, "recovery_code_used",
                     "Single-use 2FA recovery code used during login", ?)'
        );
        $recoveryLog->bind_param('isis', $uid, $un, $bid, $ip);
        $recoveryLog->execute();
        $recoveryLog->close();

        $loginLog = $db->prepare(
            'INSERT INTO activity_log
                (user_id, user_name, barangay_id, action, detail, ip_address)
             VALUES (?, ?, ?, "login",
                     "Signed in with 2FA recovery code", ?)'
        );
        $loginLog->bind_param('isis', $uid, $un, $bid, $ip);
        $loginLog->execute();
        $loginLog->close();

        $countStmt = $db->prepare(
            'SELECT COUNT(*) AS remaining
             FROM user_recovery_codes
             WHERE user_id = ?
               AND used_at IS NULL'
        );
        $countStmt->bind_param('i', $pendingUserId);
        $countStmt->execute();
        $remainingRow = $countStmt->get_result()->fetch_assoc();
        $remainingCodes = (int)($remainingRow['remaining'] ?? 0);
        $countStmt->close();

        $db->commit();

    } catch (Throwable $e) {
        try { $db->rollback(); } catch (Throwable $ignored) {}

        out(false, [
            'error' => 'Could not complete recovery-code login.'
        ], 500);
    }

    unset($_SESSION['pending_2fa']);
    unset($_SESSION['pending_2fa_enrollment']);

    session_regenerate_id(true);

    $_SESSION['user'] = [
        'id'          => (int)$user['id'],
        'name'        => $user['full_name'],
        'role'        => $user['role'],
        'barangay_id' => (int)$user['barangay_id'],
        'barangay'    => $brgyName,
    ];

    if ($rememberMe) {
        $cookieParams = session_get_cookie_params();

        setcookie(session_name(), session_id(), [
            'expires'  => time() + (30 * 24 * 60 * 60),
            'path'     => $cookieParams['path'],
            'domain'   => $cookieParams['domain'],
            'secure'   => $cookieParams['secure'],
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    out(true, [
        'authenticated'            => true,
        'role'                     => 'admin',
        'name'                     => $user['full_name'],
        'profile_completed'        => (int)($user['profile_completed'] ?? 0),
        'last_login'               => $prevLogin,
        'requires_2fa'             => false,
        'recovery_code_used'       => true,
        'recovery_codes_remaining' => $remainingCodes,
    ]);


// ── BEGIN ADMIN 2FA ENROLLMENT ─────────────────────────────────────
case 'begin_2fa_enrollment':

    // A correct admin password must have been verified first.
    $pending = $_SESSION['pending_2fa'] ?? null;

    if (!$pending || empty($pending['user_id']) || empty($pending['started_at'])) {
        out(false, [
            'error' => 'Your 2FA setup session is missing. Please sign in again.'
        ], 401);
    }

    // Keep the password-verified staging session short-lived.
    if ((time() - (int)$pending['started_at']) > 600) {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'Your 2FA setup session expired. Please sign in again.'
        ], 401);
    }

    $pendingUserId = (int)$pending['user_id'];

    $stmt = $db->prepare(
        'SELECT id, full_name, email, username, role, status,
                two_factor_enabled
         FROM users
         WHERE id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $pendingUserId);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$user || $user['role'] !== 'admin' || $user['status'] !== 'active') {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'This account cannot enroll in administrator 2FA.'
        ], 403);
    }

    if ((int)$user['two_factor_enabled'] === 1) {
        out(false, [
            'error' => 'Two-factor authentication is already enabled for this account.'
        ], 409);
    }

    /*
     * Reuse the same temporary secret during this browser session so
     * accidental refreshes do not create multiple Authenticator entries.
     */
    $enrollment = $_SESSION['pending_2fa_enrollment'] ?? null;

    if (
        !$enrollment ||
        (int)($enrollment['user_id'] ?? 0) !== $pendingUserId ||
        empty($enrollment['secret']) ||
        (time() - (int)($enrollment['created_at'] ?? 0)) > 600
    ) {
        $secret = totp_generate_secret();

        $_SESSION['pending_2fa_enrollment'] = [
            'user_id'    => $pendingUserId,
            'secret'     => $secret,
            'created_at' => time(),
        ];
    } else {
        $secret = $enrollment['secret'];
    }

    $accountName = trim((string)($user['email'] ?? ''));

    if ($accountName === '') {
        $accountName = trim((string)($user['username'] ?? ''));
    }

    if ($accountName === '') {
        $accountName = 'admin-' . $pendingUserId;
    }

    $setupKeyGrouped = trim(
        chunk_split($secret, 4, ' ')
    );

    out(true, [
        'enrollment_ready' => true,
        'issuer'           => 'BarangAI',
        'account'          => $accountName,
        'setup_key'        => $setupKeyGrouped,
        'otpauth_uri'      => totp_build_uri(
            $secret,
            $accountName,
            'BarangAI'
        ),
        'expires_in'       => 600,
    ]);



// ── VERIFY ADMIN 2FA ENROLLMENT CODE ───────────────────────────────
case 'verify_2fa_enrollment_code':

    $code = trim((string)($input['code'] ?? ''));

    if ($code === '') {
        out(false, [
            'error' => 'Enter the 6-digit code from your authenticator app.'
        ], 422);
    }

    $pending = $_SESSION['pending_2fa'] ?? null;
    $enrollment = $_SESSION['pending_2fa_enrollment'] ?? null;

    if (
        !$pending ||
        empty($pending['user_id']) ||
        empty($pending['started_at'])
    ) {
        out(false, [
            'error' => 'Your password-verification session is missing. Please sign in again.'
        ], 401);
    }

    if ((time() - (int)$pending['started_at']) > 600) {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'Your 2FA setup session expired. Please sign in again.'
        ], 401);
    }

    $pendingUserId = (int)$pending['user_id'];

    if (
        !$enrollment ||
        (int)($enrollment['user_id'] ?? 0) !== $pendingUserId ||
        empty($enrollment['secret']) ||
        empty($enrollment['created_at'])
    ) {
        out(false, [
            'error' => 'No pending Authenticator setup was found. Generate a new setup key first.'
        ], 400);
    }

    if ((time() - (int)$enrollment['created_at']) > 600) {
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'The temporary Authenticator setup key expired. Generate a new one.'
        ], 401);
    }

    $stmt = $db->prepare(
        'SELECT id, role, status, two_factor_enabled
         FROM users
         WHERE id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $pendingUserId);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$user || $user['role'] !== 'admin' || $user['status'] !== 'active') {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'This account cannot complete administrator 2FA enrollment.'
        ], 403);
    }

    if ((int)$user['two_factor_enabled'] === 1) {
        out(false, [
            'error' => 'Two-factor authentication is already enabled for this account.'
        ], 409);
    }

    /*
     * This phase ONLY verifies that the authenticator app and BarangAI
     * generate the same TOTP code. It intentionally does NOT write the
     * secret to the database yet.
     */
    $matchedStep = totp_verify_code(
        $enrollment['secret'],
        $code,
        1,
        null
    );

    if ($matchedStep === false) {
        out(false, [
            'error' => 'Invalid or expired authenticator code. Wait for a fresh code and try again.'
        ], 401);
    }

    $_SESSION['pending_2fa_enrollment']['verified_at'] = time();
    $_SESSION['pending_2fa_enrollment']['verified_step'] = (int)$matchedStep;

    out(true, [
        'verification_passed' => true,
        'database_changed'    => false,
        'ready_to_activate'   => true,
        'message'             => 'Authenticator code verified successfully.'
    ]);



// ── ACTIVATE ADMIN 2FA + CREATE RECOVERY CODES ─────────────────────
case 'activate_2fa':

    $pending = $_SESSION['pending_2fa'] ?? null;
    $enrollment = $_SESSION['pending_2fa_enrollment'] ?? null;

    if (
        !$pending ||
        empty($pending['user_id']) ||
        empty($pending['started_at']) ||
        !$enrollment
    ) {
        out(false, [
            'error' => 'Your 2FA enrollment session is missing. Please start again.'
        ], 401);
    }

    $pendingUserId = (int)$pending['user_id'];

    if (
        (int)($enrollment['user_id'] ?? 0) !== $pendingUserId ||
        empty($enrollment['secret']) ||
        empty($enrollment['created_at']) ||
        empty($enrollment['verified_at']) ||
        !isset($enrollment['verified_step'])
    ) {
        out(false, [
            'error' => 'The Authenticator setup has not been verified yet.'
        ], 400);
    }

    // Password + enrollment session must still be recent.
    if (
        (time() - (int)$pending['started_at']) > 600 ||
        (time() - (int)$enrollment['created_at']) > 600 ||
        (time() - (int)$enrollment['verified_at']) > 600
    ) {
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['pending_2fa_enrollment']);

        out(false, [
            'error' => 'Your 2FA enrollment session expired. Please start again.'
        ], 401);
    }

    $stmt = $db->prepare(
        'SELECT id, full_name, role, status, barangay_id, two_factor_enabled
         FROM users
         WHERE id = ?
         LIMIT 1'
    );
    $stmt->bind_param('i', $pendingUserId);
    $stmt->execute();
    $user = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    if (!$user || $user['role'] !== 'admin' || $user['status'] !== 'active') {
        out(false, [
            'error' => 'This account cannot activate administrator 2FA.'
        ], 403);
    }

    if ((int)$user['two_factor_enabled'] === 1) {
        out(false, [
            'error' => 'Two-factor authentication is already enabled for this account.'
        ], 409);
    }

    try {
        $encryptedSecret = encrypt_2fa_secret(
            (string)$enrollment['secret']
        );

        $verifiedStep = (int)$enrollment['verified_step'];

        // Generate eight single-use recovery codes.
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $recoveryCodes = [];

        for ($i = 0; $i < 8; $i++) {
            $plain = '';

            for ($j = 0; $j < 10; $j++) {
                $plain .= $alphabet[
                    random_int(0, strlen($alphabet) - 1)
                ];
            }

            $recoveryCodes[] =
                substr($plain, 0, 5) . '-' . substr($plain, 5, 5);
        }

        $db->begin_transaction();

        $upd = $db->prepare(
            'UPDATE users
             SET two_factor_enabled = 1,
                 two_factor_secret = ?,
                 two_factor_confirmed_at = NOW(),
                 two_factor_last_used_step = ?
             WHERE id = ?
               AND two_factor_enabled = 0'
        );
        $upd->bind_param(
            'sii',
            $encryptedSecret,
            $verifiedStep,
            $pendingUserId
        );
        $upd->execute();

        if ($upd->affected_rows !== 1) {
            $upd->close();
            throw new RuntimeException(
                'Could not activate 2FA for this account.'
            );
        }

        $upd->close();

        // Replace any stale recovery-code rows for this user.
        $del = $db->prepare(
            'DELETE FROM user_recovery_codes WHERE user_id = ?'
        );
        $del->bind_param('i', $pendingUserId);
        $del->execute();
        $del->close();

        $ins = $db->prepare(
            'INSERT INTO user_recovery_codes
                (user_id, code_hash)
             VALUES (?, ?)'
        );

        foreach ($recoveryCodes as $displayCode) {
            $normalized = str_replace('-', '', strtoupper($displayCode));
            $hash = password_hash($normalized, PASSWORD_DEFAULT);

            if ($hash === false) {
                $ins->close();
                throw new RuntimeException(
                    'Could not secure recovery codes.'
                );
            }

            $ins->bind_param(
                'is',
                $pendingUserId,
                $hash
            );

            if (!$ins->execute()) {
                $ins->close();
                throw new RuntimeException(
                    'Could not save recovery codes.'
                );
            }
        }

        $ins->close();

        // Record successful 2FA enrollment in the audit log.
        $ip = $_SERVER['REMOTE_ADDR'] ?? null;
        $uid = (int)$user['id'];
        $un = (string)$user['full_name'];
        $bid = (int)$user['barangay_id'];

        $alog = $db->prepare(
            'INSERT INTO activity_log
                (user_id, user_name, barangay_id, action, detail, ip_address)
             VALUES (?, ?, ?, "two_factor_enrolled",
                     "Authenticator-app 2FA enabled", ?)'
        );
        $alog->bind_param('isis', $uid, $un, $bid, $ip);
        $alog->execute();
        $alog->close();

        $db->commit();

        // The recovery codes are returned only once.
        // The database stores only password hashes.
        unset($_SESSION['pending_2fa_enrollment']);
        unset($_SESSION['pending_2fa']);
        unset($_SESSION['user']);

        out(true, [
            'two_factor_enabled' => true,
            'recovery_codes'     => $recoveryCodes,
            'message'            => 'Two-factor authentication is now enabled. Save your recovery codes before continuing.'
        ]);

    } catch (Throwable $e) {
        if ($db->errno === 0 || $db->errno !== 0) {
            // rollback() is safe here when a transaction is active.
            try { $db->rollback(); } catch (Throwable $ignored) {}
        }

        out(false, [
            'error' => '2FA activation failed. No activation was completed.'
        ], 500);
    }


// ── SIGN UP (residents only) ───────────────────────────────────────
case 'signup':
    $name    = trim($input['full_name'] ?? '');
    $email   = trim($input['email'] ?? '');
    $pw      = $input['password'] ?? '';
    $brgy_id = (int)($input['barangay_id'] ?? 0);
    $phone   = trim($input['phone'] ?? '');
    $address = trim($input['address'] ?? '');

    if (!$name || !$email || $brgy_id <= 0) {
        out(false, ['error' => 'Please fill all required fields.'], 422);
    }

    $pwError = password_strength_error($pw);

    if ($pwError) {
        out(false, ['error' => $pwError], 422);
    }

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        out(false, ['error' => 'Invalid email address.'], 422);
    }

    $chk = $db->prepare('SELECT id FROM users WHERE email = ?');
    $chk->bind_param('s', $email);
    $chk->execute();
    $chk->store_result();

    if ($chk->num_rows > 0) {
        $chk->close();
        out(false, ['error' => 'Email already registered.'], 409);
    }

    $chk->close();

    $hash = password_hash($pw, PASSWORD_DEFAULT);

    $ins = $db->prepare(
        'INSERT INTO users
            (full_name, email, password_hash, role, barangay_id, phone, address, status)
         VALUES (?, ?, ?, "resident", ?, ?, ?, "pending")'
    );

    $ins->bind_param(
        'sssiss',
        $name,
        $email,
        $hash,
        $brgy_id,
        $phone,
        $address
    );

    if ($ins->execute()) {
        $ins->close();

        out(true, [
            'message' => 'Account created! A barangay official will review and approve your account before you can sign in.'
        ]);
    }

    $error = $ins->error;
    $ins->close();

    out(false, ['error' => 'Registration failed: ' . $error], 500);


// ── BARANGAY LIST (for signup dropdown) ───────────────────────────
case 'barangays':
    $result = $db->query('SELECT id, name FROM barangays ORDER BY name');
    $list   = [];

    while ($row = $result->fetch_assoc()) {
        $list[] = $row;
    }

    out(true, ['barangays' => $list]);


// ── SESSION CHECK ──────────────────────────────────────────────────
case 'me':
    out(true, ['user' => $_SESSION['user'] ?? null]);


// ── LOGOUT ────────────────────────────────────────────────────────
case 'logout':
    $_SESSION = [];
    session_destroy();
    out(true);


default:
    out(false, ['error' => 'Unknown action.'], 400);
}