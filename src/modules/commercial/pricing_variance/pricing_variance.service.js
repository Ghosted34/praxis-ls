/**
 * Pricing Variance Index (MOD-27). Finance computes the index (it can see actual
 * cost); Sales only ever sees the R/Y/G flag + the quote (salesView strips cost).
 * Thresholds are a tenant business rule (settings commercial.pricing_variance).
 * All SQL is in the repo.
 */
"use strict";

const repo = require("./pricing_variance.repo");
const events = require("./pricing_variance.events");
const { computeVariance, flagFor, salesView } = require("./pricing_variance.rules");
const { getSetting } = require("../../../shared/config/settings");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

/** Compute + persist the variance for a dossier/quotation. Returns the Sales view. */
async function compute(client, { dossierId, quotationId = null, costingId = null, marginSimulationId = null, quotedPrice = null, actualCost = null, actor = {} }) {
  if (!dossierId) throw new AppError("DOSSIER_REQUIRED", "dossier_id is required", 422);
  const quoted = quotedPrice !== null ? Number(quotedPrice) : (quotationId ? await repo.quotedFor(client, quotationId) : null);
  if (quoted === null) throw new AppError("NO_QUOTE", "a quoted_price or a quotation_id is required", 422);
  const actual = actualCost !== null ? Number(actualCost) : await repo.actualCostFor(client, dossierId);
  const thresholds = (await getSetting(client, "commercial", "pricing_variance", null)) || {};
  const { margin_percent } = computeVariance({ quotedPrice: quoted, actualCost: actual });
  const flag = flagFor(margin_percent, thresholds);

  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, {
      dossier_id: dossierId, quotation_id: quotationId, margin_simulation_id: marginSimulationId, costing_id: costingId,
      quoted_price: quoted, actual_cost: actual, variance_percent: margin_percent, flag,
    });
    await emitEvent(client, { eventTypeKey: events.COMPUTED, moduleKey: events.MODULE, entityRef: "pricing_variance:" + row.pricing_variance_id, actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.COMPUTED, moduleKey: events.MODULE, entityRef: "pricing_variance:" + row.pricing_variance_id, after: { flag, variance_percent: margin_percent } });
    await client.query("COMMIT");
    return salesView(row);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const listSales = (client, q) => repo.listSales(client, { dossierId: q.dossier_id, flag: q.flag, limit: q.limit, offset: q.offset });
async function getSales(client, id) {
  const row = await repo.getSales(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Pricing variance not found", 404);
  return row;
}
/** Finance-only: full row including actual_cost. Gate at the route (finance perm). */
async function getFinance(client, id) {
  const row = await repo.getFull(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Pricing variance not found", 404);
  return row;
}

module.exports = { compute, listSales, getSales, getFinance };
