"use strict";

/**
 * The metric registry — what a stat block is allowed to ask the ERP for.
 *
 * This is the point of the whole website project. SmartLS's home page hardcodes
 * `data-counter="41850"` for cubic metres managed; it was true on the day
 * somebody typed it. We hold the dossiers that produce that number, so ours can
 * be true this morning. That is a thing no web agency can sell them.
 *
 * ── WHY A REGISTRY AND NOT A QUERY ON THE BLOCK ────────────────────────────
 * The tempting shape is to let the stat block carry its own SQL, or a table and
 * column, or a filter expression. Every version of that is arbitrary execution
 * driven by tenant-editable content, which is not a thing to be escaped or
 * sandboxed into safety — it is a thing not to build.
 *
 * So a block stores a KEY. The key names a metric implemented here, in code,
 * reviewed like code. Anything not on this list resolves to null and the block
 * falls back to its literal value. Adding a metric is a pull request, which is
 * exactly the friction wanted: a number that appears on a client's public
 * website should have had somebody look at how it is computed.
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────
 * Each metric is `{ key, unit, resolve(client) => number|null }`. `resolve`
 * takes the LIVE tenant client the caller already has and returns a plain
 * number. It must be cheap: this runs on a public page render, so anything that
 * cannot be a single indexed aggregate belongs in a nightly rollup that this
 * then reads, not here.
 *
 * A resolver that throws must not take the page down with it. `resolveMetric`
 * catches and returns null, and the renderer falls back to the literal — a
 * stale number on the page beats a 500 on a client's website.
 */

const { logger } = require("../../../config/logger");

/**
 * @type {Map<string, {key: string, unit: string|null, resolve: (client: object) => Promise<number|null>}>}
 */
const REGISTRY = new Map();

function register(metric) {
  REGISTRY.set(metric.key, metric);
  return metric;
}

/* ── The definitions ───────────────────────────────────────────────────────
 * Settled 2026-08-30. Each states its window and its filter, because a number
 * on a client's public website will eventually be questioned and the answer
 * must be in the code rather than in somebody's memory.
 *
 * ALL of these read `dossier_visible`, never `dossier`. The view is
 * `dossier WHERE status <> 'DRAFT'` and its own comment is explicit: read from
 * here for "lists, counts, dashboards, the portal and anything that
 * enumerates". A half-finished wizard state is not a file and must never reach
 * a marketing statistic.
 *
 * All are ALL-TIME and filtered to COMPLETED. Two reasons. A counter that can
 * go DOWN between two visits reads as an error to a visitor, and all-time
 * completed only ever rises. And "completed" is the only claim that is
 * unambiguously true — an open file is work in progress, not a delivered
 * result, and counting it would be advertising work not yet done.
 */

