"use strict";
const { asyncHandler } = require("../../../utils/errors");
const service = require("./template.service");
const actor = (req) => req.user || { user_id: null };

module.exports = {
  list: asyncHandler(async (_req, res) => res.json({ data: service.list() })),
  getConfig: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.getConfig(c, { docType: req.params.docType, entityId: req.query.entity_id || null })) })),
  setConfig: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setConfig(c, { docType: req.params.docType, entityId: req.body.entity_id || null, config: req.body.config || {}, actor: actor(req) })) })),
  records: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.records(c, req.params.docType)) })),
  preview: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.preview(c, { docType: req.params.docType, entityId: req.body.entity_id || null, recordId: req.body.record_id || null, config: req.body.config || null })) })),
  generate: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.generate(c, { docType: req.params.docType, entityId: req.body.entity_id || null, recordId: req.body.record_id || null, actor: actor(req) })) })),
  send: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.send(c, { docType: req.params.docType, recordId: req.params.id, entityId: req.body.entity_id || null, to: req.body.to, subject: req.body.subject, actor: actor(req) })) })),
};
