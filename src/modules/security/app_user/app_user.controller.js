"use strict";
const { asyncHandler } = require("../../../utils/errors");
const service = require("./app_user.service");

const actor = (req) => req.user || { user_id: null };
const list = asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listUsers(c, req.query)) }));
const get = asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.getUser(c, req.params.id)) }));
const create = asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.createUser(c, { data: req.body, actor: actor(req) })) }));
const update = asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.updateUser(c, { id: req.params.id, patch: req.body, actor: actor(req) })) }));
const setPassword = asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setPassword(c, { id: req.params.id, newPassword: req.body.new_password, actor: actor(req) })) }));
const setStatus = asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: actor(req) })) }));

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
  list, get, create, update, setPassword, setStatus,
  login,
  verifyTotp,
  setupTotp,
  enableTotp,
  disableTotp,
  refresh,
  logout,
};
