<?php

/*
 * BarangAI TOTP Engine
 * --------------------
 * Standalone RFC-style TOTP implementation.
 * No Composer or external PHP package required.
 *
 * Used for:
 * - Generating authenticator secrets
 * - Generating 6-digit TOTP codes
 * - Verifying authenticator codes
 * - Building otpauth:// setup URIs
 */


/* ═════════════════════════════════════════════════════
   BASE32 ENCODE
   Converts random binary data into the format expected
   by Google Authenticator / Microsoft Authenticator.
═════════════════════════════════════════════════════ */
function base32_encode_bai(string $data): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    $bits = '';

    for ($i = 0; $i < strlen($data); $i++) {
        $bits .= str_pad(
            decbin(ord($data[$i])),
            8,
            '0',
            STR_PAD_LEFT
        );
    }

    $encoded = '';

    for ($i = 0; $i < strlen($bits); $i += 5) {

        $chunk = substr($bits, $i, 5);

        if (strlen($chunk) < 5) {
            $chunk = str_pad($chunk, 5, '0');
        }

        $encoded .= $alphabet[bindec($chunk)];
    }

    return $encoded;
}


/* ═════════════════════════════════════════════════════
   BASE32 DECODE
═════════════════════════════════════════════════════ */
function base32_decode_bai(string $secret): string
{
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    $secret = strtoupper($secret);
    $secret = str_replace(
        [' ', '-', '='],
        '',
        $secret
    );

    $bits = '';

    for ($i = 0; $i < strlen($secret); $i++) {

        $value = strpos($alphabet, $secret[$i]);

        if ($value === false) {
            throw new Exception('Invalid Base32 secret.');
        }

        $bits .= str_pad(
            decbin($value),
            5,
            '0',
            STR_PAD_LEFT
        );
    }

    $decoded = '';

    for ($i = 0; $i + 8 <= strlen($bits); $i += 8) {

        $byte = substr($bits, $i, 8);

        $decoded .= chr(bindec($byte));
    }

    return $decoded;
}


/* ═════════════════════════════════════════════════════
   GENERATE NEW SECRET
   20 bytes = 160-bit secret
═════════════════════════════════════════════════════ */
function totp_generate_secret(): string
{
    return base32_encode_bai(
        random_bytes(20)
    );
}


/* ═════════════════════════════════════════════════════
   HOTP CORE
═════════════════════════════════════════════════════ */
function hotp_generate(
    string $secret,
    int $counter,
    int $digits = 6
): string {

    $binarySecret = base32_decode_bai($secret);

    /*
     * HOTP uses an unsigned 64-bit counter in
     * big-endian byte order.
     */
    $high = intdiv($counter, 4294967296);
    $low  = $counter % 4294967296;

    $counterBytes = pack(
        'N2',
        $high,
        $low
    );

    $hash = hash_hmac(
        'sha1',
        $counterBytes,
        $binarySecret,
        true
    );

    /*
     * Dynamic truncation
     */
    $offset = ord(
        $hash[strlen($hash) - 1]
    ) & 0x0F;

    $binary =
        ((ord($hash[$offset])     & 0x7F) << 24) |
        ((ord($hash[$offset + 1]) & 0xFF) << 16) |
        ((ord($hash[$offset + 2]) & 0xFF) << 8)  |
        ( ord($hash[$offset + 3]) & 0xFF);

    $otp = $binary % (10 ** $digits);

    return str_pad(
        (string)$otp,
        $digits,
        '0',
        STR_PAD_LEFT
    );
}


/* ═════════════════════════════════════════════════════
   GENERATE CURRENT TOTP
═════════════════════════════════════════════════════ */
function totp_generate_code(
    string $secret,
    ?int $timestamp = null,
    int $period = 30,
    int $digits = 6
): string {

    $timestamp = $timestamp ?? time();

    $counter = intdiv(
        $timestamp,
        $period
    );

    return hotp_generate(
        $secret,
        $counter,
        $digits
    );
}


/* ═════════════════════════════════════════════════════
   VERIFY TOTP CODE

   Returns:
   - matched time-step number when valid
   - false when invalid

   $window = 1 allows:
   previous 30 sec
   current 30 sec
   next 30 sec

   This accommodates small clock differences.
═════════════════════════════════════════════════════ */
function totp_verify_code(
    string $secret,
    string $code,
    int $window = 1,
    ?int $lastUsedStep = null
) {

    $code = preg_replace(
        '/\D/',
        '',
        $code
    );

    if (strlen($code) !== 6) {
        return false;
    }

    $currentStep = intdiv(
        time(),
        30
    );

    for ($offset = -$window; $offset <= $window; $offset++) {

        $step = $currentStep + $offset;

        /*
         * Reject codes from a time-step that was
         * already successfully used.
         */
        if (
            $lastUsedStep !== null &&
            $step <= $lastUsedStep
        ) {
            continue;
        }

        $expected = hotp_generate(
            $secret,
            $step,
            6
        );

        if (
            hash_equals(
                $expected,
                $code
            )
        ) {
            return $step;
        }
    }

    return false;
}


/* ═════════════════════════════════════════════════════
   AUTHENTICATOR SETUP URI

   Example conceptually:

   otpauth://totp/
   BarangAI:admin@example.com
   ?secret=XXXX
   &issuer=BarangAI
═════════════════════════════════════════════════════ */
function totp_build_uri(
    string $secret,
    string $accountName,
    string $issuer = 'BarangAI'
): string {

    $label = rawurlencode(
        $issuer . ':' . $accountName
    );

    return
        'otpauth://totp/' . $label .
        '?secret=' . rawurlencode($secret) .
        '&issuer=' . rawurlencode($issuer) .
        '&algorithm=SHA1' .
        '&digits=6' .
        '&period=30';
}