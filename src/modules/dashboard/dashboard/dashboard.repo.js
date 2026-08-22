"use strict";
/** Role-filtered KPI counts. Each count is guarded so a missing table/feature
 *  never breaks the dashboard. */
async function count(client, sql) {
  try { const { rows } = await client.query(sql); return Number(rows[0].n); } catch { return null; }
}
/** Like count() but preserves SQL NULL (→ null) instead of coercing to 0, so a
 *  "no data measured yet" metric can be distinguished from a genuine zero and
 *  hidden by the dashboard rather than shown as 0. */
async function num(client, sql) {
  try { const { rows } = await client.query(sql); const v = rows[0] && rows[0].n; return v === null || v === undefined ? null : Number(v); } catch { return null; }
}
async function kpis(client) {
  return {
    open_dossiers: await count(client, "SELECT count(*) n FROM dossier_visible WHERE status IN ('OPEN','IN_PROGRESS')"),
    proformas: await count(client, "SELECT count(*) n FROM invoice WHERE type='PROFORMA'"),
    final_invoices: await count(client, "SELECT count(*) n FROM invoice WHERE type='FINAL'"),
    receipts: await count(client, "SELECT count(*) n FROM payment_receipt"),
    clients: await count(client, "SELECT count(*) n FROM client_master WHERE is_active"),
    suppliers: await count(client, "SELECT count(*) n FROM supplier_master WHERE is_active"),
    open_compliance_flags: await count(client, "SELECT count(*) n FROM compliance_flag WHERE resolved_at IS NULL"),
    unposted_journal_entries: await count(client, "SELECT count(*) n FROM journal_entry WHERE status='draft'"),
    // Headline tiles (Control Tower). Each is guarded → null on a missing
    // table/feature so the card hides instead of breaking the payload.
    //  - revenue: sum of locked FINAL invoices (TTC). Mixed-currency is summed
    //    nominally — a rough headline figure, not an FX-consolidated total.
    //  - fleet: active vs total vehicles (fleet feature may be off → null/0).
    //  - SLA: on-time delivery rate = dossiers whose ATA ≤ ETA, over those with
    //    both dates set. null when nothing measurable yet (NULLIF guard).
    revenue_final_ttc: await num(client, "SELECT COALESCE(SUM(total_ttc), 0) n FROM invoice WHERE type='FINAL' AND status IN ('ISSUED_LOCKED','APPROVED_LOCKED','POSTED_LOCKED')"),
    revenue_currency: "XAF",
    fleet_total: await count(client, "SELECT count(*) n FROM vehicle"),
    fleet_active: await count(client, "SELECT count(*) n FROM vehicle WHERE status='ACTIVE'"),
    sla_on_time_pct: await num(client, "SELECT round(100.0 * count(*) FILTER (WHERE ata <= eta) / NULLIF(count(*) FILTER (WHERE ata IS NOT NULL AND eta IS NOT NULL), 0)) n FROM dossier_visible"),
  };
}
/** Control Tower aggregate — the data the home screen shows: operation-file
 *  counts, the live-shipment list (open/in-progress dossiers), and how many
 *  approvals are waiting. Each query is guarded so a missing table/feature
 *  degrades to a zero/empty value instead of breaking the whole payload. */
/**
 * The MODE a file actually travels by.
 *
 * Derived from the itinerary's main carriage FIRST, and only then from the
 * service-type key. That order matters and it fixes a real misclassification:
 * the key heuristic put PROJECT_CARGO in with the road corridors, because the
 * pattern list needed somewhere to put it — but project cargo is multimodal by
 * definition, and a file whose main carriage is a chartered vessel was being
 * filtered, coloured and counted as a truck. The itinerary knows; the key is the
 * fallback for a file that has no structured legs yet.
 *
 * OTHER is a real answer, not a failure: warehousing, brokerage and business
 * representation have no transport mode, and forcing one on them is how a
 * storage file ends up drawn as a shipping lane.
 */
