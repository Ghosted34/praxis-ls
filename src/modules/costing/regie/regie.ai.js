"use strict";
const service = require("./regie.service");
const validator = require("./regie.validator");

/**
 * The assistant must be able to FINISH what it can start. Before 10717 it could
 * issue an advance and age it, with no way to retire one — so it could open a
 * position in 581 and never close it, which is worse than not exposing régie at
 * all.
 *
 * Permission verbs mirror regie.routes.js exactly, so `action-authz.assertAllowed`
 * resolves each to the same column the HTTP route is gated on
 * (view/read→can_read, create→can_create, edit→can_update, approve→can_approve).
 */
module.exports = {
  entity: "regie_advance",
  module_key: "MOD-49",
  screens: [],
  reads: [
    { key: "list_regie_advances", service: service.list, permission: { module: "MOD-49", action: "view" }, describe: "List regie d'avances (cash advances). Filter by state, holder_user_id, or open=true." },
    { key: "get_regie_advance", service: service.get, permission: { module: "MOD-49", action: "view" }, describe: "Get one regie d'avance with its retirement ledger, open balance and available next states." },
    { key: "regie_watchlist", service: service.watchlist, permission: { module: "MOD-49", action: "view" }, describe: "Advances at or near their policy window — the aging watchlist." },
  ],
  writes: [
    { key: "issue_regie_advance", service: service.issue, schema: validator.schemas.issue, permission: { module: "MOD-49", action: "create" }, confirm: true, describe: "Issue a cash advance to a holder (Dr 581 / Cr treasury). KB 6.8 step 1." },
    { key: "retire_regie_advance", service: (c, p) => service.retire(c, { advanceId: p.regie_advance_id, kind: p.kind, dossierId: p.dossier_id, amount: p.amount, proofVaultId: p.proof_vault_id, memo: p.memo, entityId: p.entity_id, entryDate: p.entry_date, sourceDocRef: p.source_doc_ref }), schema: validator.schemas.aiRetire, permission: { module: "MOD-49", action: "edit" }, confirm: true, describe: "Record a receipt (Dr 4731 per dossier), returned cash (Dr 571) or a write-off (Dr 658) against an advance — all Cr 581. KB 6.8 steps 2/3/5." },
    { key: "query_regie_advance", service: (c, p) => service.query(c, { advanceId: p.regie_advance_id, reason: p.reason }), schema: validator.schemas.aiQuery, permission: { module: "MOD-49", action: "edit" }, confirm: true, describe: "Hold an advance as a query pending justification. No posting. KB 6.8 step 5." },
    { key: "write_off_regie_advance", service: (c, p) => service.writeOff(c, { advanceId: p.regie_advance_id, amount: p.amount, memo: p.memo, entityId: p.entity_id, entryDate: p.entry_date, sourceDocRef: p.source_doc_ref }), schema: validator.schemas.aiWriteOff, permission: { module: "MOD-49", action: "approve" }, confirm: true, describe: "Write an unrecoverable advance off to sundry charges (Dr 658 / Cr 581). Only from QUERIED; may open an approval chain." },
    { key: "unage_regie_advance", service: (c, p) => service.unage(c, { advanceId: p.regie_advance_id, reason: p.reason, entryDate: p.entry_date }), schema: validator.schemas.aiUnage, permission: { module: "MOD-49", action: "approve" }, confirm: true, describe: "Reverse an aging reclassification (Dr 581 / Cr 4211) after the holder justifies late." },
    { key: "age_regie_advances", service: service.ageDue, schema: validator.schemas.ageDue, permission: { module: "MOD-49", action: "approve" }, confirm: true, describe: "Reclassify unjustified advances past their window (Dr 4211 / Cr 581). KB 6.8." },
  ],
};
