"use strict";
const { asyncHandler } = require("../../../utils/errors");
const { makeController } = require("../../../shared/crud/resource");
const service = require("./permission.service");

const base = makeController(service, "Permission");

// Upsert a role×module grant (the grant-matrix write). Body: { role_id,
// module_key, can_create, can_read, can_update, can_delete, can_approve }.
const upsertGrant = asyncHandler(async (req, res) => {
  const data = await req.tenantDb((c) => service.upsertGrant(c, { data: req.body, actor: req.user }));
  res.json({ data });
});

module.exports = { ...base, upsertGrant };
