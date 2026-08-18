"use strict";
const service = require("./debt.service");
const validator = require("./debt.validator");
module.exports = {
  entity: "debt_engagement", ai_writes: false, module_key: "MOD-53", screens: [],
  reads: [
    { key: "list_debt", service: service.list, permission: { module: "MOD-53", action: "view" }, describe: "List debt engagements." },
    { key: "get_debt", service: service.get, permission: { module: "MOD-53", action: "view" }, describe: "Get a debt engagement with repayments + outstanding." },
  ],
  writes: [
    { key: "create_debt", service: (c, p) => service.createEngagement(c, { entityId: p.entity_id, dossierId: p.dossier_id, lenderKind: p.lender_kind, lenderName: p.lender_name, principal: p.principal, currency: p.currency, interestRate: p.interest_rate, coaCode: p.coa_code, startedOn: p.started_on, dueOn: p.due_on }), schema: validator.schemas.create, permission: { module: "MOD-53", action: "create" }, confirm: true, describe: "Record a loan/financing engagement." },
    { key: "drawdown_debt", service: (c, p) => service.drawdown(c, { id: p.debt_id, entityId: p.entity_id, entryDate: p.entry_date, sourceDocRef: p.source_doc_ref, treasuryCoa: p.treasury_coa }), schema: validator.schemas.aiDrawdown, permission: { module: "MOD-53", action: "approve" }, confirm: true, describe: "Post a loan drawdown (by debt id): Dr treasury / Cr 162." },
    { key: "repay_debt", service: (c, p) => service.repay(c, { id: p.debt_id, entityId: p.entity_id, entryDate: p.entry_date, principalPart: p.principal_part, interestPart: p.interest_part, treasuryCoa: p.treasury_coa, interestCoa: p.interest_coa, sourceDocRef: p.source_doc_ref }), schema: validator.schemas.aiRepay, permission: { module: "MOD-53", action: "approve" }, confirm: true, describe: "Post a repayment (by debt id): Dr 162 + interest / Cr treasury." },
  ],
};
