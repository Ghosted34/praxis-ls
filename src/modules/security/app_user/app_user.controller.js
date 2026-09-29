"use strict";
const { asyncHandler } = require("../../../utils/errors");
const service = require("./app_user.service");
const knownDevice = require("./known-device");

const actor = (req) => req.user || { user_id: null };
const list = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listUsers(c, req.query)) }));
const get = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.getUser(c, req.params.id)) }));
const linkableEmployees = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listLinkableEmployees(c)) }));
// `tenantId` is passed so the seat entitlement (WS-S3) can be checked against
// the tenant's plan. Absent it the check is skipped, which is the correct
// behaviour for any caller that has no tenant context rather than a silent
// bypass — there is no such caller on this route.
/** The link an invitation email points at — the requesting host, so it lands
 *  back on THIS tenant's workspace. Same derivation as forgotPassword. */
const linkOrigin = (req) =>
  `${process.env.NODE_ENV === "production" ? "https" : req.protocol}://${req.get("host")}`;

const create = asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => service.createUser(c, { data: req.body, actor: actor(req), tenantId: req.tenant && req.tenant.tenant_id, origin: linkOrigin(req) })) }));
/** Re-send an activation link — the invitation expired, or the first one bounced. */
const resendInvite = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.issueInvite(c, { userId: req.params.id, origin: linkOrigin(req), actor: actor(req) })) }));
const update = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.updateUser(c, { id: req.params.id, patch: req.body, actor: actor(req) })) }));
const setPassword = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.setPassword(c, { id: req.params.id, newPassword: req.body.new_password, actor: actor(req) })) }));
const setStatus = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: actor(req) })) }));
const getSignature = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.getSignature(c, req.params.id)) }));
const setSignature = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.setSignature(c, { id: req.params.id, html: req.body.html, actor: actor(req) })) }));

// ── Quick PIN — one per person, on any device ──
const pinStatus = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.getQuickPinStatus(c, req.user.user_id)) }));
const pinSet = asyncHandler(async (req, res) => res.json({
  data: await req.identityDb((c) => service.setQuickPin(c, {
    userId: req.user.user_id,
    pin: req.body.pin,
    // Fresh-auth: the session the request came from, or the current password.
    sessionId: req.user.session_id || null,
    currentPassword: req.body.current_password || null,
  })),
}));
const pinRemove = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.removeQuickPin(c, { userId: req.user.user_id })) }));
const pinLogin = asyncHandler(async (req, res) => {
  const result = await req.identityDb((c) => service.pinLogin(c, { email: req.body.email, pin: req.body.pin, ip: req.ip, userAgent: req.headers["user-agent"], environment: req.env }));
  if (result && result.access_token) await knownDevice.remember(req, res, { userId: result.user.user_id });
  res.json({ data: result });
});

// ── Retired with 14230: the per-device PIN routes, kept (deprecated) so a client
// bundle older than the change keeps working until it reloads. Each maps onto
// the ONE account PIN; "account" stands in for the device id they used to carry.
const LEGACY_PIN_DEVICE = "account";
const pinRegisterLegacy = asyncHandler(async (req, res) => {
  const r = await req.identityDb((c) => service.setQuickPin(c, {
    userId: req.user.user_id,
    pin: req.body.pin,
    sessionId: req.user.session_id || null,
    currentPassword: req.body.current_password || null,
  }));
  res.status(201).json({ data: { device_id: LEGACY_PIN_DEVICE, label: "Every device", status: "ACTIVE", created_at: r.created_at } });
});
const pinDevicesLegacy = asyncHandler(async (req, res) => {
  const st = await req.identityDb((c) => service.getQuickPinStatus(c, req.user.user_id));
  res.json({
    data: st.enabled
      ? [{ device_id: LEGACY_PIN_DEVICE, label: "Every device", status: "ACTIVE", failed_pin: 0, created_at: st.created_at, last_used_at: st.last_used_at }]
      : [],
  });
});
const pinRevokeLegacy = asyncHandler(async (req, res) => {
  await req.identityDb((c) => service.removeQuickPin(c, { userId: req.user.user_id }));
  res.json({ data: { revoked: true } });
});

