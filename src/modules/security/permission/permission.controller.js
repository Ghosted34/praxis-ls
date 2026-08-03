"use strict";
const { asyncHandler } = require("../../../utils/errors");
const { makeController } = require("../../../shared/crud/resource");
const service = require("./permission.service");

// RBAC grants are identity data (env-independent) — pin to the live schema so
// the grant matrix is the same one the enforcement path (rbac.js) reads.
const base = makeController(service, "Permission", { identity: true });

// Every grant, unpaginated — the matrix needs the complete role×module picture
// or it silently wipes the grants it can't see. See permission.repo.listAll.
const matrix = asyncHandler(async (req, res) => {
  res.json({ data: await req.identityDb((c) => service.listAll(c)) });
});

// Upsert a role×module grant (the grant-matrix write). Body: { role_id,
// module_key, can_create, can_read, can_update, can_delete, can_approve }.
const upsertGrant = asyncHandler(async (req, res) => {
  const data = await req.identityDb((c) => service.upsertGrant(c, { data: req.body, actor: req.user }));
  res.json({ data });
});

module.exports = { ...base, matrix, upsertGrant };
