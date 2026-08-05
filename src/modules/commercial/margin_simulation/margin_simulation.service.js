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

const ref = (id) => "margin_simulation:" + id;

/** Pure compute — no DB write. */
function preview({ lines = [] }) {
  return computeMargin(lines);
}

async function create(client, { dossierId = null, serviceTypeId = null, currency = "XAF", lines = [], actor = {} }) {
  const totals = computeMargin(lines);
  await client.query("BEGIN");
  try {
    const sim = await repo.insertSim(client, {
      dossier_id: dossierId, service_type_id: serviceTypeId, created_by: await resolveActorId(client, actor.user_id),
      margin_percent: totals.margin_percent, total_cost: totals.total_cost, total_price: totals.total_price,
      currency,
    });
    for (const ln of lines) {
      // eslint-disable-next-line no-await-in-loop
      await repo.insertLine(client, {
        margin_simulation_id: sim.margin_simulation_id, dictionary_item_id: ln.dictionary_item_id || null,
        label: ln.label || "Line", qty: ln.qty || 1, unit_cost: ln.unit_cost || 0, unit_price: ln.unit_price || 0,
        is_debours: ln.is_debours === true,
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
