"use strict";
const { asyncHandler } = require("../../../utils/errors");
const { makeController } = require("../../../shared/crud/resource");
const service = require("./audit_ledger.service");

const crud = makeController(service, "Audit entry");

const listSoftDeletes = asyncHandler(async (req, res) => {
  res.json({ data: await req.tenantDb((client) => service.listSoftDeletes(client, req.query)) });
});

const requestRestore = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.requestRestore(client, { id: req.params.id, actor: req.user }),
  );
  res.json({ data: result });
});

const restore = asyncHandler(async (req, res) => {
  const result = await req.tenantDb((client) =>
    service.restore(client, { id: req.params.id, actor: req.user }),
  );
  res.json({ data: result });
});

module.exports = { ...crud, listSoftDeletes, requestRestore, restore };
