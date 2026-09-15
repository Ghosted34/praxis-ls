/**
 * The KPI band's shared vocabulary.
 *
 * One file defines the shapes every other file in this directory validates
 * against, because the band's cardinal sin is the two-place lie: the launcher
 * and the editor disagreeing about what "pinned to the tower" means, the
 * server and the client disagreeing about which tiles exist. The same failure
 * at 31 tiles × 5 domains is why entries are validated (see index.js's
 * self-check) rather than trusted.
 *
 * WHY A "module" ON EVERY ENTRY IS NOT DECORATION. Access is rows (0110 —
 * "RBAC as data"), and a tile is a read-aggregate over someone's module. The
 * `module` field is the ONLY thing the eligibility resolver consults: a tile
 * whose module the role cannot read is not dimmed in the picker, it does not
 * exist. That single rule is the difference between a settings surface and a
 * leak with checkboxes.
 */
"use strict";

/** Band size. The layout promise: four slots, ever. `xl:grid-cols-4` client-side. */
const MAX_BAND_TILES = 4;

/**
 * The five domains. Group order here is the picker's group order — the order
 * an operator's eye is trained to: money first, because it is why the tower
 * is opened in a meeting; people last, because HR tiles are the ones HR roles
 * search for rather than scan for. Governance signals (approvals, compliance,
 * location queue) live INSIDE Operations because that is where the work they
 * describe is done — a sixth group for three tiles would fragment the band.
 */
const DOMAINS = Object.freeze([
  "money",
  "operations",
  "fleet_warehouse",
  "sales_procurement",
  "human_capital",
]);

/**
 * Value shapes the client formats. Keep in step with `kpi-model.ts`.
 *
 *   money  a currency sum; the band formats `millions()` + `M <currency>`
 *   count  a plain integer
 *   pct    a 0–100 ratio — resolves as { value, denominator }; denominator 0
 *          renders 0 with the hint line (the guide's §6.4: "0 %" must not
 *          silently mean "nothing was measured")
 *   pair   n / m (fleet on-road, attendance) — same { value, denominator } pair
 *   days   an integer with a day unit
 */
const UNITS = Object.freeze(["money", "count", "pct", "pair", "days"]);

/** Exactly the Pill tones the client knows. A tone outside this set renders
 *  nothing and teaches nobody anything, so it must fail at require time. */
const TONES = Object.freeze(["orange", "ok", "warn", "bad", "blue", "mute"]);

/** A tile is `live` when its value query ships. `hidden` entries are declared
 *  — id, module, unit, label keys — but not offered to pickers, so domain PRs
 *  flip a status rather than invent an id in two places at once. */
const STATUSES = Object.freeze(["live", "hidden"]);

/**
 * Validate one entry at module load. Loud beats defensive: every consumer
 * below trusts these fields unconditionally, and a typo in a catalog is the
 * kind of bug that renders a blank tile and reads as a product outage.
 */
function assertEntry(entry) {
  const problems = [];
  if (!/^[a-z0-9][a-z0-9_]{1,39}$/.test(entry.id || "")) {
    problems.push(`id "${entry.id}" must match /^[a-z0-9][a-z0-9_]{1,39}$/`);
  }
  if (!DOMAINS.includes(entry.domain)) problems.push(`${entry.id}: unknown domain "${entry.domain}"`);
  if (!UNITS.includes(entry.unit)) problems.push(`${entry.id}: unknown unit "${entry.unit}"`);
  if (!/^MOD-[0-9A-Z]+$/.test(entry.module || "")) problems.push(`${entry.id}: module must look like "MOD-xx", got "${entry.module}"`);
  if (!STATUSES.includes(entry.status)) problems.push(`${entry.id}: status must be live|hidden, got "${entry.status}"`);
  if (!TONES.includes(entry.tone)) problems.push(`${entry.id}: tone "${entry.tone}" is not a Pill tone`);
  if (!entry.labelKey || !entry.labelKey.startsWith("dash.")) problems.push(`${entry.id}: labelKey must be a dash.* i18n key`);
  if (!entry.sourceRelation) problems.push(`${entry.id}: sourceRelation is what the availability probe checks`);
  const sensitive = entry.sensitive_field;
  if (sensitive !== null && sensitive !== undefined && !/^[a-z_.]+$/.test(sensitive)) {
    problems.push(`${entry.id}: sensitive_field must be a field_visibility key, got "${entry.sensitive_field}"`);
  }
  if (entry.drillTo !== null && entry.drillTo !== undefined && typeof entry.drillTo !== "string") {
    problems.push(`${entry.id}: drillTo must be a route string`);
  }
  if (problems.length) {
    throw new Error(`kpi_catalog: bad entry:\n  ${problems.join("\n  ")}`);
  }
  return entry;
}

module.exports = {
  MAX_BAND_TILES,
  DOMAINS,
  UNITS,
  TONES,
  STATUSES,
  assertEntry,
};
