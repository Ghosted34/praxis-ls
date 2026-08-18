"use strict";
const service = require("./partnership_request.service");
const validator = require("./partnership_request.validator");
module.exports = {
  entity: "partnership_request",
  module_key: "MOD-25",
  screens: [],
  reads: [
    { key: "list_partnership_requests", service: (c, p) => service.list(c, p).then((r) => ({ rows: r.rows, total: r.total, kpi: r.kpi })), permission: { module: "MOD-25", action: "view" }, describe: "List partnership / vendor applications. Returns rows + total + the KPI tiles (total, agency partnerships, vendor registrations, pending review), computed from two partitions that each sum to the total." },
    { key: "get_partnership_request", service: (c, p) => service.get(c, p.id || p), permission: { module: "MOD-25", action: "view" }, describe: "Get one partnership application by id, including its network memberships and vetting notes." },
  ],
  writes: [
    { key: "create_partnership_request", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-25", action: "create" }, confirm: true, describe: "Record a partnership or vendor application. `network_memberships` is how a forwarding agent is vetted — WCA, JCTrans and similar." },
    { key: "review_partnership_request", service: (c, p) => service.transition(c, { id: p.partnership_request_id, to: p.to, reason: p.reason }), schema: validator.schemas.aiTransition, permission: { module: "MOD-25", action: "edit" }, confirm: true, describe: "Move an application to IN_REVIEW, reject it (a reason is required), or re-open a rejected one. Approval is a separate action — it can create a supplier." },
    { key: "approve_partnership_request", service: (c, p) => service.approve(c, { id: p.partnership_request_id, create_supplier: p.create_supplier, supplier: p.supplier || {} }), schema: validator.schemas.aiApprove, permission: { module: "MOD-25", action: "approve" }, confirm: true, describe: "Approve an application. A VENDOR_REGISTRATION always creates a DRAFT supplier (nothing payable until somebody verifies it); an AGENCY_PARTNERSHIP does so only when create_supplier is true. An existing supplier with the same name is reused, never duplicated." },
  ],
};
