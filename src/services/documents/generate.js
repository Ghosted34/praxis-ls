/**
 * Auto-generate a document PDF on a lifecycle event (doc/DOCUMENT_TEMPLATES_PLAN.md
 * §6). Fire-and-forget: enqueues a `pdf`/`document` job (built + rendered + vaulted
 * in the worker via templates/registry) and never throws, so a rendering hiccup or
 * an absent queue can't break the issuing action. Call from a controller (which has
 * `req.tenant` = tenantMeta and `req.env`) right after the doc is issued.
 */
"use strict";
const { enqueue } = require("../../jobs/queue-producer");
const { logger } = require("../../config/logger");

function enqueueDocument({ tenantMeta, env = "live", docType, recordId, entityId = null }) {
  if (!tenantMeta || !docType || !recordId) return;
  Promise.resolve()
    .then(() => enqueue("pdf", "document", { tenantMeta, env, docType, recordId, entityId }))
    .catch((err) => logger.warn({ err: err && err.message, docType, recordId }, "document render enqueue failed"));
}

module.exports = { enqueueDocument };
