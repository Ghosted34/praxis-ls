"use strict";
const { asyncHandler } = require("../../../utils/errors");
const service = require("./app_user.service");

const actor = (req) => req.user || { user_id: null };
const list = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listUsers(c, req.query)) }));
const get = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.getUser(c, req.params.id)) }));
const linkableEmployees = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listLinkableEmployees(c)) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => service.createUser(c, { data: req.body, actor: actor(req) })) }));
const update = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.updateUser(c, { id: req.params.id, patch: req.body, actor: actor(req) })) }));
const setPassword = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.setPassword(c, { id: req.params.id, newPassword: req.body.new_password, actor: actor(req) })) }));
const setStatus = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: actor(req) })) }));
const getSignature = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.getSignature(c, req.params.id)) }));
const setSignature = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.setSignature(c, { id: req.params.id, html: req.body.html, actor: actor(req) })) }));

const pinRegister = asyncHandler(async (req, res) => res.status(201).json({ data: await req.identityDb((c) => service.registerPinDevice(c, { userId: req.user.user_id, pin: req.body.pin, label: req.body.label })) }));
const pinLogin = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.pinLogin(c, { email: req.body.email, deviceId: req.body.device_id, pin: req.body.pin, ip: req.ip, userAgent: req.headers["user-agent"], environment: req.env, keepSignedIn: req.body.keep_signed_in === true })) }));
const pinDevices = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.listPinDevices(c, req.user.user_id)) }));
const pinRevoke = asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => service.revokePinDevice(c, { userId: req.user.user_id, deviceId: req.params.deviceId })) }));

const login = asyncHandler(async (req, res) => {
  const result = await req.identityDb((client) =>
    service.login(client, {
      email: req.body.email,
      password: req.body.password,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      environment: req.env,
      // "Keep me signed in" — exempts the session from the idle kill (0494).
      keepSignedIn: req.body.keep_signed_in === true,
    }),
  );
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

const verifyTotp = asyncHandler(async (req, res) => {
  const result = await req.identityDb((client) =>
    service.verifyTotp(client, {
      pendingToken: req.body.pending_token,
      code: req.body.code,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      environment: req.env,
      // Carried through the 2FA step too, or ticking the box then completing
      // TOTP would silently lose the choice (0494).
      keepSignedIn: req.body.keep_signed_in === true,
    }),
  );
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
  list, get, linkableEmployees, create, update, setPassword, setStatus, getSignature, setSignature,
  pinRegister, pinLogin, pinDevices, pinRevoke,
  login,
  setAvatar,
  forgotPassword,
  resetPassword,
  verifyTotp,
  setupTotp,
  enableTotp,
  disableTotp,
  refresh,
  me,
  logout,
};
