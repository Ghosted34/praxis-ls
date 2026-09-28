/**
 * Face ID / fingerprint for PORTAL users (14150) — the client, investor or
 * auditor signing in to the portal with their phone's own screen lock.
 *
 * The ceremony is the staff one (`security/app_user/webauthn.service.js`), and
 * every security decision written at the top of that file holds here too:
 * user verification REQUIRED (the passkey replaces the password, so it must be
 * two factors on its own), the origin taken from the host we served rather than
 * from a header, sign-in options that read no table, a ceremony bound to the
 * account it was started for, and a challenge that is burned on first use.
 *
 * What differs, and why it is a separate file rather than a flag on that one:
 *
 *   · THE CREDENTIAL TABLE. `portal_passkey`, never `webauthn_credential` — a
 *     portal user is not an app_user and must never resolve as one.
 *   · THE CHALLENGE AUDIENCE. Portal challenges carry `aud_kind: "portal"`, and
 *     both sides refuse the other's, so this ceremony can never finish a staff
 *     sign-in or the reverse.
 *   · FRESHNESS. Staff enrolment asks for the current password after fifteen
 *     minutes. A portal user may never have had a password they remember — they
 *     sign in with emailed codes — so the rule here is only the token's age: a
 *     sign-in younger than fifteen minutes. Older than that, the portal asks them
 *     to sign in again (a code is one tap) and then enrols.
 */
"use strict";

const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const webauthn = require("../security/app_user/webauthn.service");
const repo = require("./portal_auth.repo");
const authService = require("./portal_auth.service");

const AUDIENCE = "portal";
const MAX_PASSKEYS = 10;
const ENROL_WINDOW_S = 15 * 60;

function assertFresh(tokenIat) {
  const age = Math.floor(Date.now() / 1000) - Number(tokenIat || 0);
  if (!tokenIat || age > ENROL_WINDOW_S) {
    throw new AppError("REAUTH_REQUIRED", "Sign in again to turn this on.", 403);
  }
}

async function registrationOptions(client, { user, tokenIat, req }) {
  assertFresh(tokenIat);
  const existing = await repo.passkeyIdsFor(client, user.portal_user_id);
  if (existing.length >= MAX_PASSKEYS) {
    throw new AppError("PASSKEY_LIMIT", "You already have the maximum number of devices set up. Remove one first.", 409);
  }
  const { rpID } = webauthn.getRpInfo(req);
  const rpName = await webauthn.brandName(client);
  const { generateRegistrationOptions } = webauthn.sw();
  const opts = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: String(user.portal_user_id),
    userName: user.email,
    userDisplayName: user.full_name || user.email,
    attestationType: "none",
    timeout: webauthn.CEREMONY_TIMEOUT_MS,
    excludeCredentials: existing.map((c) => ({
      id: webauthn.credentialIdToBytes(c.credential_id),
      type: "public-key",
      transports: c.transports || undefined,
    })),
    authenticatorSelection: {
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
      authenticatorAttachment: "platform",
    },
    supportedAlgorithmIDs: [-7, -257],
  });
  const challengeToken = webauthn.signChallenge(
    { sub: String(user.portal_user_id), challenge: opts.challenge, kind: "registration" },
    { audience: AUDIENCE },
  );
  return { ...opts, _challengeToken: challengeToken };
}

async function verifyRegistration(client, { user, attestation, challengeToken, label, req }) {
  if (!attestation) throw new AppError("BAD_REQUEST", "Missing attestation", 400);
  const p = webauthn.verifyChallenge(challengeToken, { audience: AUDIENCE });
  if (String(p.sub) !== String(user.portal_user_id) || p.kind !== "registration") {
    throw new AppError("INVALID_CHALLENGE", "That request was not issued to you. Try again.", 400);
  }
  const { rpID, origin } = webauthn.getRpInfo(req);
  const { verifyRegistrationResponse } = webauthn.sw();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestation,
      expectedChallenge: p.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    logger.warn({ err }, "[portal-passkey] registration verify failed");
    throw new AppError("WEBAUTHN_VERIFICATION_FAILED", "Your device could not be verified. Try again.", 400);
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError("WEBAUTHN_VERIFICATION_FAILED", "Your device could not be verified. Try again.", 400);
  }
  await webauthn.consumeChallenge(p.challenge);

  const info = verification.registrationInfo;
  const credentialID = info.credentialID || info.credential?.id;
  const credentialPublicKey = info.credentialPublicKey || info.credential?.publicKey;
  const credId = typeof credentialID === "string" ? credentialID : webauthn.toBase64URL(credentialID);
  const pubKey = typeof credentialPublicKey === "string" ? credentialPublicKey : webauthn.toBase64URL(credentialPublicKey);

  const existing = await repo.getPasskey(client, credId);
  if (existing) {
    if (String(existing.portal_user_id) !== String(user.portal_user_id)) {
      throw new AppError("CREDENTIAL_TAKEN", "This device is already set up for another account.", 409);
    }
    return { credential_id: existing.credential_id, label: existing.label, created_at: existing.created_at };
  }
  const cleanLabel = (label ? String(label).trim().slice(0, 80) : "") || webauthn.labelFromUserAgent(req.headers["user-agent"]);
  const row = await repo.insertPasskey(client, {
    credentialId: credId,
    portalUserId: user.portal_user_id,
    publicKey: pubKey,
    counter: info.counter ?? info.credential?.counter ?? 0,
    transports: attestation.response?.transports || null,
    deviceType: info.credentialDeviceType === "multiDevice" ? "multiDevice" : "singleDevice",
    backedUp: !!info.credentialBackedUp,
    aaguid: info.aaguid ? String(info.aaguid) : null,
    label: cleanLabel,
  });
  logger.info({ portal_user_id: user.portal_user_id, credential_id: credId }, "[portal-passkey] registered");
  return { credential_id: row.credential_id, label: row.label, created_at: row.created_at };
}