const MODE_EXPR = `COALESCE(
  (SELECT l.mode FROM dossier_itinerary_leg l
    WHERE l.dossier_id = d.dossier_id AND l.leg_type = 'MAIN_CARRIAGE'
      AND l.mode IN ('AIR','SEA','LAND','RAIL')
    ORDER BY l.seq LIMIT 1),
  CASE
    WHEN st.key ILIKE '%AIR%' THEN 'AIR'
    WHEN st.key ILIKE '%SEA%' THEN 'SEA'
    WHEN st.key ILIKE '%RAIL%' OR st.key ILIKE '%TRAIN%' OR st.key ILIKE '%FERROVIAIRE%' THEN 'RAIL'
    WHEN st.key ILIKE '%TRANSIT%' OR st.key ILIKE '%INLAND%' THEN 'LAND'
    ELSE 'OTHER'
  END)`;

/**
 * Does this file MOVE something, or does it record work at a place?
 *
 * The Control Tower has to answer this to stay honest. Warehousing, customs
 * brokerage and business representation are real operations files with real
 * deadlines and no route — and the previous tower had nowhere to put them, so
 * they either vanished from the screen or were drawn as a lane between two
 * places one of them happened to mention. Both are wrong. A file is a movement
 * file when it names endpoints or carries a transport leg; everything else
 * belongs in the activity layer.
 */
const IS_MOVEMENT_EXPR = `(
  d.pol IS NOT NULL OR d.pod IS NOT NULL
  OR EXISTS (SELECT 1 FROM dossier_itinerary_leg l
              WHERE l.dossier_id = d.dossier_id AND l.mode IN ('AIR','SEA','LAND','RAIL'))
)`;

/**
 * Is any endpoint on this file unresolved?
 *
 * TRUE when the file names a place but that place is either not linked at all
 * (legacy free text, written before the picker existed) or linked to a row
 * nobody ever confirmed (the background-geocode population — see 0674). Those are
 * the two states that make a plotted route a guess, and together they are
 * exactly the location-needed queue.
 */
const NEEDS_LOCATION_EXPR = `(
  (d.pol IS NOT NULL AND (d.pol_place_id IS NULL OR gp_o.verified_at IS NULL))
  OR (d.pod IS NOT NULL AND (d.pod_place_id IS NULL OR gp_d.verified_at IS NULL))
)`;

/** One FROM clause, shared by the count and the page, so a filter added to one
 *  cannot be missing from the other — the class of bug that makes a header count
 *  disagree with the list under it. */
const TOWER_FROM = `
  FROM dossier_visible d
  LEFT JOIN service_type st ON st.service_type_id = d.service_type_id
  LEFT JOIN geo_place gp_o ON gp_o.geo_place_id = d.pol_place_id
  LEFT JOIN geo_place gp_d ON gp_d.geo_place_id = d.pod_place_id`;

