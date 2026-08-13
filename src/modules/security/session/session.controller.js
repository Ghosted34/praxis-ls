"use strict";
const { asyncHandler } = require("../../../utils/errors");
const { makeController } = require("../../../shared/crud/resource");
const { withResult } = require("../../../shared/crud/with-result");
const service = require("./session.service");

// Sessions are identity data (env-independent) — pin to the live schema so the
// sessions UI works identically under LIVE and TEST.
const crud = makeController(service, "Session", { identity: true });

const mine = asyncHandler(async (req, res) => {
  res.json({ data: await req.identityDb((client) => service.mine(client, req.user)) });
});

// kill + killAllMine are action endpoints — the reference adoption of the
// mutation envelope (see src/shared/crud/with-result.js and
// doc/ERROR_HANDLING.md). withResult sends
// { ok, changed:true, data } on a real revocation and
// { ok, changed:false, message } when the session was already revoked, which
// is what makes the client's "That session was already revoked" toast honest.
const kill = withResult(
  (req) => req.identityDb((client) => service.kill(client, { id: req.params.id, actor: req.user })),
  { idle: "That session was already revoked." },
);

const killAllMine = withResult(
  (req) => req.identityDb((client) => service.killAllMine(client, req.user)),
  { idle: "No other sessions to revoke." },
);

module.exports = { ...crud, mine, kill, killAllMine };
