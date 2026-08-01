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
    open_dossiers: await count(client, "SELECT count(*) n FROM dossier WHERE status IN ('OPEN','IN_PROGRESS')"),
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
    sla_on_time_pct: await num(client, "SELECT round(100.0 * count(*) FILTER (WHERE ata <= eta) / NULLIF(count(*) FILTER (WHERE ata IS NOT NULL AND eta IS NOT NULL), 0)) n FROM dossier"),
  };
}
/** Control Tower aggregate — the data the home screen shows: operation-file
 *  counts, the live-shipment list (open/in-progress dossiers), and how many
 *  approvals are waiting. Each query is guarded so a missing table/feature
 *  degrades to a zero/empty value instead of breaking the whole payload. */
async function controlTower(client) {
  const rows = async (sql) => {
    try { const r = await client.query(sql); return r.rows; } catch { return []; }
  };
  const one = async (sql) => (await rows(sql))[0] || {};

  const ops = await one(
    "SELECT COUNT(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS'))::int AS active, " +
      "COUNT(*) FILTER (WHERE status='OPEN')::int AS open, " +
      "COUNT(*) FILTER (WHERE status='IN_PROGRESS')::int AS in_progress " +
      "FROM dossier",
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
    "SELECT d.ref, d.status, d.pol AS origin, d.pod AS destination, d.vessel_flight, d.eta, " +
      "st.key AS service_key, " +
      "gp_o.latitude AS origin_lat, gp_o.longitude AS origin_lng, gp_o.name AS origin_name, " +
      "gp_d.latitude AS dest_lat, gp_d.longitude AS dest_lng, gp_d.name AS dest_name, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id) AS milestone_total, " +
      "(SELECT COUNT(*)::int FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id AND mi.status = 'DONE') AS milestone_done, " +
      "(SELECT mi.label FROM milestone_instance mi WHERE mi.dossier_id = d.dossier_id " +
      "AND mi.status IN ('IN_PROGRESS','PENDING') ORDER BY (mi.status = 'IN_PROGRESS') DESC, mi.stage_seq ASC LIMIT 1) AS current_milestone " +
      "FROM dossier d " +
      "LEFT JOIN service_type st ON st.service_type_id = d.service_type_id " +
      "LEFT JOIN geo_place gp_o ON gp_o.geo_place_id = d.pol_place_id " +
      "LEFT JOIN geo_place gp_d ON gp_d.geo_place_id = d.pod_place_id " +
      "WHERE d.status IN ('OPEN','IN_PROGRESS') " +
      "ORDER BY d.eta NULLS LAST, d.created_at DESC LIMIT 10",
  );
  const appr = await one("SELECT COUNT(*)::int AS awaiting FROM approval_task WHERE status = 'PENDING'");

  return {
    operation_files: { active: ops.active || 0, open: ops.open || 0, in_progress: ops.in_progress || 0 },
    approvals_awaiting: appr.awaiting || 0,
    live_shipments: shipments.map((s) => {
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
        coords: s.origin_lat != null && s.dest_lat != null
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
