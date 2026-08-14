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
async function controlTower(client, options = {}) {
  const { limit = 50, cursor = null, serviceTypeId = null, territory = null, mode = null, dateField = "created", from = null, to = null, includeCompleted = false } = options;
  const params = [];
  const where = [];
  const add = (v) => { params.push(v); return "$" + params.length; };
  if (!includeCompleted) where.push("d.status IN ('OPEN','IN_PROGRESS')");
  if (serviceTypeId) where.push("d.service_type_id = " + add(serviceTypeId));
  if (territory) where.push("st.territory = " + add(territory));
  if (mode === "AIR") where.push("st.key ILIKE '%AIR%'");
  if (mode === "SEA") where.push("st.key ILIKE '%SEA%'");
  if (mode === "LAND") where.push("(st.key ILIKE '%TRANSIT%' OR st.key ILIKE '%INLAND%' OR st.key ILIKE '%PROJECT%')");
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

  const ops = await one(
    "SELECT COUNT(*) FILTER (WHERE d.status IN ('OPEN','IN_PROGRESS'))::int AS active, " +
      "COUNT(*) FILTER (WHERE d.status='OPEN')::int AS open, " +
      "COUNT(*) FILTER (WHERE d.status='IN_PROGRESS')::int AS in_progress " +
      "FROM dossier_visible d LEFT JOIN service_type st ON st.service_type_id = d.service_type_id " + filter, params.slice(0),
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
    // service_key drives the map's sea/air/road styling. Without it the client
    // sniffed the mode out of the vessel string and the port names, which got
    // HINTERLAND_TRANSIT (a road corridor) wrong — it has no vessel and two
    // ordinary city names, so it fell through to the "sea" default.
    // Coordinates come from the FK when the dossier used the port picker (0479),
    // which is exact. The free-text pol/pod still ride along: they're the display
    // label, and they remain the only route info on dossiers created before the
    // picker existed — those still resolve by name in the service layer.
    "SELECT d.dossier_id, d.created_at, d.ref, d.status, d.pol AS origin, d.pod AS destination, d.vessel_flight, d.eta, " +
      "st.key AS service_key, " +
      "gp_o.latitude AS origin_lat, gp_o.longitude AS origin_lng, gp_o.name AS origin_name, " +
      "gp_d.latitude AS dest_lat, gp_d.longitude AS dest_lng, gp_d.name AS dest_name, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id) AS milestone_total, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status = 'DONE') AS milestone_done, " +
      "(SELECT mi.label FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id " +
      "AND mi.status IN ('IN_PROGRESS','PENDING') ORDER BY (mi.status = 'IN_PROGRESS') DESC, mi.stage_seq ASC LIMIT 1) AS current_milestone " +
      "FROM dossier_visible d " +
      "LEFT JOIN service_type st ON st.service_type_id = d.service_type_id " +
      "LEFT JOIN geo_place gp_o ON gp_o.geo_place_id = d.pol_place_id " +
      "LEFT JOIN geo_place gp_d ON gp_d.geo_place_id = d.pod_place_id " +
      filter + " ORDER BY d.created_at DESC, d.dossier_id DESC LIMIT $" + (params.length + 1),
    [...params, pageLimit + 1],
  );
  const appr = await one("SELECT COUNT(*)::int AS awaiting FROM approval_task WHERE status = 'PENDING'");

  const hasMore = shipments.length > pageLimit;
  const pageRows = hasMore ? shipments.slice(0, pageLimit) : shipments;
  const last = pageRows[pageRows.length - 1];
  return {
    operation_files: { active: ops.active || 0, open: ops.open || 0, in_progress: ops.in_progress || 0 },
    approvals_awaiting: appr.awaiting || 0,
    page: { limit: pageLimit, has_more: hasMore, next_cursor: hasMore && last ? `${last.created_at || ""}.${last.dossier_id || ""}` : null },
    live_shipments: pageRows.map((s) => {
      const total = Number(s.milestone_total) || 0;
      const done = Number(s.milestone_done) || 0;
      return {
        ref: s.ref, status: s.status, origin: s.origin || null, destination: s.destination || null,
        vessel_flight: s.vessel_flight || null, eta: s.eta || null, service_key: s.service_key || null,
        milestone_total: total, milestone_done: done,
        current_milestone: s.current_milestone || null,
        progress: total > 0 ? Math.round((done / total) * 100) : null,
        // Pre-resolved coordinates when the dossier referenced a real place.
        // The service layer fills the gaps by name for everything else.
        // `!== null` not `!= null`: eqeqeq is an ERROR in eslint.config.js, and a
        // LEFT JOIN miss yields SQL NULL, never undefined, so the loose form buys
        // nothing here anyway.
        coords: s.origin_lat !== null && s.dest_lat !== null
          ? {
              from: { name: s.origin_name || s.origin, latitude: Number(s.origin_lat), longitude: Number(s.origin_lng) },
              to: { name: s.dest_name || s.destination, latitude: Number(s.dest_lat), longitude: Number(s.dest_lng) },
            }
          : null,
      };
    }),
  };
}

module.exports = { kpis, controlTower };
