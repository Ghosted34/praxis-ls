"use strict";
// Event keys emitted by MOD-49 cash request / disbursal.

const transition = (status) => "cash_request." + String(status).toLowerCase();
module.exports = { MODULE: "MOD-49", CREATED: "cash_request.created", UPDATED: "cash_request.updated", ARCHIVED: "cash_request.archived", DISBURSED: "cash_request.disbursed", PARTIALLY_DISBURSED: "cash_request.partially_disbursed", JUSTIFIED: "cash_request.justified", transition };
