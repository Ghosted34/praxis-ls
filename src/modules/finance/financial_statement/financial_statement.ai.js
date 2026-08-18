"use strict";
const service = require("./financial_statement.service");
module.exports = {
  entity: "financial_statement",
  module_key: "MOD-59",
  screens: [],
  reads: [
    { key: "get_trial_balance", service: service.trialBalance, permission: { module: "MOD-59", action: "view" }, describe: "Trial balance from the validated GL (per-account Σdebit/Σcredit)." },
    { key: "get_income_statement", service: service.compteDeResultat, permission: { module: "MOD-59", action: "view" }, describe: "Compte de résultat: charges (6), produits (7), result. KB §12." },
    { key: "get_balance_sheet", service: service.bilan, permission: { module: "MOD-59", action: "view" }, describe: "Bilan: active vs passif (classes 1-5) incl. period result. KB §12." },
    { key: "get_grand_livre", service: service.grandLivre, permission: { module: "MOD-59", action: "view" }, describe: "Grand livre: per-account validated movements with running balance." },
    { key: "get_cash_flow", service: service.cashFlow, permission: { module: "MOD-59", action: "view" }, describe: "Cash-flow summary (TAFIRE foundation): opening/closing cash, net change." },
  ],
  writes: [],
};
