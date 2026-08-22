"use strict";

const service = require("./document_signature.service");
const { asyncHandler } = require("../../../utils/errors");

const lang = (req) => (req.validatedQuery && req.validatedQuery.lang) || req.query.lang || "fr";

module.exports = {
  list: asyncHandler(async (req, res) => {
    const { entity_ref: entityRef } = req.validatedQuery;
    res.json({ data: await req.tenantDb((c) => service.listByRef(c, entityRef, { language: lang(req) })) });
  }),

  get: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.get(c, req.params.id, { language: lang(req) })) });
  }),

  menu: asyncHandler(async (req, res) => {
    const { doc_type: docType } = req.validatedQuery;
    res.json({ data: await req.tenantDb((c) => service.menu(c, { docType, language: lang(req) })) });
  }),

  sign: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.signInternal(c, {
      entityRef: b.entity_ref,
      docType: b.doc_type,
      presetCode: b.preset_code,
      signReason: b.sign_reason || null,
      markImageB64: b.mark_image_b64 || null,
      actor: req.user || {},
      // §3.13: captured server-side from the connection, never from the body.
      ip: req.ip,
      userAgent: req.get("user-agent") || null,
      language: lang(req),
    }));
    res.status(201).json({ data });
  }),

  revoke: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.revoke(c, {
      id: req.params.id, reason: req.body.reason, actor: req.user || {}, ip: req.ip, language: lang(req),
    }));
    res.json({ data });
  }),

  presets: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.presets(c)) });
  }),

  reasons: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.reasons(c)) });
  }),

  /** Who verified this signature, when, and from how many distinct addresses. */
  scans: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.scans(c, req.params.id, { language: lang(req) })) });
  }),

  stats: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.stats(c)) });
  }),
};
