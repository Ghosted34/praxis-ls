"use strict";

const service = require("./document_signature.service");
const signingProof = require("./signing-proof.service");
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

  /**
   * What the client needs to ask for the signer's fingerprint or face on ONE
   * document: the ceremony bound to its current content hash, or
   * `has_passkey: false` so the client offers the two-tap setup first.
   */
  proofOptions: asyncHandler(async (req, res) => {
    const { entity_ref: entityRef, doc_type: docType } = req.body;
    const contentHash = await req.tenantDb((c) => signingProof.currentHash(c, { docType, entityRef }));
    const data = await req.identityDb((c) => signingProof.passkeyOptions(c, {
      userId: req.user.user_id, entityRef, contentHash, req,
    }));
    res.json({ data });
  }),

  /** The fallback: email the signer a six-digit code bound to this document. */
  proofOtp: asyncHandler(async (req, res) => {
    const { entity_ref: entityRef, doc_type: docType } = req.body;
    const data = await req.tenantDb((c) => signingProof.sendOtp(c, { actor: req.user || {}, docType, entityRef }));
    res.json({ data });
  }),

  sign: asyncHandler(async (req, res) => {
    const b = req.body;
    const proof = await signingProof.fromRequest(req);
    const data = await req.tenantDb(async (c) => service.signInternal(c, {
      settled: await signingProof.settle(c, { actor: req.user || {}, docType: b.doc_type, entityRef: b.entity_ref, proof }),
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
