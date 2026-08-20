"use strict";
const service = require("./deliverability.service");
const { asyncHandler } = require("../../../utils/errors");

module.exports = {
  list: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.dashboard(c)),
  })),
  check: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => (
      req.body && req.body.domain
        ? service.checkOne(c, req.body.domain, { smtpHost: req.body.smtp_host || null })
        : service.checkAll(c)
    )),
  })),
  history: asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => service.history(c, req.params.domain, req.query)),
  })),
};