/** Public, and reads NOTHING — same as the staff ceremony (decision 3 there). */
async function authenticationOptions(_client, { email, credentialIds, req }) {
  const { rpID } = webauthn.getRpInfo(req);
  const { generateAuthenticationOptions } = webauthn.sw();
  const ids = Array.isArray(credentialIds) ? credentialIds.filter(Boolean).slice(0, 10) : [];
  const opts = await generateAuthenticationOptions({
    rpID,
    timeout: webauthn.CEREMONY_TIMEOUT_MS,
    allowCredentials: ids.length
      ? ids.map((id) => ({ id: webauthn.credentialIdToBytes(id), type: "public-key", transports: ["internal"] }))
      : undefined,
    userVerification: "required",
  });
  const normalised = email ? String(email).trim().toLowerCase() : null;
  const challengeToken = webauthn.signChallenge(
    { sub: normalised || "anonymous", email: normalised, challenge: opts.challenge, kind: "authentication" },
    { audience: AUDIENCE },
  );
  return { ...opts, _challengeToken: challengeToken };
}

async function verifyAuthentication(client, { assertion, challengeToken, trust = false, req, ip }) {
  if (!assertion) throw new AppError("BAD_REQUEST", "Missing assertion", 400);
  const p = webauthn.verifyChallenge(challengeToken, { audience: AUDIENCE });
  if (p.kind !== "authentication") throw new AppError("INVALID_CHALLENGE", "That request is not a sign-in. Try again.", 400);

  const rawId = assertion.rawId || assertion.id;
  if (!rawId) throw new AppError("BAD_REQUEST", "Missing credential id", 400);
  const credId = typeof rawId === "string" ? rawId : webauthn.toBase64URL(rawId);
  const stored = await repo.getPasskey(client, credId);
  if (!stored) {
    throw new AppError(
      "PASSKEY_REVOKED",
      "This device is no longer set up for your account. Sign in another way, then turn it on again.",
      400,
      { credential_id: credId },
    );
  }
  const user = await repo.findById(client, stored.portal_user_id);
  if (!user || user.status !== "ACTIVE") throw new AppError("PORTAL_USER_INACTIVE", "This account is disabled", 401);
  if (p.email && String(user.email).toLowerCase() !== String(p.email).toLowerCase()) {
    throw new AppError("INVALID_CHALLENGE", "That device belongs to a different account.", 400);
  }

  const { rpID, origin } = webauthn.getRpInfo(req);
  const { verifyAuthenticationResponse } = webauthn.sw();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: p.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: webauthn.credentialIdToBytes(stored.credential_id),
        credentialPublicKey: new Uint8Array(Buffer.from(stored.public_key, "base64url")),
        counter: Number(stored.counter) || 0,
        transports: stored.transports || undefined,
      },
      requireUserVerification: true,
    });
  } catch (err) {
    logger.warn({ err, credential_id: stored.credential_id }, "[portal-passkey] authentication verify failed");
    throw new AppError("WEBAUTHN_VERIFICATION_FAILED", "Your device could not be verified. Try again.", 400);
  }
  if (!verification.verified) throw new AppError("WEBAUTHN_VERIFICATION_FAILED", "Your device could not be verified. Try again.", 400);
  await webauthn.consumeChallenge(p.challenge);
  await repo.updatePasskeyCounter(client, stored.credential_id, verification.authenticationInfo?.newCounter ?? stored.counter);
  await repo.touchLogin(client, user.portal_user_id);

  const tokens = await authService.issueTokens(client, user, {
    trust,
    method: "passkey",
    userAgent: req.headers["user-agent"],
    ip,
  });
  return { ...tokens, credential_id: stored.credential_id };
}

const listPasskeys = (client, portalUserId) => repo.listPasskeys(client, portalUserId);

async function deletePasskey(client, { portalUserId, credentialId }) {
  const row = await repo.deletePasskey(client, credentialId, portalUserId);
  if (!row) throw new AppError("NOT_FOUND", "That device is not set up", 404);
  return { deleted: true };
}

module.exports = {
  registrationOptions, verifyRegistration, authenticationOptions, verifyAuthentication,
  listPasskeys, deletePasskey,
};
