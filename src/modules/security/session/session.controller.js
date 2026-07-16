"use strict";
const { asyncHandler } = require("../../../utils/errors");
const { makeController } = require("../../../shared/crud/resource");
const service = require("./session.service");

// Sessions are identity data (env-independent) — pin to the live schema so the
// sessions UI works identically under LIVE and TEST.
const crud = makeController(service, "Session", { identity: true });

const mine = asyncHandler(async (req, res) => {
  res.json({ data: await req.identityDb((client) => service.mine(client, req.user)) });
});

const kill = asyncHandler(async (req, res) => {
  const result = await req.identityDb((client) =>
    service.kill(client, { id: req.params.id, actor: req.user }),
  );
  res.json({ data: result });
});

const killAllMine = asyncHandler(async (req, res) => {
  res.json({ data: await req.identityDb((client) => service.killAllMine(client, req.user)) });
});

module.exports = { ...crud, mine, kill, killAllMine };
