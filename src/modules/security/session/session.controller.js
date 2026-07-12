"use strict";
const { asyncHandler } = require("../../../utils/errors");
const { makeController } = require("../../../shared/crud/resource");
const service = require("./session.service");

const crud = makeController(service, "Session");

const mine = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((client) => service.mine(client, req.user)) });
});

const kill = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.kill(client, { id: req.params.id, actor: req.user }),
  );
  res.json({ data: result });
});

const killAllMine = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((client) => service.killAllMine(client, req.user)) });
});

module.exports = { ...crud, mine, kill, killAllMine };
