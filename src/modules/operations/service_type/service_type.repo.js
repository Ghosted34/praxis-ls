/**
 * Service type repository (table `service_type`, migration 0310).
 *
 * The list override adds one thing beyond the columns: how many milestone
 * template versions exist and whether an ACTIVE one does. A service type without
 * an active template silently produces dossiers with no milestone chain, and
 * that should be visible in the list rather than discovered later on an empty
 * 360° tab.
 *
 * The rest is the 360° aggregator's building blocks — one query per collection
 * so the aggregator can compose them and the tests can pin each in isolation.
 * They return `[]` / `0` for a brand-new service type; the aggregator does not
 * paper over an error with an empty result.
 */
"use strict";
const { makeRepo } = require("../../../shared/crud/resource");

const base = makeRepo({
  table: "service_type",
  pk: "service_type_id",
  activeColumn: "is_active",
  searchColumn: "name_fr",
  orderBy: "name_fr ASC",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at", "name_fr", "is_active"],
  // API F-28: this repo uses makeRepo's list unchanged, which honours only
  // limit/offset/q — any other key was silently ignored. Now it is named.
  filterable: [],
});

async function list(client, q = {}) {
  const params = [];
  const wh = [];
  // `includeInactive` exists because the admin screen has to be able to see and
  // reactivate what it archived — the base repo filters is_active unconditionally.
  if (!q.includeInactive) wh.push("st.is_active = true");
  if (q.q) {
    params.push(`%${q.q}%`);
    wh.push(`(st.name_fr ILIKE $${params.length} OR st.name_en ILIKE $${params.length} OR st.key ILIKE $${params.length})`);
  }
  const { rows } = await client.query(
    "SELECT st.*, " +
      "(SELECT COUNT(*)::int FROM milestone_template mt WHERE mt.service_type_id = st.service_type_id) AS template_versions, " +
      "(SELECT COUNT(*)::int FROM milestone_template mt WHERE mt.service_type_id = st.service_type_id AND mt.is_active) > 0 AS has_active_template " +
      "FROM service_type st" +
      (wh.length ? " WHERE " + wh.join(" AND ") : "") +
      " ORDER BY st.is_active DESC, st.name_fr ASC",
    params,
  );
  return rows;
}

/**
 * Every milestone_template version for a service type, each with its stages
 * inlined as a JSON array — one round trip rather than one per version.
 * Stages are ordered by `stage_seq` (numeric so a stage can be inserted between
 * two without a renumber — 0310_operations.sql:59).
 */
async function templatesWithStages(client, serviceTypeId) {
  const { rows } = await client.query(
    "SELECT mt.milestone_template_id, mt.version, mt.is_active, mt.created_at, " +
      "COALESCE((SELECT jsonb_agg(jsonb_build_object(" +
      "  'stage_id', s.stage_id, 'stage_seq', s.stage_seq, 'code', s.code, " +
      "  'label_fr', s.label_fr, 'label_en', s.label_en, " +
      "  'default_offset_days', s.default_offset_days, " +
      // The scheduling half (0650). Without these the template editor could
      // only show a stage's name and offset — i.e. it could not edit the
      // weights, floors or ownership the engine actually schedules on.
      "  'weight', s.weight, 'min_duration_hours', s.min_duration_hours, " +
      "  'owner_tier', s.owner_tier, 'is_anchor', s.is_anchor, " +
      "  'is_target_lock', s.is_target_lock, 'is_client_visible', s.is_client_visible, " +
      "  'is_optional', s.is_optional, 'chain_segment', s.chain_segment, " +
      "  'cadence', s.cadence, 'required_evidence_doc_type', s.required_evidence_doc_type, " +
      "  'auto_advance_on_event', s.auto_advance_on_event, " +
      "  'is_system', s.is_system, 'system_code', s.system_code" +
      ") ORDER BY s.stage_seq) FROM milestone_template_stage s " +
      "  WHERE s.milestone_template_id = mt.milestone_template_id), '[]'::jsonb) AS stages " +
      "FROM milestone_template mt " +
      "WHERE mt.service_type_id = $1 " +
      "ORDER BY mt.version DESC",
    [serviceTypeId],
  );
  return rows;
}

