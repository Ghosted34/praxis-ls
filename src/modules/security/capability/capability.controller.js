"use strict";
const { asyncHandler } = require("../../../utils/errors");
const { makeController } = require("../../../shared/crud/resource");
const service = require("./capability.service");
// Capabilities are identity data (env-independent) — pin to the live schema.
const base = makeController(service, "Capability", { identity: true });

// The blanket capabilities a user holds (authority overlay).
const listForUser = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) => service.listForUser(c, req.params.userId));
  res.json({ data });
});

// Replace a user's blanket capability set. Body: { capability_ids: uuid[] }.
const setForUser = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) =>
    service.setForUser(c, {
      userId: req.params.userId,
      capabilityIds: req.body.capability_ids,
      actor: req.user,
    }),
  );
  res.json({ data });
});

module.exports = { ...base, listForUser, setForUser };