register({
  key: "dossiers.volume_cbm_total",
  unit: "CBM",
  /**
   * Total cubic metres across every completed file.
   *
   * This is the direct equivalent of the number SmartLS hardcodes as 41,850.
   * `volume_cbm` sits on the dossier itself (0660), so this is a single indexed
   * aggregate rather than a walk over cargo lines.
   *
   * Files with a NULL volume contribute nothing rather than zero — SUM ignores
   * NULL — which is the honest treatment: a brokerage-only file has no volume,
   * and coercing it to 0 would be arithmetically identical but semantically a
   * claim that it moved nothing.
   */
  async resolve(client) {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(volume_cbm), 0)::float AS total
         FROM dossier_visible
        WHERE status = 'COMPLETED'`,
    );
    return rows[0] ? Math.round(rows[0].total) : 0;
  },
});

register({
  key: "dossiers.completed_count",
  unit: null,
  /** Files delivered, all time. The plainest claim on the list. */
  async resolve(client) {
    const { rows } = await client.query(
      "SELECT COUNT(*)::int AS n FROM dossier_visible WHERE status = 'COMPLETED'",
    );
    return rows[0] ? rows[0].n : 0;
  },
});

register({
  key: "clients.served_count",
  unit: null,
  /**
   * Distinct clients with at least one completed file.
   *
   * DISTINCT on client_id, so a client with two hundred files counts once —
   * the stat claims breadth, and inflating it with repeat business would be
   * claiming the wrong thing. Files with no client attached are excluded
   * rather than counted as an anonymous extra.
   */
  async resolve(client) {
    const { rows } = await client.query(
      `SELECT COUNT(DISTINCT client_id)::int AS n
         FROM dossier_visible
        WHERE status = 'COMPLETED' AND client_id IS NOT NULL`,
    );
    return rows[0] ? rows[0].n : 0;
  },
});

register({
  key: "operations.avg_clearance_hours",
  unit: "hours",
  /**
   * Average hours between the two stages a service type marks as its clearance
   * clock (12754).
   *
   * The pair is NOT hardcoded, because there is no single defensible pair:
   * DECLARATION_LODGED → CUSTOMS_RELEASED measures only what the forwarder
   * controls, while ARRIVAL → CUSTOMS_RELEASED includes the client being slow
   * with documents. Operations marks the right two on each template, and a
   * service type with no pair marked contributes nothing — correct for one
   * nobody has defined a clock for.
   *
   * Only the LATEST ACTIVE template per service type is consulted. Several
   * versions can be active at once, and mixing their codes would silently
   * average two different definitions into one number.
   *
   * The HAVING is belt to the partial unique indexes' braces: the database
   * already refuses two starts on one template, and if that guarantee were ever
   * lost this would decline to measure rather than pick one arbitrarily.
   *
   * `e.completed_at >= s.completed_at` drops files where the stages were
   * completed out of order — a backfill or a correction — which would otherwise
   * contribute a negative duration and pull the average below the truth.
   */
  async resolve(client) {
    const { rows } = await client.query(
      `WITH tpl AS (
         SELECT DISTINCT ON (t.service_type_id)
                t.milestone_template_id, t.service_type_id
           FROM milestone_template t
          WHERE t.is_active
          ORDER BY t.service_type_id, t.version DESC
       ),
       clock AS (
         SELECT tpl.service_type_id,
                MAX(s.code) FILTER (WHERE s.is_clearance_start) AS start_code,
                MAX(s.code) FILTER (WHERE s.is_clearance_end)   AS end_code
           FROM tpl
           JOIN milestone_template_stage s
             ON s.milestone_template_id = tpl.milestone_template_id
          GROUP BY tpl.service_type_id
         HAVING COUNT(*) FILTER (WHERE s.is_clearance_start) = 1
            AND COUNT(*) FILTER (WHERE s.is_clearance_end) = 1
       )
       SELECT AVG(EXTRACT(EPOCH FROM (e.completed_at - s.completed_at)) / 3600.0)::float AS hours
         FROM dossier_visible d
         JOIN clock c ON c.service_type_id = d.service_type_id
         JOIN milestone_instance s
           ON s.dossier_id = d.dossier_id AND s.code = c.start_code
         JOIN milestone_instance e
           ON e.dossier_id = d.dossier_id AND e.code = c.end_code
        WHERE d.status = 'COMPLETED'
          AND s.completed_at IS NOT NULL
          AND e.completed_at IS NOT NULL
          AND e.completed_at >= s.completed_at`,
    );
    // NULL when no service type has a pair marked, or none has completed a file
    // through both stages. resolveMetric turns that into a fallback to the
    // literal, which is exactly right: we have nothing to say yet.
    const hours = rows[0] ? rows[0].hours : null;
    return Number.isFinite(hours) ? Math.round(hours) : null;
  },
});

/*
 * ── DELIBERATELY NOT REGISTERED ───────────────────────────────────────────
 *
 * "Miles covered in land freight" (SmartLS advertises 123,433+).
 *   There is no distance anywhere in the tenant schema. The only distance
 *   column in the whole database is `attendance_log.distance_m`, which is HR
 *   geofencing — how far a person clocked in from their worksite — and has
 *   nothing to do with freight. This metric cannot be computed and must not be
 *   faked; it stays a literal the tenant types until routes carry a distance.
 */

register({
  key: "services.published_count",
  unit: null,
  /** How many services the tenant publishes. Not a dossier metric — no window
   *  or status question to settle, so it needs no definition beyond itself. */
  async resolve(client) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM service_type_web_profile p
         JOIN service_type st ON st.service_type_id = p.service_type_id
        WHERE p.is_published = true AND st.is_active = true`,
    );
    return rows[0] ? rows[0].n : 0;
  },
});

/** Every key a stat block may legally name. */
const metricKeys = () => [...REGISTRY.keys()];

const isMetricKey = (key) => REGISTRY.has(String(key || ""));

/**
 * Resolve one metric, or null.
 *
 * Null for three different reasons on purpose — unknown key, resolver returned
 * nothing, resolver threw — because the caller does the same thing with all
 * three: fall back to the literal the tenant typed. Distinguishing them at the
 * render path would only give the renderer a decision it should not be making.
 */
async function resolveMetric(client, key) {
  const metric = REGISTRY.get(String(key || ""));
  if (!metric) return null;
  try {
    const value = await metric.resolve(client);
    return Number.isFinite(value) ? value : null;
  } catch (err) {
    // A metric is decoration on a marketing page. It never takes the page down.
    logger.warn({ err, metric: metric.key }, "site metric failed to resolve");
    return null;
  }
}

module.exports = { REGISTRY, register, metricKeys, isMetricKey, resolveMetric };