/**
 * Financial dictionary items applicable to a service type.
 *
 * `dictionary_item.service_type_key` is a citext scalar, not an FK, so this
 * matches on the key. The generic bucket (NULL key) is loaded separately so the
 * UI can present it as "also applicable to any service" — the two lists are
 * displayed apart because a user picking a line for THIS service should not
 * mistake generic items for scoped ones (spec §11.3, "services as DATA").
 */
async function dictionaryItemsFor(client, key) {
  // Scoped lines now come from the many-to-many tier join (Basic/Advanced/Full),
  // ordered by tier so the ST-360 can group them. service_type_key is kept in
  // step by the FD service, so this reads the same set either way.
  const scoped = (await client.query(
    "SELECT di.dictionary_item_id, di.code, di.label_fr, di.label_en, di.category, di.direction, " +
      "  di.is_disbursement, di.is_billable, di.default_price, di.currency, di.shipping_line, " +
      "  di.service_type_key, di.is_active, sti.tier " +
      "FROM service_type_dictionary_item sti " +
      "JOIN dictionary_item di ON di.dictionary_item_id = sti.dictionary_item_id " +
      "JOIN service_type st ON st.service_type_id = sti.service_type_id " +
      "WHERE st.key = $1 " +
      "ORDER BY (CASE sti.tier WHEN 'BASIC' THEN 1 WHEN 'ADVANCED' THEN 2 ELSE 3 END), di.category, di.code",
    [key],
  )).rows;
  // Generic = surfaces on ANY operation (the new applicability mode). Overhead /
  // non-operational lines are deliberately excluded from a service's pick-list.
  const generic = (await client.query(
    "SELECT dictionary_item_id, code, label_fr, label_en, category, direction, is_disbursement, " +
      "  is_billable, default_price, currency, shipping_line, is_active " +
      "FROM dictionary_item WHERE applicability_mode = 'ANY_OPERATIONS' AND is_active = true " +
      "ORDER BY category, code",
  )).rows;
  return { scoped, generic };
}

/**
 * The N most recent dossiers of this service type, each with its client name,
 * milestone progress and locked-invoice total — the same shape the client-360
 * dossiers list uses (party-360.service.js:279) so the two agree on a dossier's
 * number and current stage.
 */
async function dossiersFor(client, serviceTypeId, { limit = 25 } = {}) {
  const { rows } = await client.query(
    "SELECT d.dossier_id, d.ref, d.title, d.status, d.created_at, d.client_id, " +
      "cm.name AS client_name, " +
      "(SELECT COALESCE(SUM(total_ttc) FILTER (WHERE status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED')), 0) " +
      " FROM invoice WHERE dossier_id = d.dossier_id AND type = 'FINAL') AS billed_ttc, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id) AS milestone_total, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status = 'DONE') AS milestone_done, " +
      "(SELECT mi.label FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id " +
      "   AND mi.status IN ('IN_PROGRESS','PENDING') " +
      "   ORDER BY (mi.status = 'IN_PROGRESS') DESC, mi.stage_seq ASC LIMIT 1) AS current_milestone " +
      "FROM dossier d LEFT JOIN client_master cm ON cm.client_id = d.client_id " +
      "WHERE d.service_type_id = $1 ORDER BY d.created_at DESC LIMIT $2",
    [serviceTypeId, limit],
  );
  return rows;
}

/**
 * The N most recent margin simulations filed under this service type. Each row
 * carries its dossier ref (for the deep-link), currency and margin_percent — no
 * lines: those belong to the margin-sim screen the row links out to.
 */
async function marginSimulationsFor(client, serviceTypeId, { limit = 25 } = {}) {
  const { rows } = await client.query(
    "SELECT ms.margin_simulation_id, ms.dossier_id, d.ref AS dossier_ref, " +
      "  ms.currency, ms.margin_percent, ms.total_cost, ms.total_price, ms.created_at " +
      "FROM margin_simulation ms " +
      "LEFT JOIN dossier d ON d.dossier_id = ms.dossier_id " +
      "WHERE ms.service_type_id = $1 ORDER BY ms.created_at DESC LIMIT $2",
    [serviceTypeId, limit],
  );
  return rows;
}

