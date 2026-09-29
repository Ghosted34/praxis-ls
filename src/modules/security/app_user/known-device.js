"use strict";

/**
 * The device, remembered by the SERVER — so a browser clearing its own storage
 * cannot make the sign-in screen forget who it belongs to, or that it holds a
 * passkey.
 *
 * ── WHY THE BROWSER'S OWN STORAGE IS NOT ENOUGH ─────────────────────────────
 *
 * The passkey itself lives in the operating system's keychain (iCloud
 * Keychain, Google Password Manager, Windows Hello) and nothing a web page does
 * can delete it. What the sign-in screen needs on top — "this is Ama's laptop,
 * and her passkey is here, so lead with the fingerprint" — used to live only in
 * localStorage, and the BROWSER deletes that on its own schedule:
 *
 *   · Safari erases every script-written store (localStorage, IndexedDB) of a
 *     site that has not been opened in seven days of browsing;
 *   · every engine evicts non-persistent storage under disk pressure.
 *
 * After either, the passkey still worked but the screen no longer offered it:
 * "it forgot me". A cookie SET BY THE SERVER, HttpOnly, is outside both — it is
 * not script-written storage — and lives until it expires (400 days, the
 * browsers' ceiling, rolled forward at every sign-in) or the person clears
 * their cookies themselves.
 *
 * ── WHY IT IS SAFE ──────────────────────────────────────────────────────────
 *
 * It is NOT a credential. It grants no session, skips no factor, unlocks
 * nothing. `GET /auth/device` answers with exactly what the same browser's
 * localStorage already held — the greeting (name, email, picture), whether a
 * Quick PIN is set, and the ids of the passkeys proven on this device (public
 * identifiers; the private keys never leave the authenticator). Beyond that:
 *
 *   · `__Host-` prefix in production: Secure, Path=/, no Domain — a page on any
 *     other subdomain cannot plant or overwrite it (no fixation onto a token an
 *     attacker could then read the greeting back with);
 *   · HttpOnly, so script — injected or not — cannot read it;
 *   · SameSite=Strict, so no other site can make a request that carries it;
 *   · only a SHA-256 of the 32 random bytes is stored, so the table cannot be
 *     turned back into cookies;
 *   · passkeys are listed only while the account still holds them (joined to
 *     webauthn_credential): removing one in My security is the one thing that
 *     takes a passkey off a device, and it does so everywhere at once.
 *
 * Remembering is best-effort by design: a failure here is logged and the
 * sign-in it followed stands.
 */

const crypto = require("crypto");
const { config } = require("../../../config/env");
const { logger } = require("../../../config/logger");
const repo = require("./known-device.repo");

const PROD = config.NODE_ENV === "production";
/** `__Host-` needs Secure, which plain-http development cannot set. */
const COOKIE = PROD ? "__Host-praxis_device" : "praxis_device";
/** Chrome and Safari cap a cookie's life at 400 days; every sign-in rolls it on. */
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const cookieOptions = () => ({
  httpOnly: true,
  secure: PROD,
  sameSite: "strict",
  path: "/",
  maxAge: MAX_AGE_MS,
});

/** This device's token from the Cookie header, or null. Anything malformed is ignored. */
function readToken(req) {
  const header = String((req.headers && req.headers.cookie) || "");
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== COOKIE) continue;
    const value = part.slice(i + 1).trim();
    return TOKEN.test(value) ? value : null;
  }
  return null;
}

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * After a sign-in (or a passkey enrolment) from this device: remember who, and
 * which passkey — minting the device's token the first time.
 */
async function remember(req, res, { userId, credentialId = null }) {
  if (!userId || typeof req.identityDb !== "function") return;
  try {
    const token = readToken(req) || crypto.randomBytes(32).toString("base64url");
    const { labelFromUserAgent } = require("./webauthn.service");
    await req.identityDb((c) =>
      repo.upsert(c, {
        deviceHash: hashToken(token),
        userId,
        credentialId: credentialId ? String(credentialId) : null,
        label: labelFromUserAgent(req.headers && req.headers["user-agent"]),
      }),
    );
    res.cookie(COOKIE, token, cookieOptions());
  } catch (err) {
    // The person is signed in; the device just will not greet them from the
    // server next time (localStorage still does). (taxonomy: degraded-optional)
    logger.warn({ err, user_id: userId }, "[auth] could not remember this device");
  }
}

/** What this device remembers — `{ account: null }` for a device it does not know. */
async function lookup(req) {
  const token = readToken(req);
  if (!token) return { account: null };
  const row = await req.identityDb((c) => repo.latestAccount(c, hashToken(token)));
  if (!row) return { account: null };
  return {
    account: {
      email: row.email,
      display_name: row.full_name || null,
      avatar_url: row.avatar_ref || null,
      has_quick_pin: !!row.has_quick_pin,
      passkeys: Array.isArray(row.passkeys) ? row.passkeys : [],
    },
  };
}

module.exports = { remember, lookup, readToken, hashToken, COOKIE, cookieOptions };
