/**
 * The password policy, as the client can check it.
 *
 * ── ONE STATEMENT OF THE RULES, NOT THREE ──────────────────────────────────
 *
 * The server's policy is `src/shared/security/password-policy.js`: twelve
 * characters, upper AND lower, a digit, a symbol, not the local part of the
 * email, not in the HIBP breach corpus. Every write goes through it — admin
 * create-user, admin set-password, self-service change, and the activation
 * link.
 *
 * The client used to state it three times and get it wrong twice. "Minimum 8
 * characters" was printed under both admin password fields and both submit
 * buttons gated on `length < 8`, so an administrator could type eight
 * characters, watch the form accept them, submit, and get back a 422 naming
 * five rules nobody had mentioned. Meanwhile `my-security` already mirrored the
 * real five.
 *
 * ── WHAT IS DELIBERATELY NOT MIRRORED ──────────────────────────────────────
 *
 * The breach check needs the HIBP range API, and the email-similarity check
 * belongs to the account being written rather than to whoever is typing. Both
 * stay server-side and come back as a named 422. This is a courtesy that stops
 * somebody guessing WHICH rule they missed — the server keeps the last word,
 * and a password that ticks every box here can still be refused.
 */

/** Mirrors MIN_LENGTH in shared/security/password-policy.js. */
export const PASSWORD_MIN_LENGTH = 12;

export function passwordRules(pw: string) {
  return [
    {
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      ok: pw.length >= PASSWORD_MIN_LENGTH,
    },
    {
      label: "An uppercase and a lowercase letter",
      ok: /[A-Z]/.test(pw) && /[a-z]/.test(pw),
    },
    { label: "A number", ok: /[0-9]/.test(pw) },
    { label: "A symbol", ok: /[^A-Za-z0-9]/.test(pw) },
  ];
}

/** Every rule this side can check. The server still has the last word. */
export const passwordMeetsPolicy = (pw: string) =>
  passwordRules(pw).every((r) => r.ok);
