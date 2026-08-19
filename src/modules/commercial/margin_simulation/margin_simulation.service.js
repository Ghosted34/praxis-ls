/**
 * Margin simulator (MOD-27, KB §6.7) — rapid quote maths, NO GL.
 * `preview` computes without persisting; `create` snapshots the computed totals
 * and lines. Margin is on services only; débours are pass-through (rules file).
 * All SQL is in the repo.
 */
"use strict";

const repo = require("./margin_simulation.repo");
const events = require("./margin_simulation.events");
const { computeMargin, priceForMargin } = require("./margin_simulation.rules");
const { audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "margin_simulation:" + id;

/** Pure compute — no DB write. */
function preview({ lines = [] }) {
  return computeMargin(lines);
}

/**
 * The margin_simulation.currency column is char(3) REFERENCES currency(code)
 * (0345). A free-text code that does not exist used to surface as a raw 23503
 * FK violation; validate it against the catalogue first so the pricer gets a
 * 422 naming the bad code instead (SS4). XAF is the schema default and is
 * always accepted; anything else must exist in the tenant's currency table.
 */
async function assertCurrency(client, code) {
  const want = String(code || "XAF").toUpperCase().trim();
  if (want === "XAF") return want;
  const { rows } = await client.query("SELECT 1 FROM currency WHERE code = $1", [want]);
  if (!rows.length) {
    throw new AppError("UNKNOWN_CURRENCY", `Currency "${want}" is not in the currency catalogue — add it in Master Data → Currencies first`, 422);
  }
  return want;
}

async function create(client, { dossierId = null, serviceTypeId = null, currency = "XAF", lines = [], actor = {} }) {
  const ccy = await assertCurrency(client, currency);
  const totals = computeMargin(lines);
  await client.query("BEGIN");
  try {
    const sim = await repo.insertSim(client, {
      dossier_id: dossierId, service_type_id: serviceTypeId, created_by: await resolveActorId(client, actor.user_id),
      margin_percent: totals.margin_percent, total_cost: totals.total_cost, total_price: totals.total_price,
      currency: ccy,
    });
    for (const ln of lines) {
       
      await repo.insertLine(client, {
        margin_simulation_id: sim.margin_simulation_id, dictionary_item_id: ln.dictionary_item_id || null,
        label: ln.label || "Line", qty: ln.qty || 1, unit_cost: ln.unit_cost || 0, unit_price: ln.unit_price || 0,
        is_disbursement: ln.is_disbursement === true,
      });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(sim.margin_simulation_id), after: { totals } });
    await client.query("COMMIT");
    return { ...(await get(client, sim.margin_simulation_id)), totals };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const sim = await repo.getSim(client, id);
  if (!sim) return null;
  sim.lines = await repo.listLines(client, id);
  return sim;
}

const list = (client, q) => repo.listSims(client, q);

module.exports = { preview, create, get, list, priceForMargin };
