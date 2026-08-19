/**
 * Pricing Variance Index (MOD-27) — a DERIVED projection over the dossier
 * reconciliation (§2.1). No compute endpoint, no stored variance: the flag and
 * margin % are calculated from the reconciliation's quoted (header) and
 * budget/actual (line sums) on every read, so they can never drift from the
 * record they summarise. BUG-4 (caller-supplied actual_cost stored as fact) is
 * closed by construction — there is nothing to store.
 *
 * The Sales/Finance boundary is unchanged: Sales sees margin % + flag + quote,
 * never a cost figure; the finance view (route-gated on MOD-56) adds
 * budget/actual and the per-line drill-in.
 * Thresholds are a tenant business rule (settings commercial.pricing_variance).
 * All SQL is in the repo.
 */
"use strict";

const repo = require("./pricing_variance.repo");
const { projectRow, salesView } = require("./pricing_variance.rules");
const { getSetting } = require("../../../shared/config/settings");
const { AppError } = require("../../../utils/errors");

const thresholdsOf = async (client) =>
  (await getSetting(client, "commercial", "pricing_variance", null)) || {};

/** Sales list — R/Y/G + quote only, newest first. `flag` filters after the
 *  projection is computed (the flag is not stored anywhere to filter on). */
async function listSales(client, q = {}) {
  const thresholds = await thresholdsOf(client);
  const rows = await repo.projectionList(client, { dossierId: q.dossier_id, limit: q.limit, offset: q.offset });
  const projected = rows.map((r) => projectRow(r, thresholds));
  const filtered = q.flag ? projected.filter((r) => r.flag === q.flag) : projected;
  return filtered.map(salesView);
}

async function getSales(client, id) {
  const row = await repo.projectionGet(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Pricing variance not found", 404);
  return salesView(projectRow(row, await thresholdsOf(client)));
}

/** Finance-only: the full projection including budget/actual and the per-line
 *  detail — the drill-in a red flag needs. Gate at the route (MOD-56 view). */
async function getFinance(client, id) {
  const row = await repo.projectionGet(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Pricing variance not found", 404);
  const [thresholds, lines] = await Promise.all([
    thresholdsOf(client),
    repo.projectionLines(client, id),
  ]);
  return { ...projectRow(row, thresholds), lines };
}

module.exports = { listSales, getSales, getFinance };
