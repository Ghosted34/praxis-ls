"use strict";
const { asyncHandler } = require("../../../utils/errors");
const service = require("./auth.service");

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

module.exports = { login, refresh, logout };
