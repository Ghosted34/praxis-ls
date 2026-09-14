"use strict";

/**
 * WebAuthn passkey service.
 *
 * Uses @simplewebauthn/server v9. Challenge is stateless: a JWT (typ
 * webauthn_challenge) signed with JWT_ACCESS_SECRET, 5-min TTL, sub=userId
 * (for registration) or sub=email|anonymous (for auth). On verify we decode
 * the JWT and compare the challenge byte-for-byte — no server-side store
 * needed, so a second container doesn't need to share memory.
 *
 * RP ID / origin are derived per-request so a multi-tenant host and localhost
 * both work without config. Expected origin is the request's Origin header or
 * the Host header fallback; RP ID is the origin's hostname without port.
 */

const jwt = require("jsonwebtoken");
const { config } = require("../../../config/env");
const { AppError } = require("../../../utils/errors");
const repo = require("./webauthn.repo");
const userRepo = require("./app_user.repo");
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

const CHALLENGE_TTL = "5m";

function signChallenge(payload) {
  return jwt.sign({ ...payload, typ: "webauthn_challenge" }, config.JWT_ACCESS_SECRET, { expiresIn: CHALLENGE_TTL });
}

function verifyChallenge(token) {
  try {
    const p = jwt.verify(token, config.JWT_ACCESS_SECRET);
    if (p.typ !== "webauthn_challenge") throw new Error("bad typ");
    return p;
  } catch {
    throw new AppError("INVALID_CHALLENGE", "Passkey challenge expired or invalid. Try again.", 400);
  }
}

function getRpInfo(req) {
  // Prefer Origin header (what WebAuthn clientData will contain), fallback to Host
  const originHeader = req.headers.origin || req.headers.referer || "";
  let origin = "";
  let rpID = "";
  try {
    if (originHeader) {
      const u = new URL(originHeader);
      origin = u.origin;
      rpID = u.hostname;
    }
  } catch { /* @silent:parse */ }
  if (!origin) {
    const host = req.get("host") || req.headers.host || "";
    const proto = req.protocol || "https";
    // host may include port
    const hostname = host.split(":")[0];
    rpID = hostname || config.APP_BASE_DOMAIN || "localhost";
    // Scheme: https unless localhost or explicitly http
    const scheme = hostname === "localhost" || hostname === "127.0.0.1" ? "http" : proto;
    origin = `${scheme}://${host}`;
    // If origin still has no scheme (e.g. host is empty), fallback to https://<rpID>
    if (!host) origin = `https://${rpID}`;
  }
  // SimpleWebAuthn wants rpID without port, origin as full origin string
  // For localhost, allow http origin. For production, https is expected.
  const rpName = (req.branding && req.branding.name) || "Praxis LS";
  return { rpID, rpName, origin };
}

function toBase64URL(buf) {
  return Buffer.from(buf).toString("base64url");
}

async function registrationOptions(client, { userId, req }) {
  const user = await userRepo.getUserSafe(client, userId);
  if (!user) throw new AppError("NOT_FOUND", "User not found", 404);

  const existing = await repo.listForUserWithKeys(client, userId);
  const { rpID, rpName } = getRpInfo(req);

  const { generateRegistrationOptions } = sw();

  // userID: stable opaque identifier — use user_id UUID bytes
  // SimpleWebAuthn accepts string or Uint8Array; we pass the UUID string's utf8 as base64url via buffer
  const userIdBytes = Buffer.from(String(userId), "utf8");

  const opts = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: userIdBytes,
    userName: user.email,
    userDisplayName: user.full_name || user.email,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      type: "public-key",
      transports: c.transports || undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
    supportedAlgorithmIDs: [-7, -257],
  });

  // Stateless challenge: sign it so verify can check without storage
  const challengeToken = signChallenge({ sub: String(userId), challenge: opts.challenge, kind: "registration" });
  // Keep the original base64url challenge for the client; stash the token alongside
  // We add _challenge so the client can echo it back if it wants, but verification
  // reads the JWT we also set in a header? Simpler: we include challengeToken in the
  // response and require the client to send it back on verify. To stay invisible
  // to old clients, we also store challenge in a short-lived in-memory map keyed by
  // challengeToken? No — we just require the client to send challengeToken.
  // For backward compat, we also accept the raw challenge string via JWT decode.
  // So we return both: challenge (for WebAuthn) + _challengeToken (to echo).
  return {
    ...opts,
    _challengeToken: challengeToken,
    // Back-compat: some clients expect _challenge field; keep it as the raw challenge
    _challenge: opts.challenge,
  };
}