/**
 * The N most recent FINAL invoices whose dossier carries this service type.
 * Read-only rows for the Commercial tab — dossier ref, client, TTC, status.
 * Filtered to `FINAL` type only: proforma isn't revenue (§8.2).
 */
async function invoicesFor(client, serviceTypeId, { limit = 25 } = {}) {
  const { rows } = await client.query(
    "SELECT i.invoice_id, i.doc_number, i.currency, i.total_ttc, i.status, " +
      "  i.payment_due_on, i.created_at, i.dossier_id, d.ref AS dossier_ref, " +
      "  cm.name AS client_name " +
      "FROM invoice i " +
      "JOIN dossier d ON d.dossier_id = i.dossier_id " +
      "LEFT JOIN client_master cm ON cm.client_id = i.client_id " +
      "WHERE d.service_type_id = $1 AND i.type = 'FINAL' " +
      "ORDER BY i.created_at DESC LIMIT $2",
    [serviceTypeId, limit],
  );
  return rows;
}

/**
 * Money rollup across every dossier of this service type: planned (costing
 * lines summed to their currency), actual (cost_entry summed to XAF via the
 * costing exchange rate on the parent) and billed (locked FINAL invoices).
 *
 * `costing_line.qty * unit_cost` gives planned in the costing's own currency;
 * `cost_entry.amount` is booked in the ledger currency, so we keep them in
 * separate figures rather than pretending we can net two different currencies.
 * The UI shows them per currency and the "planned − actual" delta belongs to
 * the costing screen, where the FX conversion decision is already made.
 */
async function moneyRollup(client, serviceTypeId) {
  const planned = (await client.query(
    "SELECT c.currency, " +
      "  COALESCE(SUM(cl.qty * cl.unit_cost), 0)::numeric AS planned_total, " +
      "  COALESCE(SUM(CASE WHEN cl.is_disbursement THEN cl.qty * cl.unit_cost ELSE 0 END), 0)::numeric AS planned_disbursement " +
      "FROM costing c " +
      "JOIN dossier d ON d.dossier_id = c.dossier_id " +
      "LEFT JOIN costing_line cl ON cl.costing_id = c.costing_id " +
      "WHERE d.service_type_id = $1 " +
      "GROUP BY c.currency ORDER BY c.currency",
    [serviceTypeId],
  )).rows;

  const actuals = (await client.query(
    "SELECT COALESCE(SUM(ce.amount), 0)::numeric AS actual_total " +
      "FROM cost_entry ce JOIN dossier d ON d.dossier_id = ce.dossier_id " +
      "WHERE d.service_type_id = $1",
    [serviceTypeId],
  )).rows[0] || { actual_total: 0 };

  const billed = (await client.query(
    "SELECT i.currency, " +
      "  COALESCE(SUM(i.total_ttc), 0)::numeric AS billed_ttc, " +
      "  COALESCE(SUM(i.service_ht), 0)::numeric AS revenue_ht, " +
      "  COUNT(*)::int AS invoice_count " +
      "FROM invoice i JOIN dossier d ON d.dossier_id = i.dossier_id " +
      "WHERE d.service_type_id = $1 AND i.type = 'FINAL' " +
      "  AND i.status IN ('POSTED_LOCKED','APPROVED_LOCKED','ISSUED_LOCKED') " +
      "GROUP BY i.currency ORDER BY i.currency",
    [serviceTypeId],
  )).rows;

  return { planned, billed, actual_total: Number(actuals.actual_total || 0) };
}

/**
 * Header stat row — one query rolls up the counts every tab's header uses so
 * the aggregator doesn't fan out to eight sub-queries for numbers alone.
 * Returns integers, so a fresh service type reads all zeros rather than blanks.
 */
