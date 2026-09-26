"use strict";

/**
 * WebAuthn passkey service.
 *
 * Uses @simplewebauthn/server v9. The challenge is stateless: a JWT (typ
 * webauthn_challenge) signed with JWT_ACCESS_SECRET, 5-min TTL. On verify the
 * JWT is decoded and its challenge compared byte-for-byte, so a second
 * container needs no shared store to CHECK one — and it is then burned
 * (single use, see `consumeChallenge`) so a captured assertion cannot be
 * replayed inside those five minutes.
 *
 * ── THE SECURITY DECISIONS, in the order a reviewer should check them ─────
 *
 * 1. USER VERIFICATION IS REQUIRED, at registration and at sign-in. A passkey
 *    here REPLACES the password and the 2FA code, so it has to be two factors on
 *    its own: the device (possession) AND the fingerprint/face/device PIN that
 *    unlocks it. This used to be "preferred" with `requireUserVerification:
 *    false`, which accepted a bare tap on a security key — one factor, standing
 *    in for two.
 *
 * 2. THE ORIGIN COMES FROM THE HOST WE SERVED, not from what the request says.
 *    It used to be read from the `Origin` header, then `Referer`, then Host —
 *    i.e. the caller chose which origin its own signature was checked against.
 *    In production the expected origin is now `https://<Host>` and an `Origin`
 *    header that disagrees is refused before any cryptography runs.
 *
 * 3. SIGN-IN OPTIONS REVEAL NOTHING ABOUT AN ACCOUNT. They used to look the
 *    email up and answer 404 PASSKEY_NOT_FOUND for an account with no passkey
 *    and 200 for an address that did not exist — an account-and-enrolment
 *    oracle on a public endpoint. They now touch no table: the device sends the
 *    ids of the passkeys IT registered, the ceremony is scoped to exactly those
 *    (so a laptop signs in with the laptop's passkey and a phone with the
 *    phone's), and with no ids the browser offers its own discoverable
 *    credentials. Who the passkey belongs to is learnt only from a VERIFIED
 *    assertion.
 *
 * 4. A CEREMONY IS BOUND TO THE ACCOUNT IT WAS STARTED FOR. The lock screen
 *    for Ama cannot be unlocked by Kofi's passkey on the same machine: the
 *    challenge carries the email, and an assertion from anyone else's
 *    credential is refused even though its signature is valid.
 *
 * 5. ENROLMENT NEEDS A FRESH SIGN-IN. See session-policy.assertFreshAuth — a
 *    stolen access token must not become a passkey that survives a password
 *    change. Every enrolment and removal raises a security notification.
 *
 * 6. EACH DEVICE GETS ITS OWN PASSKEY, capped per person. Registration asks for
 *    the PLATFORM authenticator (this device's Touch ID / Face ID / Windows
 *    Hello / Android screen lock, never a roaming key or a phone via QR), and
 *    excludes credentials the account already holds so the same device cannot
 *    enrol twice.
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { config } = require("../../../config/env");
const { AppError } = require("../../../utils/errors");
const { audit } = require("../../../shared/events/emit");
const repo = require("./webauthn.repo");
const userRepo = require("./app_user.repo");
const sessionPolicy = require("./session-policy");
const notificationRepo = require("../../notification/notification.repo");
const { logger } = require("../../../config/logger");

// Lazy load SimpleWebAuthn to keep tests that don't need it from failing if
// the package is missing in a minimal install.
let simpleWebAuthn = null;
function sw() {
  if (!simpleWebAuthn) {
    try {
      simpleWebAuthn = require("@simplewebauthn/server");
    } catch {
      throw new AppError("WEBAUTHN_UNAVAILABLE", "Passkey support is not installed on this server", 500);
    }
  }
  return simpleWebAuthn;
}

const CHALLENGE_TTL_S = 5 * 60;
/** How long the browser waits for the fingerprint / face before giving up. */
const CEREMONY_TIMEOUT_MS = 90 * 1000;
/** One per device, and room for a replacement: past this it is not "my devices". */
const MAX_PASSKEYS_PER_USER = 10;
const MODULE = "MOD-67";

function signChallenge(payload) {
  return jwt.sign({ ...payload, typ: "webauthn_challenge", nonce: crypto.randomUUID() }, config.JWT_ACCESS_SECRET, {
    expiresIn: CHALLENGE_TTL_S,
  });
}

function verifyChallenge(token) {
  try {
    const p = jwt.verify(token, config.JWT_ACCESS_SECRET);
    if (p.typ !== "webauthn_challenge") throw new Error("bad typ");
    return p;
  } catch {
    throw new AppError("INVALID_CHALLENGE", "That passkey request expired. Try again.", 400);
  }
}

