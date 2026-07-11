"use strict";
const service = require("./document_verification.service");
const { asyncHandler } = require("../../../utils/errors");
module.exports = {
  verify: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.verify(c, { docId: req.query.doc_id, entityRef: req.query.entity_ref, hash: req.query.hash })) })),
  scan: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.scan(c, { docId: req.query.doc_id, entityRef: req.query.entity_ref, hash: req.query.hash })) })),
};
