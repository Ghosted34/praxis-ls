"use strict";

const { asyncHandler } = require("../../../shared/http/async-handler");
const service = require("./webauthn.service");

// POST /auth/passkey/register/options — requires auth (device must be trusted)
const registerOptions = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) =>
    service.registrationOptions(c, { userId: req.user.user_id, label: req.body && req.body.label, req }),
  );
  res.json({ data });
});

// POST /auth/passkey/register/verify
const registerVerify = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) =>
    service.verifyRegistration(c, {
      userId: req.user.user_id,
      attestation: req.body.attestation || req.body,
      challengeToken: (req.body && (req.body.challengeToken || req.body._challengeToken)) || (req.headers["x-webauthn-challenge"] || null),
      // Also accept token inside attestation wrapper for new client
      label: req.body.label || null,
      req,
    }),
  );
  // Handle case where client sent attestation with _challengeToken inside
  // Our service also checks that, but the token may be at top level
  // If the above call missed token inside attestation, try again with nested
  if (!data && req.body.attestation && req.body.attestation._challengeToken) {
    // Not needed — verification already tried
  }
  res.json({ data });
});

// For the new client (src/lib/webauthn.ts) we expect body: { attestation, label, challenge: _challenge }
// Our service expects challengeToken; the client sends `_challenge` as raw challenge string, but we now use JWT
// So we need to handle both: if body contains attestation and also _challengeToken at top, we handle.
// The webauthn.ts sends { attestation, label, challenge: options._challenge }
// Actually it sends attestation plus challenge field — we should accept that as challenge fallback.

const registerVerifyCompat = asyncHandler(async (req, res) => {
  // Compatibility wrapper that handles both shapes:
  // - New: { attestation, label, challenge }
  // - Old: { attestation, challengeToken }
  // - Raw: the attestation is the body itself
  const body = req.body || {};
  let attestation = body.attestation || body;
  // If attestation itself is wrapped with type field, it's the credential
  // Some clients send { id, rawId, response, type } directly — that's also attestation
  let challengeToken = body.challengeToken || body._challengeToken || body._challenge || null;
  if (!challengeToken && attestation && attestation._challengeToken) challengeToken = attestation._challengeToken;
  if (!challengeToken && attestation && attestation._challenge) challengeToken = attestation._challenge;

  // If the body is the credential itself and we have no separate attestation wrapper, use body as attestation
  if (!body.attestation && body.id && body.response) {
    attestation = body;
  }

  const data = await req.identityDb((c) =>
    service.verifyRegistration(c, {
      userId: req.user.user_id,
      attestation,
      challengeToken,
      label: body.label || attestation.label || null,
      req,
    }),
  );
  res.json({ data });
});

const list = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) => service.listCredentials(c, req.user.user_id));
  res.json({ data });
});

const remove = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) => service.deleteCredential(c, { userId: req.user.user_id, credentialId: req.params.credentialId }));
  res.json({ data });
});

// POST /auth/passkey/login/options — public
const loginOptions = asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.authenticationOptions(c, { email: req.body && req.body.email, req }));
  res.json({ data });
});

// POST /auth/passkey/login/verify — public
const loginVerify = asyncHandler(async (req, res) => {
  const body = req.body || {};
  // Accept both { assertion, email, challengeToken } and raw assertion as body
  let assertion = body.assertion || body;
  if (!body.assertion && body.id && body.response) assertion = body;
  let challengeToken = body.challengeToken || body._challengeToken || body._challenge || body.challenge || null;
  if (!challengeToken && assertion && assertion._challengeToken) challengeToken = assertion._challengeToken;
  if (!challengeToken && assertion && assertion._challenge) challengeToken = assertion._challenge;

  const email = body.email || assertion.email || null;

  const data = await req.tenantDb((c) =>
    service.verifyAuthentication(c, {
      email,
      assertion,
      challengeToken,
      req,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      environment: req.env || "live",
    }),
  );
  res.json({ data });
});

module.exports = {
  registerOptions,
  registerVerify: registerVerifyCompat,
  list,
  remove,
  loginOptions,
  loginVerify,
};
