/* ── Shared password strength rule ────────────────────────────────
   Mirrors password_strength_error() in api/config.php exactly, so the
   user gets the same feedback instantly in the browser, before the
   request even reaches the server. The server-side check is still the
   real enforcement — this is just for a faster, friendlier experience.

   Requires: 8+ characters, at least one uppercase, one lowercase,
   one number, and one special character.
   Returns '' if the password passes, or an error message naming
   exactly what's missing. */
function passwordStrengthError(pw) {
  if (pw.length < 8)
    return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(pw))
    return 'Password must include at least one uppercase letter.';
  if (!/[a-z]/.test(pw))
    return 'Password must include at least one lowercase letter.';
  if (!/[0-9]/.test(pw))
    return 'Password must include at least one number.';
  if (!/[^A-Za-z0-9]/.test(pw))
    return 'Password must include at least one special character (e.g. ! @ # $ %).';
  return '';
}