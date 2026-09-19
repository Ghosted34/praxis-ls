/**
 * AI action manifest (AI_ARCHITECTURE §2) for document templates (MOD-70).
 *
 * The Studio side: which document types this deployment renders, and how each
 * one is configured for the tenant (letterhead, language, the fields it shows).
 *
 * ── WHY `preview`, `generate`, `send` AND `compose` ARE NOT HERE ────────────
 *
 * Those routes are gated by `requireDocTypePermission`, which resolves the
 * OWNING module from the doc type in the URL (`moduleKeyForDocType`) and then
 * checks the caller's grants for it — a payslip needs the payroll grant, a
 * purchase request needs MOD-62. That lookup runs on `req.identityDb`, and the
 * AI adapters hand a manifest exactly one client, the tenant one.
 *
 * A manifest action carries ONE static permission, so wiring them would mean
 * declaring MOD-70 for all of them — and MOD-70 is the Studio administrator's
 * grant, which the route lets through IN ADDITION to the owning module's. The
 * result would be a copilot that generates and emails any document type to
 * anyone holding the Studio grant, which is precisely the skeleton key the
 * document-type gate exists to prevent (the same shape as SEC-M3 in the vault).
 *
 * `list` and the config pair ARE here: their routes carry a plain
 * `requirePermission(MOD-70, …)` and nothing else, so the assistant's reach
 * matches the caller's exactly.
 */
"use strict";

const service = require("./template.service");
const validator = require("./template.validator");

const MOD = "MOD-70";

module.exports = {
  entity: "document_template",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_document_templates", service: () => service.list(), permission: { module: MOD, action: "view" }, describe: "Every document type this deployment can render, with its key and title." },
    { key: "get_document_template_config", service: (c, p) => service.getConfig(c, { docType: p.doc_type, entityId: p.entity_id || null }), permission: { module: MOD, action: "view" }, describe: "The tenant's configuration for one document type (letterhead, language, which fields print), optionally for one corporate entity." },
  ],

  writes: [
    {
      key: "set_document_template_config",
      service: (c, p, actor) => service.setConfig(c, { docType: p.doc_type, entityId: p.entity_id || null, config: p.config || {}, actor }),
      schema: validator.schemas.aiSetConfig,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Change how one document type prints for this tenant (or for one corporate entity).",
    },
  ],
};
