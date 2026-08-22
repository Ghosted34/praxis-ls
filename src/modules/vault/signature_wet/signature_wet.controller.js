"use strict";

const service = require("./signature_wet.service");
const { enqueue } = require("../../../jobs/queue-producer");
const { asyncHandler } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const actor = (req) => req.user || {};
const slug = (req) => (req.tenant && req.tenant.slug) || (req.context && req.context.tenantSlug) || "tenant";

module.exports = {
  issue: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.issue(c, {
      requestId: b.request_id || null,
      partyId: b.party_id || null,
      entityRef: b.entity_ref,
      docType: b.doc_type,
      documentVaultId: b.document_vault_id || null,
      actor: actor(req),
    }));
    res.status(201).json({ data });
  }),

  reprint: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.reprint(c, { id: req.params.id, actor: actor(req) }));
    res.status(201).json({ data });
  }),

  barcode: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.barcodeFor(c, req.params.id)) });
  }),

  markPrinted: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.markPrinted(c, { id: req.params.id, actor: actor(req) })) });
  }),

  ingest: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.ingest(c, {
      source: req.body.source,
      sourceRef: req.body.source_ref || null,
      dataUrl: req.body.data_url,
      actor: actor(req),
      slug: slug(req),
    }));
    if (req.tenant) {
      enqueue("signature-ingest-decode", "decode", {
        tenantMeta: req.tenant,
        env: req.get("x-praxis-env") === "sandbox" ? "sandbox" : "live",
        ingestId: data.ingest_id,
        actor: actor(req),
      }, { jobId: `signature-ingest-decode:${data.ingest_id}` }).catch((err) => {
        logger.warn({ err: err && err.message, ingest_id: data.ingest_id }, "signature ingest decode could not be enqueued");
      });
    }
    res.status(201).json({ data });
  }),

  decode: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.decodeAndReconcile(c, {
      ingestId: req.params.id,
      actor: actor(req),
      docTypeHint: req.body.doc_type_hint || null,
    }));
    res.json({ data });
  }),

  queue: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.queue(c, { limit: req.query.limit })) });
  }),

  bind: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.bind(c, {
      ingestId: req.params.id,
      printJobId: req.body.print_job_id,
      actor: actor(req),
    }));
    res.json({ data });
  }),

  reject: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.reject(c, {
      ingestId: req.params.id,
      reason: req.body.reason || null,
      actor: actor(req),
    }));
    res.json({ data });
  }),
};