/**
 * GET /auth/device — who this device belongs to, from the server's memory of
 * it (known-device.js). Public: it is read on the sign-in screen, before anyone
 * has a token, and answers `{ account: null }` for a device it does not know.
 */
const device = asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ data: await knownDevice.lookup(req) });
});

const login = asyncHandler(async (req, res) => {
  const result = await req.identityDb((client) =>
    service.login(client, {
      email: req.body.email,
      password: req.body.password,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      environment: req.env,
    }),
  );
  // A pending 2FA challenge is not a sign-in yet; the code that completes it is.
  if (result && result.access_token) await knownDevice.remember(req, res, { userId: result.user.user_id });
  res.json({ data: result });
});

const refresh = asyncHandler(async (req, res) => {
  const result = await req.identityDb((client) =>
    service.refresh(client, { refreshToken: req.body.refresh_token }),
  );
  res.json({ data: result });
});

const me = asyncHandler(async (req, res) =>
  res.json({ data: await req.identityDb((client) => service.me(client, req.user)) }),
);

const logout = asyncHandler(async (req, res) => {
  const result = await req.identityDb((client) =>
    service.logout(client, { actor: req.user, sessionId: req.body.session_id || null }),
  );
  res.json({ data: result });
});

const setAvatar = asyncHandler(async (req, res) => {
  const result = await req.identityDb((client) =>
    service.setAvatar(client, { userId: req.user.user_id, dataUrl: req.body.data_url, slug: req.tenant && req.tenant.slug }),
  );
  res.json({ data: result });
});

const forgotPassword = asyncHandler(async (req, res) => {
  // Same-origin per tenant → build the reset link from the requesting host so
  // the emailed link lands back on this tenant's workspace. Force https in prod.
  const proto = process.env.NODE_ENV === "production" ? "https" : req.protocol;
  const origin = `${proto}://${req.get("host")}`;
  const result = await req.identityDb((client) =>
    service.requestPasswordReset(client, { email: req.body.email, ip: req.ip, origin }),
  );
  res.json({ data: result });
});

const resetPassword = asyncHandler(async (req, res) => {
  const result = await req.identityDb((client) =>
    service.resetPassword(client, { token: req.body.token, newPassword: req.body.new_password, ip: req.ip }),
  );
  res.json({ data: result });
});

const changePassword = asyncHandler(async (req, res) => {
  const result = await req.identityDb((client) =>
    service.changeOwnPassword(client, {
      // Always the caller's own id — there is no target parameter on this route,
      // by design. Changing SOMEONE ELSE's password is /users/:id/password, which
      // is behind the MOD-67 edit grant.
      userId: req.user.user_id,
      currentPassword: req.body.current_password,
      newPassword: req.body.new_password,
      // Kept alive across the change; every other session is signed out.
      sessionId: req.user.session_id || null,
      ip: req.ip,
    }),
  );
  res.json({ data: result });
});

const verifyTotp = asyncHandler(async (req, res) => {
  const result = await req.identityDb((client) =>
    service.verifyTotp(client, {
      pendingToken: req.body.pending_token,
      code: req.body.code,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      environment: req.env,
    }),
  );
  if (result && result.access_token) await knownDevice.remember(req, res, { userId: result.user.user_id });
  res.json({ data: result });
});

const setupTotp = asyncHandler(async (req, res) => {
  res.json({ data: await req.identityDb((client) => service.setupTotp(client, req.user.user_id)) });
});

const enableTotp = asyncHandler(async (req, res) => {
  res.json({
    data: await req.identityDb((client) => service.enableTotp(client, req.user.user_id, req.body.code)),
  });
});

const disableTotp = asyncHandler(async (req, res) => {
  res.json({
    data: await req.identityDb((client) => service.disableTotp(client, req.user.user_id, req.body.code)),
  });
});

module.exports = {
  resendInvite,
  list, get, linkableEmployees, create, update, setPassword, setStatus, getSignature, setSignature,
  pinStatus, pinSet, pinRemove, pinLogin, device,
  pinRegisterLegacy, pinDevicesLegacy, pinRevokeLegacy,
  login,
  setAvatar,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyTotp,
  setupTotp,
  enableTotp,
  disableTotp,
  refresh,
  me,
  logout,
};
