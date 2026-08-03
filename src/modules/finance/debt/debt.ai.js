"use strict";
const service = require("./debt.service");
const validator = require("./debt.validator");
module.exports = {
  entity: "debt_engagement", ai_writes: false, module_key: "MOD-53", screens: [],
  reads: [
    { key: "list_debt", service: service.list, describe: "List debt engagements." },
    { key: "get_debt", service: service.get, describe: "Get a debt engagement with repayments + outstanding." },
  ],
  writes: [
    { key: "create_debt", service: service.createEngagement, schema: validator.schemas.create, permission: { module: "MOD-53", action: "create" }, confirm: true, describe: "Record a loan/financing engagement." },
    { key: "drawdown_debt", service: service.drawdown, schema: validator.schemas.drawdown, permission: { module: "MOD-53", action: "approve" }, confirm: true, describe: "Post loan drawdown (Dr treasury / Cr 162)." },
    { key: "repay_debt", service: service.repay, schema: validator.schemas.repay, permission: { module: "MOD-53", action: "approve" }, confirm: true, describe: "Post repayment (Dr 162 + interest / Cr treasury)." },
  ],
};