// ── Single-use challenges ────────────────────────────────────────────────────
//
// Redis SET NX when it is up — shared across containers, which is the only way
// "used once" means once. When it is not, a per-process map is the fallback:
// weaker (a replay could land on the other container) but never "unlimited",
// and the 5-minute JWT expiry bounds it either way. Same stance as the rate
// limiter's memory fallback.
const usedLocally = new Map();

function redisOrNull() {
  try {
    return require("../../../config/redis").getClient();
  } catch {
    return null;
  }
}

async function consumeChallenge(challenge) {
  const key = `webauthn:used:${crypto.createHash("sha256").update(String(challenge)).digest("hex")}`;
  const redis = redisOrNull();
  if (redis) {
    try {
      const ok = await redis.set(key, "1", "EX", CHALLENGE_TTL_S + 30, "NX");
      if (ok !== "OK") throw new AppError("INVALID_CHALLENGE", "That passkey request was already used. Try again.", 400);
      return;
    } catch (err) {
      if (err instanceof AppError) throw err;
      // taxonomy: degraded-optional — Redis blinked; fall through to the local map.
      logger.warn({ err }, "[webauthn] challenge store unavailable — using per-process fallback");
    }
  }
  const now = Date.now();
  for (const [k, exp] of usedLocally) if (exp < now) usedLocally.delete(k);
  if (usedLocally.has(key)) throw new AppError("INVALID_CHALLENGE", "That passkey request was already used. Try again.", 400);
  usedLocally.set(key, now + (CHALLENGE_TTL_S + 30) * 1000);
}

// ── Relying party ────────────────────────────────────────────────────────────

/**
 * The relying party for THIS request: the host the browser reached us on.
 *
 * Production: the origin is `https://<Host>`, full stop. The WebAuthn ceremony
 * runs on the same origin as the API (the SPA calls /api on its own host), so
 * the host we are serving IS the origin the browser put in clientDataJSON — and
 * an `Origin` header naming anything else is refused rather than believed.
 *
 * Development: the Vite proxy rewrites Host to the tenant's name while the page
 * lives on http://localhost:5173, so the browser's Origin is the truth there
 * and is used as long as it is a localhost one.
 */
function getRpInfo(req) {
  const host = String(req.get?.("host") || req.headers.host || "").trim().toLowerCase();
  const hostname = host.split(":")[0];
  const originHeader = req.headers.origin ? String(req.headers.origin) : "";
  let rpName = "Praxis LS";
  if (req.rpName) rpName = req.rpName;

  if (config.NODE_ENV !== "production") {
    try {
      if (originHeader) {
        const u = new URL(originHeader);
        return { rpID: u.hostname, rpName, origin: u.origin };
      }
    } catch { /* @silent:parse — fall through to the Host */ }
    const scheme = hostname === "localhost" || hostname === "127.0.0.1" ? "http" : req.protocol || "https";
    return { rpID: hostname || "localhost", rpName, origin: `${scheme}://${host || "localhost"}` };
  }

  if (!hostname) throw new AppError("ORIGIN_MISMATCH", "Passkeys need a secure connection to this workspace.", 400);
  const origin = `https://${host}`;
  if (originHeader && originHeader !== origin) {
    logger.warn({ origin: originHeader, expected: origin }, "[webauthn] origin header does not match the host");
    throw new AppError("ORIGIN_MISMATCH", "This passkey request did not come from this workspace.", 400);
  }
  return { rpID: hostname, rpName, origin };
}

/** The tenant's own name on the passkey the OS saves — white-label, not ours. */
async function brandName(client) {
  try {
    const branding = require("../../branding/branding.service");
    const b = await branding.getBranding(client);
    const name = b && typeof b.name === "string" ? b.name.trim() : "";
    return name || "Praxis LS";
  } catch {
    // taxonomy: degraded-optional — the name on the saved passkey is cosmetic.
    return "Praxis LS";
  }
}

function toBase64URL(buf) {
  return Buffer.from(buf).toString("base64url");
}

/**
 * Credential ids are stored base64url. v9's descriptor and authenticator types
 * want the raw BYTES — handed a string, it yields an empty id rather than
 * failing, so an exclude/allow list quietly stops naming anything.
 */
function credentialIdToBytes(credentialId) {
  return Buffer.from(String(credentialId), "base64url");
}

