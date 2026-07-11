"use strict";
const service = require("./portal.service");
const validator = require("./portal.validator");
module.exports = {
  entity: "portal_access", module_key: "MOD-67", screens: [],
  reads: [
    { key: "list_portal_access", service: (c, p) => service.listAccess(c, p), describe: "List active portal access grants (client/investor/auditor)." },
    { key: "client_portal_view", service: (c, p) => service.clientView(c, { clientId: p.client_id }), describe: "A client's scoped view: their dossiers, invoices, receivables ageing." },
    { key: "investor_portal_view", service: (c, p) => service.investorView(c, { params: p }), describe: "Investor/board terminal: income statement + cash position." },
  ],
  writes: [
    { key: "grant_portal_access", service: (c, p) => service.grantAccess(c, p), schema: validator.schemas.grant, permission: { module: "MOD-67", action: "edit" }, confirm: true, describe: "Grant a client/investor/auditor portal access (auditor time-boxed)." },
  ],
};
