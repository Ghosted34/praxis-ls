"use strict";
const { asyncHandler } = require("../../../utils/errors");
const { makeController } = require("../../../shared/crud/resource");
const service = require("./app_user.service");

const crud = makeController(service, "User");

const login = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.login(client, {
      email: req.body.email,
      password: req.body.password,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      environment: req.env,
    }),
  );
  res.json({ data: result });
});

const refresh = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.refresh(client, { refreshToken: req.body.refresh_token }),
  );
  res.json({ data: result });
});

const logout = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.logout(client, { actor: req.user, sessionId: req.body.session_id || null }),
  );
  res.json({ data: result });
});

const verifyTotp = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.verifyTotp(client, {
      pendingToken: req.body.pending_token,
      code: req.body.code,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      environment: req.env,
    }),
  );
  res.json({ data: result });
});

const setupTotp = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((client) => service.setupTotp(client, req.user.user_id)) });
});

const enableTotp = asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDb((client) => service.enableTotp(client, req.user.user_id, req.body.code)),
  });
});

const disableTotp = asyncHandler(async (req, res) => {
  res.json({
    data: await req.tenantDb((client) => service.disableTotp(client, req.user.user_id, req.body.code)),
  });
});

module.exports = {
  ...crud,
  login,
  verifyTotp,
  setupTotp,
  enableTotp,
  disableTotp,
  refresh,
  logout,
};
