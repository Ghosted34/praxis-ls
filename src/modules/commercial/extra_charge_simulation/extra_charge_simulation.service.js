/**
 * Extra-charge / demurrage-detention simulator (MOD-28) — rapid quotes, NO GL.
 *
 * TWO ENGINES, ONE ENDPOINT. `simulateCharges` is the ported legacy model: a
 * container list, three dates, five charge families, absolute day bands.
 * `computeDemurrage` is the generic tiered model the rebuild shipped first —
 * demurrage only, one box, day 1 rebased to the first chargeable day. They
 * disagree about what "day 12" means, so a request is routed to exactly one of
 * them and never blends the two: a body carrying `containers` is the legacy
 * model, anything else is the generic one.
 *
 * The tariff comes from tenant settings (`commercial.extra_charge_rates` for
 * the five-family model, `commercial.demurrage_tariff` for the generic tiers),
 * with an optional per-request override for what-ifs.
 */
"use strict";

const repo = require("./extra_charge_simulation.repo");
const events = require("./extra_charge_simulation.events");
const { computeDemurrage, daysBetween, simulateCharges, parseContainers } = require("./extra_charge_simulation.rules");
const { getSetting } = require("../../../shared/config/settings");
const { audit, resolveActorId } = require("../../../shared/events/emit");

const ref = (id) => "extra_charge_simulation:" + id;

/** The legacy free period: billing starts on day 12, i.e. 11 free days. */
const LEGACY_FREE_DAYS = 11;

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

/** True when the body asks for the five-family (legacy) model. */
const isFiveFamily = (body) =>
  Boolean(body.containers) && (Array.isArray(body.containers) ? body.containers.length > 0 : String(body.containers).trim() !== "");

async function fiveFamily(client, body) {
  const rates = body.rates || (await getSetting(client, "commercial", "extra_charge_rates", null)) || null;
  return simulateCharges({
    containers: body.containers,
    ata: body.ata || null,
    gateOut: body.gate_out || null,
    emptyReturn: body.empty_return || null,
    freeDays: body.free_days ?? LEGACY_FREE_DAYS,
    yardTrigger: body.yard_trigger ?? null,
    rates,
    fx: body.fx || null,
    currency: body.currency || "XAF",
  });
}

async function preview(client, body) {
  if (isFiveFamily(body)) return fiveFamily(client, body);
  const tiers = await tiersFor(client, { containerVariant: body.container_variant, override: body.tiers });
  const occupiedDays = occupiedDaysFrom({ occupiedDays: body.occupied_days, outOfPortOn: body.out_of_port_on, asOf: body.as_of });
  return computeDemurrage({ freeDays: body.free_days, occupiedDays, tiers });
}

/**
 * Persist a simulation.
 *
 * THIS WAS BROKEN. It read `computed.free_days`, `computed.breakdown` and
 * `computed.total_amount` off whatever `preview` returned — but the five-family
 * result has none of those keys, so a container-list simulation wrote NULL into
 * `total_amount NOT NULL` and failed at the constraint. Only `preview` had a
 * test, so nothing caught it. The two shapes are now mapped explicitly.
 *
 * What is stored for the five-family model (columns added in 10716): the parsed
 * container list, the three dates, the rows as `computed_charges`, HT / VAT /
 * TTC, and the resolved tariff as `rates_snapshot` — so the row can still
 * explain its own total after the tenant edits the tariff.
 */
async function create(client, body, actor = {}) {
  const five = isFiveFamily(body);
  const computed = five ? await fiveFamily(client, body) : await preview(client, body);

  const common = {
    dossier_id: body.dossier_id || null,
    shipping_line: body.shipping_line || null,
    container_variant: body.container_variant || null,
    currency: computed.currency || body.currency || "XAF",
    created_by: await resolveActorId(client, actor.user_id),
  };

  const data = five
    ? {
        ...common,
        containers: JSON.stringify(computed.containers),
        ata: body.ata || null,
        gate_out: body.gate_out || null,
        empty_return: body.empty_return || null,
        free_days: computed.free_days,
        yard_trigger: computed.yard_trigger,
        out_of_port_on: body.gate_out || null,
        computed_charges: JSON.stringify({ rows: computed.rows, families: computed.families, metrics: {
          port_stay_days: computed.port_stay_days, due_date: computed.due_date, status: computed.status,
          container_count: computed.container_count, teu: computed.teu, vat_rate: computed.vat_rate,
        } }),
        rates_snapshot: JSON.stringify(computed.rates_used),
        total_ht: computed.total_ht,
        vat_total: computed.vat,
        total_amount: computed.total_ttc,
      }
    : {
        ...common,
        free_days: computed.free_days,
        out_of_port_on: body.out_of_port_on || null,
        computed_charges: JSON.stringify(computed.breakdown),
        total_ht: computed.total_amount,
        vat_total: 0,
        total_amount: computed.total_amount,
      };

  await client.query("BEGIN");
  try {
    const sim = await repo.insertSim(client, data);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.CREATED,
      moduleKey: events.MODULE,
      entityRef: ref(sim.extra_charge_simulation_id),
      after: {
        total_ttc: data.total_amount,
        currency: data.currency,
        model: five ? "five_family" : "tiered",
        containers: five ? computed.container_count : null,
        days: five ? computed.port_stay_days : computed.chargeable_days,
      },
    });
    await client.query("COMMIT");
    return { ...sim, computed };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/** The tariff a screen should render in its rate editor. */
async function rates(client) {
  const { DEFAULT_RATES } = require("./extra_charge_simulation.rules");
  const stored = await getSetting(client, "commercial", "extra_charge_rates", null);
  return { rates: stored || DEFAULT_RATES, source: stored ? "settings" : "default", vat_rate: 0.1925 };
}

const get = (client, id) => repo.getSim(client, id);
const list = (client, q) => repo.listSims(client, q);

module.exports = { preview, create, get, list, rates, parseContainers };
