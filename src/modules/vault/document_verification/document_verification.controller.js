"use strict";
const service = require("./document_verification.service");
const { asyncHandler } = require("../../../utils/errors");
const q = (req) => { const v = req.validatedQuery || {}; return { docId: v.doc_id, entityRef: v.entity_ref, hash: v.hash }; };
module.exports = {
  verify: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.verify(c, q(req))) })),
  scan: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.scan(c, q(req))) })),
};
