"use strict";
const { asyncHandler } = require("../../../utils/errors");
const service = require("./template.service");
const actor = (req) => req.user || { user_id: null };

/**
 * The host a printed QR should resolve on.
 *
 * Taken from the request rather than from config: a tenant is reached at its
 * OWN subdomain (middleware/host-tenent-resolver.js), so by the time this
 * handler runs the request has already proved which host this tenant answers
 * on. Deriving it any other way would risk printing a QR for a host the tenant
 * is not served from — and a wrong host on paper cannot be corrected later.
 */
const origin = (req) => `${req.protocol}://${req.get("host")}`;

module.exports = {
  list: asyncHandler(async (_req, res) => res.json({ data: service.list() })),
  getConfig: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.getConfig(c, { docType: req.params.docType, entityId: req.query.entity_id || null })) })),
  setConfig: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.setConfig(c, { docType: req.params.docType, entityId: req.body.entity_id || null, config: req.body.config || {}, actor: actor(req) })) })),
  records: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.records(c, req.params.docType)) })),
  preview: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.preview(c, { docType: req.params.docType, entityId: req.body.entity_id || null, recordId: req.body.record_id || null, config: req.body.config || null, origin: origin(req) })) })),
  generate: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.generate(c, { docType: req.params.docType, entityId: req.body.entity_id || null, recordId: req.body.record_id || null, actor: actor(req), origin: origin(req) })) })),
  send: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.send(c, { docType: req.params.docType, recordId: req.params.id, entityId: req.body.entity_id || null, to: req.body.to, subject: req.body.subject, actor: actor(req), origin: origin(req) })) })),
};
