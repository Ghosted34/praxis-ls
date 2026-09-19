"use strict";
const service = require("./tax_jurisdiction.service");
const validator = require("./tax_jurisdiction.validator");
module.exports = {
  entity: "tax_jurisdiction", module_key: "MOD-07", screens: [],
  reads: [
    { key: "list_tax_jurisdictions", service: service.list, permission: { module: "MOD-07", action: "view" }, describe: "List tax jurisdictions." },
    { key: "get_tax_jurisdiction", service: service.get, permission: { module: "MOD-07", action: "view" }, describe: "Get a jurisdiction with its tax codes." },
    { key: "list_tax_codes", service: service.listCodes, permission: { module: "MOD-07", action: "view" }, describe: "List tax codes under a jurisdiction." },
    { key: "effective_tax_code", service: service.effectiveCode, permission: { module: "MOD-07", action: "view" }, describe: "Resolve the tax code effective at a date." },
  ],
  writes: [
    { key: "create_tax_jurisdiction", service: (c, p, actor) => service.createJurisdiction(c, { countryCode: p.country_code, name: p.name, currency: p.currency, actor }), schema: validator.schemas.create, permission: { module: "MOD-07", action: "create" }, confirm: true, describe: "Create a tax jurisdiction." },
    { key: "add_tax_code", service: (c, p, actor) => service.addCode(c, { jurisdictionId: p.jurisdiction_id, code: p.code, kind: p.kind, ratePercent: p.rate_percent, baseRule: p.base_rule, appliesTo: p.applies_to, recoverable: p.recoverable, postsDebitAccount: p.posts_debit_account, postsCreditAccount: p.posts_credit_account, brackets: p.brackets, effectiveFrom: p.effective_from, effectiveTo: p.effective_to, legalReference: p.legal_reference, actor }), schema: validator.schemas.aiAddCode, permission: { module: "MOD-07", action: "create" }, confirm: true, describe: "Add an effective-dated tax code (TVA/WHT/IS/min)." },
  ],
};
