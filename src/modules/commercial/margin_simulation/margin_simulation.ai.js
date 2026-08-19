"use strict";
/**
 * AI manifest (MOD-27 margin simulation). §3.1 adds one read: the LINK COSTING
 * import ("price this file from its costing"). Submitting stays exposed as a
 * confirm-gated write; approving/rejecting are NOT here — they are decisions
 * that name a responsible human (maker-checker), same rule as MOD-09/MOD-47.
 */
const service = require("./margin_simulation.service");
const validator = require("./margin_simulation.validator");
module.exports = {
  entity: "margin_simulation", module_key: "MOD-27", screens: [],
  reads: [
    { key: "list_margin_simulations", service: service.list, permission: { module: "MOD-27", action: "view" }, describe: "List margin simulations (with status: DRAFT/SUBMITTED/APPROVED/REJECTED)." },
    { key: "get_margin_simulation", service: service.get, permission: { module: "MOD-27", action: "view" }, describe: "Get a margin simulation with lines, per-line margin/KPI and totals (incl. VAT)." },
    { key: "margin_simulation_from_costing", service: (c, p) => service.fromCosting(c, { costingId: p.costing_id || p.costingId || p }), permission: { module: "MOD-27", action: "view" }, describe: "LINK COSTING: a costing's lines mapped for import into the simulator (converted to XAF at the costing's own rate)." },
  ],
  writes: [
    // The write adapter hands the raw snake_case payload straight to the
    // service; the old manifest passed `service.create` directly, whose
    // camelCase destructure silently dropped dossier_id/service_type_id —
    // an AI-created simulation lost its file link. Map explicitly.
    { key: "create_margin_simulation", service: (c, p, a) => service.create(c, { dossierId: p.dossier_id || null, serviceTypeId: p.service_type_id || null, costingId: p.costing_id || null, currency: p.currency, lines: p.lines || [], actor: a || {} }), schema: validator.schemas.compute, permission: { module: "MOD-27", action: "create" }, confirm: true, describe: "Compute + persist a margin simulation (margin on services only)." },
  ],
};