async function verifyRegistration(client, { userId, attestation, challengeToken, label, req }) {
  if (!attestation) throw new AppError("BAD_REQUEST", "Missing attestation", 400);

  // Challenge must be the JWT we issued — no raw fallback (user-controlled bypass)
  let expectedChallenge = null;
  if (!challengeToken) throw new AppError("INVALID_CHALLENGE", "Missing passkey challenge", 400);
  try {
    const p = verifyChallenge(challengeToken);
    if (String(p.sub) !== String(userId) || p.kind !== "registration") throw new Error("mismatch");
    expectedChallenge = p.challenge;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("INVALID_CHALLENGE", "Passkey challenge invalid", 400);
  }

  const { rpID, origin } = getRpInfo(req);
  const { verifyRegistrationResponse } = sw();

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestation,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    logger.warn({ err: e }, "[webauthn] registration verify failed");
    throw new AppError("WEBAUTHN_VERIFICATION_FAILED", e.message || "Passkey verification failed", 400);
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError("WEBAUTHN_VERIFICATION_FAILED", "Passkey verification failed", 400);
  }

  const info = verification.registrationInfo;
  // v9 shape: { credential: { id, publicKey, counter, transports }, credentialDeviceType, credentialBackedUp, aaguid }
  // Older shape: { credentialPublicKey, credentialID, counter, ... }
  // Normalize:
  const credentialID = info.credential?.id || info.credentialID;
  const credentialPublicKey = info.credential?.publicKey || info.credentialPublicKey;
  const counter = info.credential?.counter ?? info.counter ?? 0;
  const transports = attestation.response?.transports || info.credential?.transports || undefined;
  const deviceType = info.credentialDeviceType || "singleDevice";
  const backedUp = info.credentialBackedUp || false;
  const aaguid = info.aaguid || undefined;

  // credentialID / publicKey are Uint8Array; store as base64url string
  const credIdB64 = typeof credentialID === "string" ? credentialID : toBase64URL(credentialID);
  const pubKeyB64 = typeof credentialPublicKey === "string" ? credentialPublicKey : Buffer.from(credentialPublicKey).toString("base64url");

  // Idempotency: if credential already exists for this user, return it
  const existing = await repo.getByCredentialId(client, credIdB64);
  if (existing) {
    if (String(existing.user_id) !== String(userId)) throw new AppError("CREDENTIAL_TAKEN", "This passkey is already registered to another account", 409);
    return { credential_id: existing.credential_id, label: existing.label };
  }

  const row = await repo.insertCredential(client, {
    credentialId: credIdB64,
    userId,
    publicKey: pubKeyB64,
    counter,
    transports: transports || null,
    deviceType: deviceType === "multiDevice" ? "multiDevice" : "singleDevice",
    backedUp: !!backedUp,
    aaguid: aaguid ? String(aaguid) : null,
    label: label || null,
  });

  logger.info({ user_id: userId, credential_id: credIdB64 }, "[webauthn] credential registered");
  return { credential_id: row.credential_id, label: row.label };
}

async function authenticationOptions(client, { email, req }) {
  // email may be undefined for discoverable login; if provided we scope allowCredentials
  let user = null;
  let allowCredentials = undefined;

  if (email) {
    const normalized = String(email).trim().toLowerCase();
    user = await userRepo.findByEmail(client, normalized);
    if (!user) {
      // For privacy, don't reveal that email doesn't exist — return empty allowCredentials
      // and let verification fail generically. But we still need a challenge.
      allowCredentials = [];
    } else {
      const creds = await repo.listForUserWithKeys(client, user.user_id);
      allowCredentials = creds.map((c) => ({
        id: c.credential_id,
        type: "public-key",
        transports: c.transports || undefined,
      }));
      if (allowCredentials.length === 0) throw new AppError("PASSKEY_NOT_FOUND", "No passkey found for that account", 404);
    }
  }

  const { rpID } = getRpInfo(req);
  const { generateAuthenticationOptions } = sw();

  const opts = await generateAuthenticationOptions({
    rpID,
    allowCredentials: allowCredentials && allowCredentials.length ? allowCredentials : undefined,
    userVerification: "preferred",
  });

  const sub = user ? String(user.user_id) : email ? String(email).toLowerCase() : "anonymous";
  const token = signChallenge({ sub, challenge: opts.challenge, kind: "authentication", email: email || null });

  return {
    ...opts,
    _challengeToken: token,
    _challenge: opts.challenge,
    // Echo email hint so verify can look up even with discoverable (userHandle)
    _emailHint: email || null,
  };
}

