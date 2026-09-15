/**
 * The KPI band's catalog — every tile, its grant gate, and its value source,
 * in one place.
 *
 * THE ONE-LINE RULE OF THIS DIRECTORY (doc/KPI_BAND_ENGINEERING_GUIDE.md §4):
 * a tile inherits rights, it never grants them. Every number here is a
 * read-aggregate over a module the caller can already open, so the band can
 * reach 31 tiles without adding one row of authority — and revoking a module
 * silently retires its tiles from pickers, bands and role configs, because
 * eligibility is COMPUTED at read time, never stored.
 *
 * WHY THE CATALOG IS CODE AND NOT A TABLE. `0110_rbac.sql` made roles rows
 * because WHICH rights exist is a tenant's business. WHICH precomputed number
 * the tower can paint is not — it is a claim about a query this repository
 * ships, and an admin-configurable KPI ("write your own SQL, hero") is how a
 * dashboard earns a fake number. The tenant-facing dial is the role config
 * (scope/default/lock over THESE ids), not a second catalogue.
 *
 * WHY SELF-CHECKS RUN AT REQUIRE TIME. Five domain files, four PRs, one band.
 * The failure mode is a half-flipped entry — `status: "live"` shipped without
 * a value source, or an id that half the dictionary lacks. A thrown Error at
 * boot with the problems enumerated is the cheapest place in the world to
 * find that, and `kpi-catalog.test.js` requires this file so CI finds it
 * before a tenant does.
 */
"use strict";

const guards = require("./guards");
const { MAX_BAND_TILES, DOMAINS, UNITS, TONES, STATUSES, assertEntry } = require("./shared");

const DOMAINS_BY_NAME = {
  money: require("./money"),
  operations: require("./operations"),
  fleet_warehouse: require("./fleet_warehouse"),
  sales_procurement: require("./sales_procurement"),
  human_capital: require("./human_capital"),
};

/* ── assembly + self-check ────────────────────────────────────────────────── */

const CATALOG = Object.freeze(
  DOMAINS.flatMap((name) => DOMAINS_BY_NAME[name].ENTRIES).map(assertEntry),
);

const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

/** The ids a picker may offer: live entries only. Hidden entries are declared
 *  so migrations can seed toward stable ids and the domain file owns its own
 *  flip; they are invisible to every user until they are live. */
const LIVE_IDS = Object.freeze(CATALOG.filter((e) => e.status === "live").map((e) => e.id));

/**
 * Run once, at require time: a broken catalog must fail the boot, not the
 * band. The structural rules below are synchronous and total; the async rule
 * that needs to CALL each domain's `values()` — "every live id is answered,
 * nothing hidden is answered, nothing answered twice" — lives in
 * `checkValueCoverage()` and `kpi-catalog.test.js` runs it (and boots every
 * domain's guard against a rejecting client to pin it).
 */
function assertCatalogSane() {
  const problems = [];
  const seen = new Set();
  for (const e of CATALOG) {
    if (seen.has(e.id)) problems.push(`duplicate id "${e.id}"`);
    seen.add(e.id);
    if (!DOMAINS_BY_NAME[e.domain]) problems.push(`${e.id}: domain "${e.domain}" has no module file`);
    if (e.status === "live" && typeof DOMAINS_BY_NAME[e.domain].values !== "function") {
      problems.push(`${e.id}: live tile but ${e.domain} has no values() source`);
    }
  }
  if (problems.length) throw new Error(`kpi_catalog:\n  ${problems.join("\n  ")}`);
}

/**
 * The stronger, ASYNC sanity check, exported so the boot path can use it
 * without a require-time side effect: every live id must have exactly one
 * value source, no source may answer for a hidden id, and the id set of a
 * domain's entries must equal the union of its statuses.
 */
async function checkValueCoverage() {
  const problems = [];
  const liveIds = new Set(LIVE_IDS);
  const answered = new Set();
  for (const [name, mod] of Object.entries(DOMAINS_BY_NAME)) {
    let out = {};
    try {
      // A dead client makes every guarded query answer null — the check is on
      // the KEYS the function writes, which it writes before querying.
      out = await mod.values({ query: () => Promise.reject(new Error("self-check")) }, guards);
    } catch (err) {
      problems.push(`${name}: values() threw (${err.message}) — guards must swallow, not rethrow`);
    }
    for (const id of Object.keys(out)) {
      if (answered.has(id)) problems.push(`"${id}" answered by two domains`);
      answered.add(id);
      if (!liveIds.has(id)) problems.push(`${name}: values() answers "${id}" but it is not live`);
    }
    for (const e of mod.ENTRIES) {
      if (e.status === "live" && !(e.id in out)) {
        // Live with no source = the tile would silently vanish forever.
        problems.push(`${name}: live tile "${e.id}" has no value source`);
      }
    }
  }
  return problems;
}

