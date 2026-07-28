/**
 * Shared password-strength policy — the single source of truth for what counts
 * as an acceptable password across the app (self-service reset, admin
 * create-user, and admin set-password all call assertStrongPassword()).
 *
 * Policy (decided, doc/PLAN_AUTH_UI_PWA_NOTIFICATIONS.md §1.2):
 *   - min 12 chars, must include lower + upper + digit + symbol
 *   - must not contain the local-part of the user's email
 *   - must not appear in the Have I Been Pwned breach corpus
 *
 * The breach check uses HIBP's k-anonymity range API: we send only the first 5
 * hex chars of the password's SHA-1 and compare the returned suffixes locally,
 * so the full hash (let alone the password) never leaves this process. If HIBP
 * is unreachable we FAIL OPEN (allow) and let the caller log it — a third-party
 * outage must never block a legitimate password reset.
 */
"use strict";

const crypto = require("crypto");
const { AppError } = require("../../utils/errors");

const MIN_LENGTH = 12;
const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

/**
 * @returns {Promise<{checked: boolean, pwned: boolean}>} `checked:false` means
 * HIBP was unreachable (fail-open); callers may log that a breach check was
 * skipped, but should not reject the password on that basis alone.
 */
async function checkBreached(password) {
  const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    // "Add-Padding" asks HIBP to pad the response so its size can't hint at the
    // number of matches (extra defence-in-depth for the k-anonymity model).
    const res = await fetch(HIBP_RANGE_URL + prefix, { headers: { "Add-Padding": "true" } });
    if (!res || !res.ok) return { checked: false, pwned: false };
    const body = await res.text();
    const pwned = body.split("\n").some((line) => {
      const [hashSuffix, count] = line.split(":");
      return hashSuffix.trim().toUpperCase() === suffix && Number(count) > 0;
    });
    return { checked: true, pwned };
  } catch {
    return { checked: false, pwned: false };
  }
}

/**
 * Throws AppError (422) when the password fails policy; otherwise resolves to
 * `{ breachChecked }` so callers can log whether HIBP was consulted.
 * @param {string} password
 * @param {{ email?: string }} [ctx]
 */
async function assertStrongPassword(password, ctx = {}) {
  const pw = String(password || "");
  const missing = [];
  if (pw.length < MIN_LENGTH) missing.push(`at least ${MIN_LENGTH} characters`);
  if (!/[a-z]/.test(pw)) missing.push("a lowercase letter");
  if (!/[A-Z]/.test(pw)) missing.push("an uppercase letter");
  if (!/[0-9]/.test(pw)) missing.push("a number");
  if (!/[^A-Za-z0-9]/.test(pw)) missing.push("a symbol");
  if (missing.length) {
    throw new AppError("WEAK_PASSWORD", "Password must contain " + missing.join(", ") + ".", 422);
  }

  const local = String(ctx.email || "").toLowerCase().split("@")[0];
  if (local && local.length >= 3 && pw.toLowerCase().includes(local)) {
    throw new AppError("WEAK_PASSWORD", "Password must not contain the name part of your email address.", 422);
  }

  const { checked, pwned } = await checkBreached(pw);
  if (checked && pwned) {
    throw new AppError("BREACHED_PASSWORD", "This password has appeared in a known data breach. Please choose a different one.", 422);
  }

  return { breachChecked: checked };
}

module.exports = { assertStrongPassword, checkBreached, MIN_LENGTH };
