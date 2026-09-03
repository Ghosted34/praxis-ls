"use strict";
const service = require("./costing.service");
const validator = require("./costing.validator");
module.exports = {
  entity: "costing", module_key: "MOD-46", screens: [],
  reads: [
    { key: "list_costings", service: service.list, permission: { module: "MOD-46", action: "view" }, describe: "List operations file costings. Filters: dossier_id, status, currency, q (reference / file / client), from, to." },
    { key: "get_costing", service: service.get, permission: { module: "MOD-46", action: "view" }, describe: "Get a costing with lines + totals (HT / VAT / TTC), and the amendment diff when it has been approved before and has since changed." },
    { key: "costing_kpis", service: service.kpis, permission: { module: "MOD-46", action: "view" }, describe: "Counts by status and total TTC in XAF, over the same filter list_costings takes." },
    // Read-only by design: it returns a PROPOSAL. The assistant may show it and
    // may create a costing from what the person picks, but suggesting is not
    // choosing — which is why this is a read and not a write.
    { key: "suggest_costing_lines", service: service.suggestLines, permission: { module: "MOD-46", action: "view" }, describe: "The standard charge set for an operations file, from its service type's BASIC/ADVANCED/FULL tiers, priced against the file's carrier and expanded one line per container type. Nothing is saved." },
  ],
  writes: [
    { key: "create_costing", service: service.createDraft, schema: validator.schemas.create, permission: { module: "MOD-46", action: "create" }, confirm: true, describe: "Create a DRAFT operations file costing (budget HT/VAT/TTC; débours pass-through §6.7 — no margin, §2.2)." },
    { key: "update_costing", service: (c, p) => (({ costing_id, lines, ...patch }) => service.updateDraft(c, { id: costing_id, patch, lines: lines || null }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-46", action: "edit" }, confirm: true, describe: "Edit a DRAFT costing by id." },
    { key: "costing_status", service: (c, p) => service.setStatus(c, { id: p.costing_id, to: p.to }), schema: validator.schemas.aiSetStatus, permission: { module: "MOD-46", action: "approve" }, confirm: true, describe: "Advance a costing by id (SUBMIT_VALIDATION→SUBMIT_APPROVAL→APPROVE, or REJECT)." },
    // The unlock loop (10718). Exposed for the same reason régie's retirement
    // is: the assistant could already APPROVE a costing, and approving is what
    // locks it. Leaving unlock off the manifest would let it reach a state it
    // has no way to leave. `approve` matches the strictest of the three actions
    // the route gates — the middleware still applies the per-action split.
    { key: "costing_unlock", service: (c, p) => service.unlockTransition(c, { id: p.costing_id, action: p.action, reason: p.reason }), schema: validator.schemas.aiUnlock, permission: { module: "MOD-46", action: "approve" }, confirm: true, describe: "Reopen an APPROVED_LOCKED costing: REQUEST_UNLOCK (needs a reason), then UNLOCK (returns it to DRAFT) or DENY_UNLOCK. Refused if the operations file's final invoice has left DRAFT." },
  ],
};
