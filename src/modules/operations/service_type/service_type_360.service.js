/**
 * Service type 360° aggregation. One call returns everything the service-type
 * page renders: the row itself, the header stat strip, every milestone template
 * version with its stages, the financial dictionary items scoped to this
 * service (plus the generic bucket), the recent dossiers, the margin sims and
 * a per-currency money rollup (planned costing / actual GL / billed FINAL
 * invoices), and a small readiness checklist.
 *
 * Built to render for a BRAND-NEW service type with zero downstream data — every
 * collection defaults to `[]` and every figure to `0`, so the page after
 * "New service type" is a working page rather than an error (matches the
 * party-360 / entity-360 rule for freshly created records).
 *
 * WHY THIS EXISTS. `service_type.service.js` says it — "services as DATA, not
 * code" — but the list screen only showed the row's own columns plus a template
 * version count. Everything else the row governs (which dictionary lines
 * surface, which dossiers were classified this way, whether an active template
 * exists at all) sat in other modules with no rollup. This is the rollup.
 *
 * MONEY VISIBILITY. Billed / planned / actual arrive nulled for a caller without
 * finance visibility (`canSeeFinancials`, MOD-09 read). Same rule as the two
 * party masters; a service-type page a Sales/Ops user opens still renders, but
 * without the money numbers. The `money.masked` flag tells the UI to say so
 * rather than silently render zeros.
 */
"use strict";
const repo = require("./service_type.repo");
const detailRepo = require("../shipment_details/shipment_details.repo");
const { canSeeFinancials } = require("../../master/_shared/confidential");
const { AppError } = require("../../../utils/errors");

/**
 * Zero-collection defaults. Kept in one place so a fresh service type and a
 * missing sub-query both fall to the same empty shape — the UI's empty-state
 * rendering has one contract to honour.
 */
const EMPTY_STATS = {
  dossiers_total: 0,
  dossiers_open: 0,
  dossiers_in_progress: 0,
  dossiers_completed: 0,
  dossiers_cancelled: 0,
  template_versions: 0,
  active_template_version: null,
  dictionary_items: 0,
  margin_simulations: 0,
};

/**
 * Money rollup masked to zeros for a caller who cannot see finance. The
 * per-currency arrays become empty (rather than dropped) so the UI can still
 * render "no billed revenue on this service yet" without special-casing masked
 * vs. genuinely empty.
 */
function maskMoney(rollup, canSee) {
  if (canSee) return { ...rollup, masked: false };
  return { planned: [], billed: [], actual_total: 0, masked: true };
}

/**
 * @param {object} c            tenant db client
 * @param {string} serviceTypeId
 * @param {object} opts         { canSeeFinancials? }
 */
async function dossier(c, serviceTypeId, { canSeeFinancials: canSee = false } = {}) {
  // `findById`, not `get`. The two factories in shared/crud/resource.js draw the
  // line deliberately: a REPO exposes `findById` (line 143) and a SERVICE exposes
  // `get` (line 196, itself a wrapper over repo.findById). Calling the
  // service-level name on the repo threw `repo.get is not a function` on every
  // request to this endpoint.
  //
  // It reads as a safe call because a dozen other modules do say `repo.get` —
  // but those repos declare their own `get` on top of the factory. This one
  // does not, so it inherited only `findById`.
  const row = await repo.findById(c, serviceTypeId);
  if (!row) throw new AppError("NOT_FOUND", "Service type not found", 404);

  // Sequential, not Promise.all: every sub-query runs on the SAME tenant
  // client (one per request), and a pg client cannot execute two queries at
  // once — same reason as party-360.service.js:180.
  const stats = { ...EMPTY_STATS, ...(await repo.stats(c, serviceTypeId, row.key)) };
  const templates = await repo.templatesWithStages(c, serviceTypeId);
  // The shipment/service-detail form (0660). Every version, plus the fields of
  // whichever one is live — the Fields tab renders the live one and offers the
  // others as history, exactly like the Milestones tab does with templates.
  const fieldSets = await detailRepo.fieldSetsFor(c, serviceTypeId);
  const activeFieldSet = fieldSets.find((f) => f.is_active) || null;
  const fields = activeFieldSet
    ? await detailRepo.fieldsOf(c, activeFieldSet.service_type_field_set_id)
    : [];
  const dictionary = await repo.dictionaryItemsFor(c, row.key);
  const dossiers = await repo.dossiersFor(c, serviceTypeId, { limit: 25 });
  const margin_simulations = await repo.marginSimulationsFor(c, serviceTypeId, { limit: 25 });
  const invoices = canSee ? await repo.invoicesFor(c, serviceTypeId, { limit: 25 }) : [];
  const money = maskMoney(await repo.moneyRollup(c, serviceTypeId), canSee);

  const activeTemplate = templates.find((t) => t.is_active === true) || null;
  // The four checkpoints the Overview banner keys off — a service type without
  // an active template is the trap the list screen was built to surface, and
  // the 360 keeps that visible at the top of the page rather than buried in a
  // tab. `ever_billed` is finance-scoped; if the caller can't see billed money,
  // it stays null so the banner doesn't imply "no revenue" from a masked view.
  const readiness = {
    has_active_template: !!activeTemplate,
    active_template_version: activeTemplate ? activeTemplate.version : null,
    has_dictionary_line: (dictionary.scoped || []).some((d) => d.is_active !== false),
    // A service type with no published detail form produces files that ask for
    // nothing beyond client and dates — the same trap as a missing milestone
    // template, and surfaced in the same banner rather than discovered on an
    // empty form.
    has_active_field_set: !!activeFieldSet,
    active_field_set_version: activeFieldSet ? activeFieldSet.version : null,
    ever_used: stats.dossiers_total > 0,
    ever_billed: canSee
      ? (money.billed || []).some((b) => Number(b.invoice_count || 0) > 0)
      : null,
  };

  return {
    service_type: row,
    stats,
    readiness,
    templates,
    field_sets: fieldSets,
    field_set: activeFieldSet ? { ...activeFieldSet, fields } : null,
    // The equipment toggle lives on the service type row itself; lifted out so
    // the Fields tab can render it without digging into `service_type`.
    containers: {
      captures_containers: row.captures_containers === true,
      container_detail_mode: row.container_detail_mode || "GROUPED",
    },
    dictionary_items: dictionary.scoped,
    dictionary_items_generic: dictionary.generic,
    dossiers,
    dossiers_more: Math.max(0, (stats.dossiers_total || 0) - dossiers.length),
    margin_simulations,
    margin_simulations_more: Math.max(0, (stats.margin_simulations || 0) - margin_simulations.length),
    invoices,
    money,
  };
}

module.exports = { dossier, canSeeFinancials };
