<?php

require_once __DIR__ . '/config.php';


/*
 * Returns the raw 32-byte key used to encrypt
 * authenticator secrets.
 */
function get_2fa_encryption_key(): string
{
    $key = base64_decode(
        TWO_FACTOR_ENCRYPTION_KEY_B64,
        true
    );

    if ($key === false || strlen($key) !== 32) {
        throw new RuntimeException(
            'Invalid BarangAI 2FA encryption key.'
        );
    }

    return $key;
}


/*
 * Encrypt a TOTP secret before storing it
 * in users.two_factor_secret.
 *
 * AES-256-GCM provides both encryption and
 * integrity/authentication.
 */
function encrypt_2fa_secret(string $secret): string
{
    $key = get_2fa_encryption_key();

    // Recommended IV length for GCM
    $iv = random_bytes(12);

    $tag = '';

    $ciphertext = openssl_encrypt(
        $secret,
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag,
        '',
        16
    );

    if ($ciphertext === false) {
        throw new RuntimeException(
            'Could not encrypt 2FA secret.'
        );
    }

    /*
     * Stored format:
     *
     * IV (12 bytes)
     * +
     * Authentication tag (16 bytes)
     * +
     * Ciphertext
     *
     * Then Base64 encoded for database storage.
     */
    return base64_encode(
        $iv .
        $tag .
        $ciphertext
    );
}


/*
 * Decrypt a TOTP secret retrieved from
 * users.two_factor_secret.
 */
function decrypt_2fa_secret(string $storedValue): string
{
    $key = get_2fa_encryption_key();

    $raw = base64_decode(
        $storedValue,
        true
    );

    /*
     * Must contain at minimum:
     * 12-byte IV + 16-byte tag + ciphertext
     */
    if ($raw === false || strlen($raw) <= 28) {
        throw new RuntimeException(
            'Invalid encrypted 2FA secret.'
        );
    }

    $iv         = substr($raw, 0, 12);
    $tag        = substr($raw, 12, 16);
    $ciphertext = substr($raw, 28);

    $plaintext = openssl_decrypt(
        $ciphertext,
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag
    );

    if ($plaintext === false) {
        throw new RuntimeException(
            'Could not decrypt 2FA secret.'
        );
    }

    return $plaintext;
}