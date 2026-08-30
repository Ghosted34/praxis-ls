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

/**
 * Published services. Deliberately the first one: it is a single indexed count
 * over tables this module already owns, so it proves the mechanism end to end
 * without inventing dossier arithmetic that has not been agreed.
 *
 * The operational metrics SmartLS advertises — cubic metres managed, average
 * clearance hours, distance covered — each need a definition signed off by
 * operations before they go on a client's public page ("managed" over what
 * window? clearance measured from which milestone to which?). They are
 * deliberately absent rather than guessed: a wrong number in public is worse
 * than a literal somebody chose on purpose.
 */
register({
  key: "services.published_count",
  unit: null,
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