/** A readable default label from the User-Agent: "Chrome on macOS". */
function labelFromUserAgent(ua) {
  const s = String(ua || "");
  const os = /iPhone/.test(s) ? "iPhone"
    : /iPad/.test(s) ? "iPad"
    : /Android/.test(s) ? "Android"
    : /Mac OS X|Macintosh/.test(s) ? "macOS"
    : /Windows/.test(s) ? "Windows"
    : /CrOS/.test(s) ? "ChromeOS"
    : /Linux/.test(s) ? "Linux"
    : null;
  const browser = /Edg\//.test(s) ? "Edge"
    : /OPR\//.test(s) ? "Opera"
    : /Firefox\//.test(s) ? "Firefox"
    : /Chrome\//.test(s) ? "Chrome"
    : /Safari\//.test(s) ? "Safari"
    : null;
  if (browser && os) return `${browser} on ${os}`;
  return os || browser || "This device";
}

async function notify(client, { userId, title, body, entityRef }) {
  try {
    await notificationRepo.insertForUser(client, {
      userId,
      eventTypeKey: null,
      title,
      body,
      entityRef,
      priority: "HIGH",
      category: "security",
      linkUrl: "/security/my-security",
    });
  } catch (err) {
    // taxonomy: degraded-optional — the change is done and audited; the bell is a nicety.
    logger.warn({ err, user_id: userId }, "[webauthn] security notification failed");
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

async function registrationOptions(client, { userId, sessionId = null, currentPassword = null, req }) {
  const user = await userRepo.getUserSafe(client, userId);
  if (!user) throw new AppError("NOT_FOUND", "User not found", 404);

  await sessionPolicy.assertFreshAuth(client, { sessionId, userId, currentPassword });

  const existing = await repo.listForUserWithKeys(client, userId);
  if (existing.length >= MAX_PASSKEYS_PER_USER) {
    throw new AppError(
      "PASSKEY_LIMIT",
      `You already have ${MAX_PASSKEYS_PER_USER} passkeys. Remove one from a device you no longer use, then try again.`,
      409,
    );
  }

  const { rpID } = getRpInfo(req);
  const rpName = await brandName(client);
  const { generateRegistrationOptions } = sw();

  const opts = await generateRegistrationOptions({
    rpName,
    rpID,
    // v9 takes userID as a STRING and encodes it itself. Passing bytes here
    // serialises `user.id` as {"type":"Buffer","data":[…]}, which the browser
    // cannot decode — the ceremony then dies before the authenticator is ever
    // asked, surfacing as a bare "Something went wrong".
    userID: String(userId),
    userName: user.email,
    userDisplayName: user.full_name || user.email,
    attestationType: "none",
    timeout: CEREMONY_TIMEOUT_MS,
    // The same device cannot enrol twice: its authenticator already holds one
    // of these and refuses (the client explains that as "already set up here").
    excludeCredentials: existing.map((c) => ({
      id: credentialIdToBytes(c.credential_id),
      type: "public-key",
      transports: c.transports || undefined,
    })),
    authenticatorSelection: {
      // Discoverable, so the lock screen can sign in without typing anything.
      residentKey: "required",
      requireResidentKey: true,
      // Decision 1: the fingerprint / face / device PIN is part of the credential.
      userVerification: "required",
      // Decision 6: THIS device's own authenticator, not a phone via QR.
      authenticatorAttachment: "platform",
    },
    supportedAlgorithmIDs: [-7, -257],
  });

  const challengeToken = signChallenge({ sub: String(userId), challenge: opts.challenge, kind: "registration" });
  return { ...opts, _challengeToken: challengeToken };
}

async function verifyRegistration(client, { userId, attestation, challengeToken, label, req }) {
  if (!attestation) throw new AppError("BAD_REQUEST", "Missing attestation", 400);
  if (!challengeToken) throw new AppError("INVALID_CHALLENGE", "Missing passkey challenge", 400);

  const p = verifyChallenge(challengeToken);
  if (String(p.sub) !== String(userId) || p.kind !== "registration") {
    throw new AppError("INVALID_CHALLENGE", "That passkey request was not issued to you. Try again.", 400);
  }

  const { rpID, origin } = getRpInfo(req);
  const { verifyRegistrationResponse } = sw();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestation,
      expectedChallenge: p.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    logger.warn({ err: e }, "[webauthn] registration verify failed");
    throw new AppError("WEBAUTHN_VERIFICATION_FAILED", "Your device's passkey could not be verified. Try again.", 400);
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError("WEBAUTHN_VERIFICATION_FAILED", "Your device's passkey could not be verified. Try again.", 400);
  }
  await consumeChallenge(p.challenge);

  const info = verification.registrationInfo;
  // v9: { credentialID, credentialPublicKey, counter, credentialDeviceType, credentialBackedUp, aaguid }
  const credentialID = info.credentialID || info.credential?.id;
  const credentialPublicKey = info.credentialPublicKey || info.credential?.publicKey;
  const counter = info.counter ?? info.credential?.counter ?? 0;
  const transports = attestation.response?.transports || undefined;
  const credIdB64 = typeof credentialID === "string" ? credentialID : toBase64URL(credentialID);
  const pubKeyB64 = typeof credentialPublicKey === "string" ? credentialPublicKey : toBase64URL(credentialPublicKey);

  // Idempotency: a retried verify of the same credential answers with it.
  const existing = await repo.getByCredentialId(client, credIdB64);
  if (existing) {
    if (String(existing.user_id) !== String(userId)) {
      throw new AppError("CREDENTIAL_TAKEN", "This passkey is already registered to another account", 409);
    }
    return { credential_id: existing.credential_id, label: existing.label, created_at: existing.created_at };
  }

  const cleanLabel = (label ? String(label).trim().slice(0, 80) : "") || labelFromUserAgent(req.headers["user-agent"]);
  const row = await repo.insertCredential(client, {
    credentialId: credIdB64,
    userId,
    publicKey: pubKeyB64,
    counter,
    transports: transports || null,
    deviceType: info.credentialDeviceType === "multiDevice" ? "multiDevice" : "singleDevice",
    backedUp: !!info.credentialBackedUp,
    aaguid: info.aaguid ? String(info.aaguid) : null,
    label: cleanLabel,
  });

  await audit(client, {
    actorUserId: userId,
    action: "app_user.passkey.registered",
    moduleKey: MODULE,
    entityRef: `webauthn_credential:${credIdB64}`,
    after: { label: row.label },
    isSensitive: true,
  });
  await notify(client, {
    userId,
    title: "A passkey was added to your account",
    body: `A passkey was added for "${row.label}". If this wasn't you, remove it in My security and change your password.`,
    entityRef: `webauthn_credential:${credIdB64}`,
  });
  logger.info({ user_id: userId, credential_id: credIdB64 }, "[webauthn] credential registered");
  return { credential_id: row.credential_id, label: row.label, created_at: row.created_at };
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

/**
 * Options for a sign-in ceremony. Reads NOTHING from the database (decision 3).
 *
 *   credentialIds  the passkeys this device registered → scoped to exactly
 *                  those, on this device's own authenticator ("internal"), so
 *                  the OS goes straight to Touch ID / Face ID / Windows Hello
 *                  instead of listing passkeys or offering a phone's QR code.
 *   email          binds the ceremony to that account (decision 4).
 *   neither        a discoverable sign-in: the browser offers what it holds.
 */
async function authenticationOptions(_client, { email, credentialIds, req }) {
  const { rpID } = getRpInfo(req);
  const { generateAuthenticationOptions } = sw();

  const ids = Array.isArray(credentialIds) ? credentialIds.filter(Boolean).slice(0, 10) : [];
  const opts = await generateAuthenticationOptions({
    rpID,
    timeout: CEREMONY_TIMEOUT_MS,
    allowCredentials: ids.length
      ? ids.map((id) => ({ id: credentialIdToBytes(id), type: "public-key", transports: ["internal"] }))
      : undefined,
    userVerification: "required",
  });

  const normalised = email ? String(email).trim().toLowerCase() : null;
  const token = signChallenge({ sub: normalised || "anonymous", email: normalised, challenge: opts.challenge, kind: "authentication" });
  return { ...opts, _challengeToken: token };
}

async function verifyAuthentication(client, { assertion, challengeToken, req, ip, userAgent, environment }) {
  if (!assertion) throw new AppError("BAD_REQUEST", "Missing assertion", 400);
  if (!challengeToken) throw new AppError("INVALID_CHALLENGE", "Missing passkey challenge", 400);

  const p = verifyChallenge(challengeToken);
  if (p.kind !== "authentication") throw new AppError("INVALID_CHALLENGE", "That passkey request is not a sign-in. Try again.", 400);

  const rawId = assertion.rawId || assertion.id;
  if (!rawId) throw new AppError("BAD_REQUEST", "Missing credential id", 400);
  const credId = typeof rawId === "string" ? rawId : toBase64URL(rawId);

  const stored = await repo.getByCredentialId(client, credId);
  if (!stored) {
    // The device still holds a key the account no longer recognises — removed
    // in My security from another device, or the account was re-created. The
    // client drops it from this device's record so the next visit does not
    // lead with a passkey that cannot work.
    throw new AppError(
      "PASSKEY_REVOKED",
      "This device's passkey is no longer registered to your account. Sign in another way, then set it up again.",
      400,
      { credential_id: credId },
    );
  }

  const user = await userRepo.getUserSafe(client, stored.user_id);
  if (!user || user.status !== "ACTIVE") throw new AppError("USER_INACTIVE", "Account is suspended or locked", 401);

  // Decision 4: the ceremony was started for one account; a valid signature
  // from a DIFFERENT account's passkey does not sign that screen in. "anonymous"
  // (a discoverable sign-in that named nobody) is the only unbound case. The
  // user-id form covers challenges minted before this change (≤5 minutes).
  if (p.sub && p.sub !== "anonymous") {
    const boundToEmail = !!p.email && String(user.email).toLowerCase() === String(p.email).toLowerCase();
    const boundToUser = String(stored.user_id) === String(p.sub);
    if (!boundToEmail && !boundToUser) {
      logger.warn({ user_id: stored.user_id }, "[webauthn] assertion did not match the account the ceremony was for");
      throw new AppError("INVALID_CHALLENGE", "That passkey belongs to a different account.", 400);
    }
  }

  const { rpID, origin } = getRpInfo(req);
  const { verifyAuthenticationResponse } = sw();
  const pubKeyBuf = Buffer.from(stored.public_key, "base64url");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: p.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      // v9 spells this `authenticator` with credentialID/credentialPublicKey.
      // v10 renamed it to `credential` with id/publicKey; passing that shape to
      // v9 leaves it with no key to check the signature against.
      authenticator: {
        credentialID: credentialIdToBytes(stored.credential_id),
        credentialPublicKey: new Uint8Array(pubKeyBuf),
        counter: Number(stored.counter) || 0,
        transports: stored.transports || undefined,
      },
      requireUserVerification: true,
    });
  } catch (e) {
    // A counter that went BACKWARDS lands here too — SimpleWebAuthn refuses it
    // as a cloned authenticator. Logged with the credential so it can be found.
    logger.warn({ err: e, credential_id: stored.credential_id }, "[webauthn] authentication verify failed");
    throw new AppError("WEBAUTHN_VERIFICATION_FAILED", "Your passkey could not be verified. Try again.", 400);
  }
  if (!verification.verified) throw new AppError("WEBAUTHN_VERIFICATION_FAILED", "Your passkey could not be verified. Try again.", 400);

  // Burned AFTER it verified: a failed attempt must not consume a challenge the
  // real user is still answering, and a verified one must never answer twice.
  await consumeChallenge(p.challenge);

  const newCounter = verification.authenticationInfo?.newCounter ?? stored.counter;
  await repo.updateCounter(client, stored.credential_id, newCounter);

  // Same path as password / PIN; skips 2FA because a user-verified passkey is
  // already two factors (decision 1).
  const { issueSessionTokens } = require("./app_user.service");
  const fullUser = await userRepo.findByEmail(client, user.email);
  if (!fullUser) throw new AppError("USER_INACTIVE", "Account is suspended", 401);
  const tokens = await issueSessionTokens(client, fullUser, {
    ip: ip || null,
    userAgent: userAgent || null,
    environment: environment || "live",
    method: "passkey",
  });

  logger.info({ user_id: fullUser.user_id, credential_id: stored.credential_id }, "[webauthn] authentication success");
  // The credential that signed, so the device can remember which of its
  // passkeys this account uses and lead with it next time.
  return { ...tokens, credential_id: stored.credential_id };
}

// ── Management ───────────────────────────────────────────────────────────────

async function listCredentials(client, userId) {
  return repo.listForUser(client, userId);
}

async function deleteCredential(client, { userId, credentialId }) {
  const row = await repo.deleteCredential(client, credentialId, userId);
  if (!row) throw new AppError("NOT_FOUND", "Passkey not found", 404);
  await audit(client, {
    actorUserId: userId,
    action: "app_user.passkey.removed",
    moduleKey: MODULE,
    entityRef: `webauthn_credential:${credentialId}`,
    before: { label: row.label || null },
    isSensitive: true,
  });
  await notify(client, {
    userId,
    title: "A passkey was removed from your account",
    body: `The passkey${row.label ? ` for "${row.label}"` : ""} can no longer sign you in. If this wasn't you, change your password.`,
    entityRef: `webauthn_credential:${credentialId}`,
  });
  return { deleted: true };
}

module.exports = {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  listCredentials,
  deleteCredential,
  getRpInfo,
  labelFromUserAgent,
  MAX_PASSKEYS_PER_USER,
  // Exported for tests.
  _resetUsedChallenges: () => usedLocally.clear(),
};
