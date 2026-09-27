"use strict";

const { asyncHandler } = require("../../../utils/errors");
const service = require("./webauthn.service");

/*
 * One body shape per route, declared in app_user.validator.js. These handlers
 * used to accept four historical shapes (a raw credential as the body, the
 * challenge under three different names) and pick among them — every one of
 * those was a way to send the server something it had not asked for.
 */

// POST /auth/passkey/register/options — signed in, and freshly (or with the password)
const registerOptions = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) =>
    service.registrationOptions(c, {
      userId: req.user.user_id,
      sessionId: req.user.session_id || null,
      currentPassword: req.body.current_password || null,
      req,
    }),
  );
  res.json({ data });
});

// POST /auth/passkey/register/verify — { attestation, challengeToken, label }
const registerVerify = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) =>
    service.verifyRegistration(c, {
      userId: req.user.user_id,
      attestation: req.body.attestation,
      challengeToken: req.body.challengeToken,
      label: req.body.label || null,
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

// POST /auth/passkey/login/options — public; { email?, credential_ids? }. Reads no table.
const loginOptions = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) =>
    service.authenticationOptions(c, {
      email: req.body.email || null,
      credentialIds: req.body.credential_ids || [],
      req,
    }),
  );
  res.json({ data });
});

// POST /auth/passkey/login/verify — public; { assertion, challengeToken }
//
// identityDb, not tenantDb: credentials, accounts and sessions live in the live
// (identity) schema, like every other sign-in route. tenantDb follows the
// LIVE/TEST toggle, so in TEST mode this looked for the passkey in the sandbox
// schema, where it does not exist.
const loginVerify = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) =>
    service.verifyAuthentication(c, {
      assertion: req.body.assertion,
      challengeToken: req.body.challengeToken,
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
