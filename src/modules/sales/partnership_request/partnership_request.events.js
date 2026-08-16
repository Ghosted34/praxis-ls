"use strict";
module.exports = {
  MODULE: "MOD-25",
  CREATED: "partnership_request.created",
  UPDATED: "partnership_request.updated",
  APPROVED: "partnership_request.approved",
  REJECTED: "partnership_request.rejected",
  DOCUMENT_ATTACHED: "partnership_request.document_attached",
  SUPPLIER_DRAFTED: "partnership_request.supplier_drafted",
  transition: (status) => "partnership_request." + String(status).toLowerCase(),
};