/* ── availability probe ───────────────────────────────────────────────────── */

/**
 * Which tiles' source relations exist in THIS schema right now.
 *
 * One `to_regclass` SELECT for every distinct relation in the catalog, not a
 * try-catch probe per tile: the difference is one statement versus twenty, and
 * the result is the same boolean. This is what makes a module-off tenant cost
 * nothing — a hidden relation is a false, the tile is unavailable, and the
 * value query for it never runs.
 *
 * Runs on the ENVIRONMENT schema (the request's tenantDb), because "is the
 * fleet installed" is a question about the data the band would count — and
 * that is precisely what differs between LIVE and TEST. The CHOICE of tiles
 * is identity data and never comes through here (D5: one arrangement, both
 * modes; the numbers differ, the slots don't).
 */
async function availableRelations(client) {
  const relations = [...new Set(CATALOG.map((e) => e.sourceRelation))];
  if (!relations.length) return new Set();
  const sql = `SELECT ${relations.map((_, i) => `to_regclass($${i + 1}::text) IS NOT NULL AS r${i}`).join(", ")}`;
  try {
    const { rows } = await client.query(sql, relations);
    const ok = new Set();
    relations.forEach((r, i) => {
      if (rows[0][`r${i}`] === true) ok.add(r);
    });
    return ok;
  } catch {
    /* @silent:guard */ // if the probe itself fails, nothing is hidden by this
    // layer — the per-tile guards still answer null for anything truly
    // missing, and an availability bug must not empty the whole band.
    return new Set(relations);
  }
}

/* ── catalog reads for the endpoints ──────────────────────────────────────── */

/** Public metadata for a tile: everything a renderer needs, nothing a
 *  resolver would recompute. Keys are i18n keys, never strings — the band is
 *  fully EN/FR (PRD §605) and a server-side label would freeze a language. */
function publicMeta(entry) {
  return {
    id: entry.id,
    domain: entry.domain,
    unit: entry.unit,
    module: entry.module,
    status: entry.status,
    tone: entry.tone,
    icon: entry.icon,
    labelKey: entry.labelKey,
    hintKey: entry.hintKey,
    badgeKey: entry.badgeKey,
    drillTo: entry.drillTo,
  };
}

/**
 * Values for the live tiles, on the request's business schema.
 *
 * Returns `{ id → number | {value,denominator} | null }`. null means the
 * guard failed (relation missing, module off) — the tile is UNAVAILABLE; a
 * number (including 0) is a truth to render. This is the whole zero policy
 * in one function's contract, and `kpi-band-resolve.test.js` pins it.
 */
async function valuesFor(client, ids) {
  const wanted = new Set(ids.filter((id) => BY_ID.has(id) && LIVE_IDS.includes(id)));
  const out = {};
  const normalize = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "object" && "value" in v) {
      const value = Number(v.value);
      const denominator = Number(v.denominator) || 0;
      return {
        value: Number.isFinite(value) ? value : 0,
        denominator: Number.isFinite(denominator) ? denominator : 0,
      };
    }
    return null;
  };
  for (const [name, mod] of Object.entries(DOMAINS_BY_NAME)) {
    if (![...wanted].some((id) => BY_ID.get(id).domain === name)) continue;
    const answered = await mod.values(client, guards);
    for (const [id, value] of Object.entries(answered)) {
      if (wanted.has(id)) out[id] = normalize(value);
    }
  }
  // An id the domain forgot to answer is UNAVAILABLE, never a ghost slot that
  // paints an empty card. Same for anything the caller asked for that is not
  // live — callers resolve from this map, so silence and absence must agree.
  for (const id of wanted) if (!(id in out)) out[id] = null;
  return out;
}

module.exports = {
  MAX_BAND_TILES,
  DOMAINS,
  UNITS,
  TONES,
  STATUSES,
  CATALOG,
  BY_ID,
  LIVE_IDS,
  assertCatalogSane,
  checkValueCoverage,
  availableRelations,
  publicMeta,
  valuesFor,
};

// The require-time self-check. If this throws, the catalog shipped broken —
// better the boot than the band.
assertCatalogSane();
