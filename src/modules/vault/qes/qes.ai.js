/**
 * AI action manifest (AI_ARCHITECTURE §2) for QES — qualified electronic
 * signature, Tier 3 (MOD-64).
 *
 * READ-ONLY, and that is the module's own shape rather than a choice made here:
 * `qes.validator`'s header states that both endpoints are reads, because the
 * write side of Tier 3 is the signing handoff on the public page (against the
 * signer's own token) and the provider's signature-verified webhook. Neither is
 * a tenant-caller action, so neither can be an AI tool.
 *
 * What is left is what somebody actually asks: what does a certified signature
 * cost for this document type, and how much of our allowance is left.
 */
"use strict";

const service = require("./qes.service");

const MOD = "MOD-64";

module.exports = {
  entity: "qes",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "qes_quote", service: (c, p) => service.quote(c, { docType: p.doc_type, language: p.lang }), permission: { module: MOD, action: "create" }, describe: "What a qualified (certified) electronic signature costs for a document type, and whether it is available on this plan." },
    { key: "qes_usage", service: (c, p) => service.usage(c, { language: (p && p.lang) || "fr" }), permission: { module: MOD, action: "view" }, describe: "Certified-signature usage against the tenant's allowance." },
  ],

  writes: [],
};