async function stats(client, serviceTypeId, key) {
  const { rows } = await client.query(
    "SELECT " +
      "  (SELECT COUNT(*)::int FROM dossier WHERE service_type_id = $1) AS dossiers_total, " +
      "  (SELECT COUNT(*)::int FROM dossier WHERE service_type_id = $1 AND status = 'OPEN') AS dossiers_open, " +
      "  (SELECT COUNT(*)::int FROM dossier WHERE service_type_id = $1 AND status = 'IN_PROGRESS') AS dossiers_in_progress, " +
      "  (SELECT COUNT(*)::int FROM dossier WHERE service_type_id = $1 AND status = 'COMPLETED') AS dossiers_completed, " +
      "  (SELECT COUNT(*)::int FROM dossier WHERE service_type_id = $1 AND status = 'CANCELLED') AS dossiers_cancelled, " +
      "  (SELECT COUNT(*)::int FROM milestone_template WHERE service_type_id = $1) AS template_versions, " +
      "  (SELECT version FROM milestone_template WHERE service_type_id = $1 AND is_active LIMIT 1) AS active_template_version, " +
      "  (SELECT COUNT(*)::int FROM dictionary_item WHERE service_type_key = $2) AS dictionary_items, " +
      "  (SELECT COUNT(*)::int FROM margin_simulation WHERE service_type_id = $1) AS margin_simulations",
    [serviceTypeId, key],
  );
  return rows[0] || {};
}

/**
 * Set (or move) a dictionary line's tier on this service — the write behind the
 * tier matrix on ST-360 → Dictionary.
 *
 * ON CONFLICT DO UPDATE rather than delete-then-insert: the PK is
 * (service_type_id, dictionary_item_id), so an upsert is one statement and
 * cannot leave the row briefly absent. `sort_order` is preserved on an existing
 * link — the seed ordered lines within a tier deliberately, and moving a line
 * from ADVANCED to BASIC should not throw that away.
 */
async function setDictionaryTier(client, serviceTypeId, dictionaryItemId, tier) {
  const { rows } = await client.query(
    `INSERT INTO service_type_dictionary_item (service_type_id, dictionary_item_id, tier, sort_order)
     VALUES ($1, $2, $3, 100)
     ON CONFLICT (service_type_id, dictionary_item_id)
       DO UPDATE SET tier = EXCLUDED.tier
     RETURNING service_type_id, dictionary_item_id, tier, sort_order`,
    [serviceTypeId, dictionaryItemId, tier],
  );
  return rows[0] || null;
}

/** Unlink a dictionary line from this service. Returns the removed row, or null. */
async function removeDictionaryTier(client, serviceTypeId, dictionaryItemId) {
  const { rows } = await client.query(
    `DELETE FROM service_type_dictionary_item
      WHERE service_type_id = $1 AND dictionary_item_id = $2
      RETURNING service_type_id, dictionary_item_id, tier`,
    [serviceTypeId, dictionaryItemId],
  );
  return rows[0] || null;
}

/**
 * Re-derive `dictionary_item.service_type_key` for one item after its tier links
 * changed.
 *
 * That column is the denormalised single-value hint 0630 kept alive until the
 * ST-360 finishes moving to the join, and `stats.dictionary_items` still counts
 * on it. Editing tiers from the service side without re-deriving it would leave
 * the header count disagreeing with the table directly beneath it.
 *
 * Same rule as financial_dictionary.rules.primaryServiceKey: the first BASIC
 * service, else the first of any tier, else NULL when the item is no longer
 * scoped to anything.
 */
async function syncServiceTypeKey(client, dictionaryItemId) {
  const { rows } = await client.query(
    `UPDATE dictionary_item di SET service_type_key = (
       SELECT st.key FROM service_type_dictionary_item sti
         JOIN service_type st ON st.service_type_id = sti.service_type_id
        WHERE sti.dictionary_item_id = di.dictionary_item_id
        ORDER BY CASE sti.tier WHEN 'BASIC' THEN 1 WHEN 'ADVANCED' THEN 2 ELSE 3 END, st.key
        LIMIT 1)
      WHERE di.dictionary_item_id = $1
      RETURNING di.dictionary_item_id, di.service_type_key`,
    [dictionaryItemId],
  );
  return rows[0] || null;
}

module.exports = {
  ...base,
  list,
  setDictionaryTier,
  removeDictionaryTier,
  syncServiceTypeKey,
  templatesWithStages,
  dictionaryItemsFor,
  dossiersFor,
  marginSimulationsFor,
  invoicesFor,
  moneyRollup,
  stats,
};
