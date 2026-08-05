/**
 * Extra-charge / demurrage simulator (MOD-28) — rapid quotes, NO GL.
 * The tariff (tiers) comes from tenant settings (section "commercial",
 * key "demurrage_tariff") with an optional per-request override. `preview`
 * computes without persisting; `create` snapshots the per-day breakdown.
 */
"use strict";

const repo = require("./extra_charge_simulation.repo");
const events = require("./extra_charge_simulation.events");
const { computeDemurrage, daysBetween } = require("./extra_charge_simulation.rules");
const { getSetting } = require("../../../shared/config/settings");
const { audit, resolveActorId } = require("../../../shared/events/emit");

const ref = (id) => "extra_charge_simulation:" + id;

async function tiersFor(client, { containerVariant, override }) {
  if (Array.isArray(override) && override.length) return override;
  const tariff = (await getSetting(client, "commercial", "demurrage_tariff", null)) || {};
  const byVariant = containerVariant && tariff[containerVariant];
  const tiers = byVariant || tariff.default || tariff.tiers;
  if (!Array.isArray(tiers) || !tiers.length) {
    throw new Error("No demurrage tariff configured (settings commercial.demurrage_tariff) — pass tiers or configure one");
  }
  return tiers;
}

function occupiedDaysFrom({ occupiedDays, outOfPortOn, asOf }) {
  if (typeof occupiedDays === "number") return occupiedDays;
  if (outOfPortOn) return daysBetween(outOfPortOn, asOf || new Date().toISOString().slice(0, 10));
  return 0;
}

async function preview(client, body) {
  const tiers = await tiersFor(client, { containerVariant: body.container_variant, override: body.tiers });
  const occupiedDays = occupiedDaysFrom({ occupiedDays: body.occupied_days, outOfPortOn: body.out_of_port_on, asOf: body.as_of });
  return computeDemurrage({ freeDays: body.free_days, occupiedDays, tiers });
}

async function create(client, body, actor = {}) {
  const computed = await preview(client, body);
  await client.query("BEGIN");
  try {
    const sim = await repo.insertSim(client, {
      dossier_id: body.dossier_id || null, shipping_line: body.shipping_line || null,
      container_variant: body.container_variant || null, free_days: computed.free_days,
      out_of_port_on: body.out_of_port_on || null, computed_charges: JSON.stringify(computed.breakdown),
      total_amount: computed.total_amount, currency: body.currency || "XAF", created_by: await resolveActorId(client, actor.user_id),
    });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(sim.extra_charge_simulation_id), after: { total: computed.total_amount, days: computed.chargeable_days } });
    await client.query("COMMIT");
    return { ...sim, computed };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const get = (client, id) => repo.getSim(client, id);
const list = (client, q) => repo.listSims(client, q);

module.exports = { preview, create, get, list };
