"use strict";
const service = require("./final_invoice.service");
const validator = require("./final_invoice.validator");
const { AppError } = require("../../../utils/errors");
module.exports = {
  entity: "final_invoice",
  module_key: "MOD-51",
  screens: [],
  reads: [
    { key: "list_final_invoices", service: service.list, permission: { module: "MOD-51", action: "view" }, describe: "List final invoices (filter status/client)." },
    { key: "get_final_invoice", service: service.get, permission: { module: "MOD-51", action: "view" }, describe: "Get a final invoice by id, with its lines." },
  ],
  writes: [
    { key: "draft_final_invoice", service: service.createDraft, schema: validator.schemas.createDraft, permission: { module: "MOD-51", action: "create" }, confirm: true, describe: "Create a DRAFT final invoice (no GL yet)." },
    // §2.7 — the assistant may edit an invoice; it may NOT release the
    // pricing guard. `pricing_override` is refused rather than forwarded.
    //
    // On the HTTP route that release is gated on `approve` + the APPROVER
    // authority (routes.js OVERRIDE_GATE). This surface cannot express that:
    // an AI action carries ONE flat `required_permission` and no capability
    // layer (services/ai/action-authz.js), so the choice is all-or-nothing —
    // either every AI invoice edit demands `approve`, which makes the tool
    // useless for the ordinary correction it exists for, or overriding rides
    // in on `edit` and the gate is worth nothing.
    //
    // Neither, then. Deciding to bill a client for something they never agreed
    // to is a human's call, made by a named person who answers for it. The
    // refusal is explicit so the model says so plainly instead of retrying.
    {
      key: "update_final_invoice",
      service: (c, p, a) => {
        if (p.pricing_override) {
          throw new AppError(
            "OVERRIDE_NOT_VIA_AI",
            "Billing off-quotation cannot be done through the assistant — it needs an approver on the invoice screen. Correct the lines to match the accepted quotation, or ask an approver to override it there.",
            403,
          );
        }
        return service.updateDraft(c, {
          invoiceId: p.invoice_id,
          patch: { client_id: p.client_id, dossier_id: p.dossier_id },
          lines: p.lines || null,
          actor: a || {},
        });
      },
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-51", action: "edit" },
      confirm: true,
      describe:
        "Edit a DRAFT final invoice by id. Lines must match the dossier's accepted quotation. Billing something unquoted is not available here — it needs an approver on the invoice screen.",
    },
    { key: "submit_final_invoice", service: (c, p) => service.submit(c, { invoiceId: p.invoice_id, entryDate: p.entry_date, sourceDocRef: p.source_doc_ref }), schema: validator.schemas.aiSubmit, permission: { module: "MOD-51", action: "approve" }, confirm: true, describe: "Submit a final invoice by id; auto-posts (revenue+débours+VAT, clears advance, numbers + captures the doc) when no workflow is bound. KB §8.3." },
  ],
};