async function verifyAuthentication(client, { assertion, challengeToken, req, ip, userAgent, environment }) {
  if (!assertion) throw new AppError("BAD_REQUEST", "Missing assertion", 400);

  let expectedChallenge = null;
  let challengeSub = null;
  let challengeEmail = null;
  if (!challengeToken) throw new AppError("INVALID_CHALLENGE", "Missing passkey challenge", 400);
  try {
    const p = verifyChallenge(challengeToken);
    if (p.kind !== "authentication") throw new Error("bad kind");
    expectedChallenge = p.challenge;
    challengeSub = p.sub;
    challengeEmail = p.email || null;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("INVALID_CHALLENGE", "Passkey challenge invalid", 400);
  }

  // Determine which credential is being asserted
  const rawId = assertion.rawId || assertion.id;
  if (!rawId) throw new AppError("BAD_REQUEST", "Missing credential id", 400);
  const credId = typeof rawId === "string" ? rawId : toBase64URL(rawId);

  // Find the stored credential to get user_id and public key
  // If email was supplied we can look up via user, but discoverable uses userHandle
  let stored = await repo.getByCredentialId(client, credId);
  if (!stored) {
    // Fallback: try to decode userHandle (base64url of user_id utf8) if present
    const userHandleB64 = assertion.response?.userHandle;
    if (userHandleB64) {
      try {
        const handleBuf = Buffer.from(userHandleB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
        const handleStr = handleBuf.toString("utf8");
        // handleStr may be a UUID string
        const { rows } = await client.query(`SELECT * FROM webauthn_credential WHERE user_id = $1 AND credential_id = $2`, [handleStr, credId]);
        if (rows && rows[0]) stored = rows[0];
      } catch { /* @silent:parse */ }
    }
  }
  if (!stored) throw new AppError("INVALID_CREDENTIAL", "Passkey not found", 400);

  // Verify the user still active
  const user = await userRepo.getUserSafe(client, stored.user_id);
  if (!user || user.status !== "ACTIVE") throw new AppError("USER_INACTIVE", "Account is suspended or locked", 401);

  // The challenge is bound to the identity it was issued for. `authenticationOptions`
  // signs sub = user_id when the email resolved, the lowercased email when it did not,
  // and "anonymous" for a discoverable login that names nobody — only the last of those
  // has no identity to check, so it is the only one that skips the comparison.
  //
  // Without this, a challenge minted for one account verifies an assertion from any
  // other: the signature still checks out, because it is checked against whichever
  // credential the assertion names rather than the one the ceremony asked for.
  if (challengeSub && challengeSub !== "anonymous") {
    const boundToUser = String(stored.user_id) === String(challengeSub);
    const boundToEmail = !!challengeEmail && String(user.email).toLowerCase() === String(challengeEmail).toLowerCase();
    if (!boundToUser && !boundToEmail) {
      logger.warn({ user_id: stored.user_id, challenge_sub: challengeSub }, "[webauthn] assertion did not match the challenge subject");
      throw new AppError("INVALID_CHALLENGE", "Passkey challenge was issued for a different account", 400);
    }
  }

  const { rpID, origin } = getRpInfo(req);
  const { verifyAuthenticationResponse } = sw();

  // Need the authenticator's public key and counter
  const pubKeyBuf = Buffer.from(stored.public_key, "base64url");

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: stored.credential_id,
        publicKey: new Uint8Array(pubKeyBuf),
        counter: Number(stored.counter) || 0,
        transports: stored.transports || undefined,
      },
      requireUserVerification: false,
    });
  } catch (e) {
    logger.warn({ err: e }, "[webauthn] authentication verify failed");
    throw new AppError("WEBAUTHN_VERIFICATION_FAILED", e.message || "Passkey verification failed", 400);
  }

  if (!verification.verified) throw new AppError("WEBAUTHN_VERIFICATION_FAILED", "Passkey verification failed", 400);

  // Update counter for clone detection
  const newCounter = verification.authenticationInfo?.newCounter ?? stored.counter;
  await repo.updateCounter(client, stored.credential_id, newCounter);

  // Issue session tokens — same path as login/pinLogin, skips 2FA (passkey is already MFA)
  const { issueSessionTokens } = require("./app_user.service");
  // Need to fetch full user row for issueSessionTokens (needs full_name etc)
  const fullUser = await userRepo.findByEmail(client, user.email);
  if (!fullUser) throw new AppError("USER_INACTIVE", "Account is suspended", 401);

  // For keepSignedIn: passkey is a trusted device, keep long-lived
  const tokens = await issueSessionTokens(client, fullUser, {
    ip: ip || null,
    userAgent: userAgent || null,
    environment: environment || "live",
    keepSignedIn: true,
  });

  logger.info({ user_id: fullUser.user_id, credential_id: stored.credential_id }, "[webauthn] authentication success");
  return tokens;
}

async function listCredentials(client, userId) {
  return repo.listForUser(client, userId);
}

async function deleteCredential(client, { userId, credentialId }) {
  const row = await repo.deleteCredential(client, credentialId, userId);
  if (!row) throw new AppError("NOT_FOUND", "Passkey not found", 404);
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
};
