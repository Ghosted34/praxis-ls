"use strict";

const { asyncHandler } = require("../../../utils/errors");
const service = require("./webauthn.service");

// POST /auth/passkey/register/options — requires auth (device must be trusted)
const registerOptions = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) =>
    service.registrationOptions(c, { userId: req.user.user_id, req }),
  );
  res.json({ data });
});

// POST /auth/passkey/register/verify
// Accepts the several body shapes clients have sent over time:
//   New: { attestation, label, challenge } · Old: { attestation, challengeToken } · Raw: the attestation IS the body
const registerVerify = asyncHandler(async (req, res) => {
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

  const data = await req.tenantDb((c) =>
    service.verifyAuthentication(c, {
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
  registerVerify,
  list,
  remove,
  loginOptions,
  loginVerify,
};