async function controlTower(client, options = {}) {
  const {
    limit = 50, cursor = null, serviceTypeId = null, territory = null, mode = null,
    dateField = "created", from = null, to = null, includeCompleted = false,
    layer = null, verified = null,
  } = options;
  const params = [];
  const where = [];
  const add = (v) => { params.push(v); return "$" + params.length; };
  if (!includeCompleted) where.push("d.status IN ('OPEN','IN_PROGRESS')");
  if (serviceTypeId) where.push("d.service_type_id = " + add(serviceTypeId));
  if (territory) where.push("st.territory = " + add(territory));
  if (mode) where.push(MODE_EXPR + " = " + add(String(mode).toUpperCase()));
  // The two layers partition the result set, which is what makes the tower's
  // "12 moving / 3 at a facility" counts add up to the page.
  if (layer === "MOVEMENT") where.push(IS_MOVEMENT_EXPR);
  if (layer === "ACTIVITY") where.push("NOT " + IS_MOVEMENT_EXPR);
  if (verified === "UNVERIFIED") where.push(NEEDS_LOCATION_EXPR);
  if (verified === "VERIFIED") where.push("NOT " + NEEDS_LOCATION_EXPR);
  const dateExpr = { created: "d.created_at", updated: "d.updated_at", arrival: "d.eta", delivery: "d.promised_delivery_date" }[dateField] || "d.created_at";
  if (from) where.push(dateExpr + " >= " + add(from));
  if (to) where.push(dateExpr + " < (" + add(to) + "::date + INTERVAL '1 day')");
  if (cursor) { const [at, id] = String(cursor).split("."); if (at && id) { where.push("(d.created_at, d.dossier_id) < (" + add(at) + "::timestamptz, " + add(id) + "::uuid)"); } }
  const filter = where.length ? "WHERE " + where.join(" AND ") : "";
  const pageLimit = Math.max(1, Math.min(Number(limit) || 50, 100));

  const rows = async (sql, queryParams = []) => {
    try { const r = await client.query(sql, queryParams); return r.rows; } catch { return []; }
  };
  const one = async (sql, queryParams = []) => (await rows(sql, queryParams))[0] || {};

  /*
   * The header counts, over the SAME filter as the page.
   *
   * `needs_location` and the two layer counts are computed here rather than from
   * the page, and that is the point: the page is 50 rows and the queue is a
   * property of the whole filtered set. A count derived from the visible page
   * would say "2 files need a location" on page one of eleven, which is worse
   * than saying nothing.
   *
   * The cursor predicate is deliberately NOT excluded — paging forward narrows
   * the counts alongside the list, so the numbers describe what is on screen and
   * after it rather than silently disagreeing with the pager.
   */
  const ops = await one(
    "SELECT COUNT(*) FILTER (WHERE d.status IN ('OPEN','IN_PROGRESS'))::int AS active, " +
      "COUNT(*) FILTER (WHERE d.status='OPEN')::int AS open, " +
      "COUNT(*) FILTER (WHERE d.status='IN_PROGRESS')::int AS in_progress, " +
      `COUNT(*) FILTER (WHERE ${IS_MOVEMENT_EXPR})::int AS movement, ` +
      `COUNT(*) FILTER (WHERE NOT ${IS_MOVEMENT_EXPR})::int AS activity, ` +
      `COUNT(*) FILTER (WHERE ${NEEDS_LOCATION_EXPR})::int AS needs_location ` +
      TOWER_FROM + " " + filter,
    params.slice(0),
  );
  // Progress comes from the milestone engine (milestone_instance, 0310) — done
  // stages over total stages for the dossier. Dossiers with no milestone template
  // instantiated yield total=0, which maps to a NULL progress below rather than
  // to 0%: "not tracked" and "not started" are different things, and the UI hides
  // the bar for the former instead of drawing a misleading empty one.
  // Same three correlated subqueries `operations_file.repo.js:32-34` already uses
  // for the dossier list — deliberately identical so the Control Tower bar and the
  // Operations screen can never disagree about how far along a dossier is.
  const shipments = await rows(
    // `dossier_id` now travels with the row. It is what the map selects on, what
    // the itinerary panel loads from, and what builds the deep link to the file —
    // the iframe build keyed everything on `ref`, which is a display string that
    // two tenants can spell the same way.
    //
    // Coordinates come from the FK when the dossier used the place picker, which
    // is exact. The free-text pol/pod still ride along: they are the display
    // label, and they remain the only route info on dossiers created before the
    // picker existed — those still resolve by name in the service layer.
    "SELECT d.dossier_id, d.created_at, d.ref, d.status, d.pol AS origin, d.pod AS destination, " +
      "d.vessel_flight, d.eta, d.promised_delivery_date, st.key AS service_key, st.name_en AS service_name, " +
      MODE_EXPR + " AS mode, " +
      IS_MOVEMENT_EXPR + " AS is_movement, " +
      NEEDS_LOCATION_EXPR + " AS needs_location, " +
      "gp_o.latitude AS origin_lat, gp_o.longitude AS origin_lng, gp_o.name AS origin_name, " +
      "gp_o.kind AS origin_kind, gp_o.verified_at AS origin_verified_at, gp_o.is_reference_point AS origin_is_reference_point, " +
      "gp_d.latitude AS dest_lat, gp_d.longitude AS dest_lng, gp_d.name AS dest_name, " +
      "gp_d.kind AS dest_kind, gp_d.verified_at AS dest_verified_at, gp_d.is_reference_point AS dest_is_reference_point, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id) AS milestone_total, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status = 'DONE') AS milestone_done, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status = 'BLOCKED') AS milestone_blocked, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id " +
      "AND mi.status <> 'DONE' AND mi.due_date IS NOT NULL AND mi.due_date < CURRENT_DATE) AS milestone_overdue, " +
      "(SELECT mi.label FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id " +
      "AND mi.status IN ('IN_PROGRESS','PENDING') ORDER BY (mi.status = 'IN_PROGRESS') DESC, mi.stage_seq ASC LIMIT 1) AS current_milestone " +
      TOWER_FROM + " " +
      filter + " ORDER BY d.created_at DESC, d.dossier_id DESC LIMIT $" + (params.length + 1),
    [...params, pageLimit + 1],
  );
  const appr = await one("SELECT COUNT(*)::int AS awaiting FROM approval_task WHERE status = 'PENDING'");

  const hasMore = shipments.length > pageLimit;
  const pageRows = hasMore ? shipments.slice(0, pageLimit) : shipments;
  const last = pageRows[pageRows.length - 1];

  /** The four states the place picker's badge shows, for a dossier endpoint. */
  const endpointState = (lat, verifiedAt, isReference) => {
    if (lat === null || lat === undefined) return "unknown";
    if (isReference === true) return "reference";
    return verifiedAt ? "verified" : "unverified";
  };

  return {
    operation_files: {
      active: ops.active || 0,
      open: ops.open || 0,
      in_progress: ops.in_progress || 0,
      movement: ops.movement || 0,
      activity: ops.activity || 0,
      needs_location: ops.needs_location || 0,
    },
    approvals_awaiting: appr.awaiting || 0,
    page: { limit: pageLimit, has_more: hasMore, next_cursor: hasMore && last ? `${last.created_at || ""}.${last.dossier_id || ""}` : null },
    live_shipments: pageRows.map((s) => {
      const total = Number(s.milestone_total) || 0;
      const done = Number(s.milestone_done) || 0;
      return {
        dossier_id: s.dossier_id,
        ref: s.ref, status: s.status, origin: s.origin || null, destination: s.destination || null,
        vessel_flight: s.vessel_flight || null, eta: s.eta || null,
        promised_delivery_date: s.promised_delivery_date || null,
        service_key: s.service_key || null, service_name: s.service_name || null,
        // Derived server-side from the itinerary, so the map, the list and the
        // mode filter cannot disagree about what a file travels by.
        mode: s.mode || "OTHER",
        is_movement: s.is_movement === true,
        needs_location: s.needs_location === true,
        milestone_total: total, milestone_done: done,
        milestone_blocked: Number(s.milestone_blocked) || 0,
        milestone_overdue: Number(s.milestone_overdue) || 0,
        current_milestone: s.current_milestone || null,
        progress: total > 0 ? Math.round((done / total) * 100) : null,
        // Pre-resolved coordinates when the dossier referenced a real place.
        // The service layer fills the gaps by name for everything else.
        // `!== null` not `!= null`: eqeqeq is an ERROR in eslint.config.js, and a
        // LEFT JOIN miss yields SQL NULL, never undefined, so the loose form buys
        // nothing here anyway.
        coords: s.origin_lat !== null && s.dest_lat !== null
          ? {
              from: {
                name: s.origin_name || s.origin, latitude: Number(s.origin_lat), longitude: Number(s.origin_lng),
                kind: s.origin_kind || null,
                state: endpointState(s.origin_lat, s.origin_verified_at, s.origin_is_reference_point),
              },
              to: {
                name: s.dest_name || s.destination, latitude: Number(s.dest_lat), longitude: Number(s.dest_lng),
                kind: s.dest_kind || null,
                state: endpointState(s.dest_lat, s.dest_verified_at, s.dest_is_reference_point),
              },
            }
          : null,
      };
    }),
  };
}

module.exports = { kpis, controlTower };
