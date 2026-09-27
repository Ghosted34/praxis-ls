/**
 * Session policy — how long a session lives, and when it is still "fresh".
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A session lives SESSION_MAX_AGE_MIN (default 120) minutes from sign-in, and
 * not a second longer, whatever the user is doing. At that moment the client
 * locks the screen and the person at it has to prove who they are again. This
 * is the owner's rule for a product full of financial approvals: a finance
 * officer who walks away from an open tab must not leave a working session
 * behind for whoever sits down next.
 *
 * Enforced here, not only in the browser, and in two places:
 *
 *   1. `refresh()` refuses a session past its age and kills the row.
 *   2. Every token minted for a session has its `exp` capped at the session's
 *      end. An access token cannot outlive its session by its own 15-minute
 *      TTL, so a client that ignored its lock timer, or a token lifted from
 *      one, stops working at the same second the lock screen appears.
 *
 * The inactivity rule (SESSION_INACTIVITY_MIN) still applies inside that
 * window — a device that has not refreshed for half an hour (asleep, tab
 * closed) is locked on its return. "Keep me signed in" used to exempt a
 * session from it and hold a 30-day refresh token; that option is gone,
 * because a 30-day session is exactly the unattended-desk hole the lock exists
 * to close. Unlocking costs one fingerprint and lands the user where they were.
 *
 * ── FRESH AUTH ──────────────────────────────────────────────────────────────
 *
 * Adding a sign-in credential — a passkey, a Quick PIN device — hands out a
 * PERMANENT way into the account. Allowing it on nothing more than a live
 * access token means a token lifted from a browser (15 minutes of value on its
 * own) can be converted into a key that survives a password change. So it is
 * allowed only within CREDENTIAL_ENROL_WINDOW_MIN of the session's sign-in —
 * which covers the "add a passkey now?" offer straight after signing in — and
 * past that it needs the current password.
 */
"use strict";

const argon2 = require("argon2");
const { config } = require("../../../config/env");
const { AppError } = require("../../../utils/errors");

/** "15m" | "30d" | "3600" | 3600 → seconds. Unparseable → the fallback. */
function ttlSeconds(value, fallback = 15 * 60) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  const m = /^\s*(\d+)\s*([smhd]?)\s*$/i.exec(String(value || ""));
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = (m[2] || "s").toLowerCase();
  return n * { s: 1, m: 60, h: 3600, d: 86400 }[unit];
}

/** The hard ceiling on a session's life, in seconds. */
function maxAgeSeconds() {
  return Math.max(60, Number(config.SESSION_MAX_AGE_MIN) * 60);
}

/** The idle window, in seconds. */
function idleSeconds() {
  return Number(config.SESSION_INACTIVITY_MIN) * 60;
}

/**
 * Seconds a session of this age has left. Never negative. A session whose age
 * is unknown (a NULL created_at cannot happen — the column is NOT NULL — but a
 * mocked row can) is treated as brand new rather than as expired, so a missing
 * value cannot become a mass sign-out.
 */
function remainingSeconds(ageSeconds) {
  const age = Number(ageSeconds);
  if (!Number.isFinite(age) || age < 0) return maxAgeSeconds();
  return Math.max(0, Math.floor(maxAgeSeconds() - age));
}

/** Access token life: its own TTL, or what is left of the session if shorter. */
function accessTtlFor(remaining) {
  return Math.max(1, Math.min(ttlSeconds(config.JWT_ACCESS_TTL), remaining));
}

/** Refresh token life: never past the session's end. */
function refreshTtlFor(remaining) {
  return Math.max(1, Math.min(ttlSeconds(config.JWT_REFRESH_TTL, maxAgeSeconds()), remaining));
}

/**
 * Refuse to enrol a new sign-in credential on a stale session unless the
 * current password is supplied and correct.
 *
 * `sessionId` comes from the access token (`sid`). A token without one predates
 * session binding and is treated as stale — the password route still works.
 *
 * 403 (not 401) on purpose: the client treats a 401 as "token expired" and
 * would refresh-then-lock over what is only a missing password.
 */
async function assertFreshAuth(client, { sessionId, userId, currentPassword }) {
  let fresh = false;
  if (sessionId) {
    const { rows } = await client.query(
      `SELECT EXTRACT(EPOCH FROM (now() - created_at)) AS age_seconds
         FROM user_session
        WHERE session_id = $1 AND user_id = $2 AND killed_at IS NULL`,
      [sessionId, userId],
    );
    const age = rows[0] ? Number(rows[0].age_seconds) : NaN;
    fresh = Number.isFinite(age) && age <= Number(config.CREDENTIAL_ENROL_WINDOW_MIN) * 60;
  }
  if (fresh) return { via: "recent_sign_in" };

  if (!currentPassword) {
    throw new AppError(
      "REAUTH_REQUIRED",
      "For your security, confirm your password to add a new way to sign in.",
      403,
    );
  }
  const { rows } = await client.query(
    "SELECT password_hash, status FROM app_user WHERE user_id = $1",
    [userId],
  );
  const user = rows[0];
  const ok = user && user.status === "ACTIVE"
    ? await argon2.verify(user.password_hash, String(currentPassword)).catch(() => false)
    : false;
  if (!ok) {
    throw new AppError("INVALID_CURRENT_PASSWORD", "That's not your current password.", 403);
  }
  return { via: "password" };
}

module.exports = {
  ttlSeconds,
  maxAgeSeconds,
  idleSeconds,
  remainingSeconds,
  accessTtlFor,
  refreshTtlFor,
  assertFreshAuth,
};
