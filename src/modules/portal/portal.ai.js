"use strict";
const service = require("./portal.service");
const clientPortal = require("./portal_client.service");
const validator = require("./portal.validator");
const { schemas: portalSchemas } = require("../portal_auth/portal_auth.validator");
module.exports = {
  entity: "portal_access", module_key: "MOD-67", screens: [],
  reads: [
    { key: "list_portal_access", service: (c, p) => service.listAccess(c, p), permission: { module: "MOD-67", action: "view" }, describe: "List active portal access grants (client/investor/auditor)." },
    { key: "client_portal_view", service: (c, p) => service.clientView(c, { clientId: p.client_id }), permission: { module: "MOD-29", action: "view" }, describe: "A client's scoped view: their operations files, invoices, receivables ageing." },
    { key: "investor_portal_view", service: (c, p) => service.investorView(c, { params: p }), permission: { module: "MOD-56", action: "view" }, describe: "Investor/board terminal: income statement + cash position." },
    // Client portal redesign (14150): what we are waiting for from clients, and
    // the payments clients say they have made.
    { key: "list_client_requests", service: (c, p) => clientPortal.staffRequests(c, { clientId: p.client_id || null, status: p.status || null }), permission: { module: "MOD-29", action: "view" }, describe: "Documents and information requested from clients through the portal, with what each client sent back (status OPEN / SUBMITTED / ACCEPTED / REJECTED)." },
    { key: "list_payment_proofs", service: (c, p) => clientPortal.staffProofs(c, { status: p.status || null, clientId: p.client_id || null }), permission: { module: "MOD-52", action: "view" }, describe: "Proofs of payment clients uploaded in the portal, the invoices each covers, and whether finance has confirmed them." },
  ],
  writes: [
    { key: "grant_portal_access", service: (c, p, actor) => service.grantAccess(c, { portal: p.portal, subjectEmail: p.subject_email, clientId: p.client_id, expiresAt: p.expires_at, accessScope: p.access_scope, isClientAdmin: p.is_client_admin, actor }), schema: validator.schemas.grant, permission: { module: "MOD-67", action: "edit" }, confirm: true, describe: "Grant a client/investor/auditor portal access (auditor time-boxed; a client grant can be limited to OPERATIONS or BILLING)." },
    { key: "request_client_document", service: (c, p, actor) => clientPortal.createRequest(c, { clientId: p.client_id, dossierId: p.dossier_id || null, kind: p.kind, docTypeCode: p.doc_type_code || null, title: p.title || null, note: p.note || null, dueOn: p.due_on || null, actor }), schema: portalSchemas.staffCreateRequest, permission: { module: "MOD-29", action: "edit" }, confirm: true, describe: "Ask a client, in their portal, for a document (by document type) or a piece of information, optionally for one shipment and by a due date." },
    { key: "review_client_request", service: (c, p, actor) => clientPortal.reviewRequest(c, { requestId: p.client_request_id, decision: p.decision, note: p.note || null, actor }), schema: validator.schemas.aiReviewRequest, permission: { module: "MOD-29", action: "edit" }, confirm: true, describe: "Accept or reject (with the reason the client reads) what a client sent for a request, or cancel the request." },
    { key: "confirm_payment_proof", service: (c, p, actor) => clientPortal.confirmProof(c, { proofId: p.payment_proof_id, treasuryAccountId: p.treasury_account_id || null, actor }), schema: validator.schemas.aiConfirmProof, permission: { module: "MOD-52", action: "create" }, confirm: true, describe: "Confirm a client's proof of payment; when it names invoices a DRAFT receipt is created for finance to post." },
    { key: "reject_payment_proof", service: (c, p, actor) => clientPortal.rejectProof(c, { proofId: p.payment_proof_id, note: p.note, actor }), schema: validator.schemas.aiRejectProof, permission: { module: "MOD-52", action: "edit" }, confirm: true, describe: "Reject a client's proof of payment, with the reason the client will read." },
  ],
};
