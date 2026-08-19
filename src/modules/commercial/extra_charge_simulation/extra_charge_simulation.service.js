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
const { getSetting, getRule, putSetting } = require("../../../shared/config/settings");
const { audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const currencySvc = require("../../master/currency/currency.service");

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

/**
 * Resolve the FX map for a simulation.
 *
 * The legacy froze {XAF:1, USD:615, EUR:655.957} in a JS literal and never
 * persisted an edit (SS4). Conversion now uses the live currency module
 * (rateMap → fx_rate_daily). A caller may still pass an explicit `fx` for a
 * what-if, but it is layered over the live map rather than replacing it, so an
 * unlisted currency still converts at today's rate.
 */
async function resolveFx(client, body, currency) {
  const live = await currencySvc.rateMap(client, { extra: currency ? [currency] : [] });
  return { ...live, ...(body.fx || {}) };
}

/** Validate the requested currency exists in the catalogue (SS4) — the
 *  extra_charge_simulation.currency column is char(3) REFERENCES currency(code),
 *  so an unknown code would otherwise surface as a raw 23503. XAF is the base
 *  anchor and always accepted. */
async function assertCurrency(client, code) {
  const want = String(code || "XAF").toUpperCase().trim();
  if (want === "XAF") return want;
  const { rows } = await client.query("SELECT 1 FROM currency WHERE code = $1", [want]);
  if (!rows.length) {
    throw new AppError("UNKNOWN_CURRENCY", `Currency "${want}" is not in the currency catalogue — add it in Master Data → Currencies first`, 422);
  }
  return want;
}

async function fiveFamily(client, body) {
  const rates = body.rates || (await getSetting(client, "commercial", "extra_charge_rates", null)) || null;
  const currency = await assertCurrency(client, body.currency || "XAF");
  const fx = await resolveFx(client, body, currency);
  return simulateCharges({
    containers: body.containers,
    ata: body.ata || null,
    gateOut: body.gate_out || null,
    emptyReturn: body.empty_return || null,
    freeDays: body.free_days ?? LEGACY_FREE_DAYS,
    yardTrigger: body.yard_trigger ?? null,
    rates,
    fx,
    currency,
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
  // fiveFamily already validates the currency; the generic tier stores a
  // currency but has no conversion to touch it, so validate it here (SS4).
  const ccy = five ? null : await assertCurrency(client, body.currency || "XAF");
  const computed = five ? await fiveFamily(client, body) : await preview(client, body);

  const common = {
    dossier_id: body.dossier_id || null,
    shipping_line: body.shipping_line || null,
    container_variant: body.container_variant || null,
    currency: computed.currency || ccy || "XAF",
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
  // The VAT rate is the tenant's (settings finance.vat), same source as the
  // quotation totals — it was a 0.1925 literal here, which is exactly the
  // "frozen number" defect this module exists to avoid.
  const vatPercent = await getRule(client, "finance", "vat", "rate_percent", 19.25);
  return { rates: stored || DEFAULT_RATES, source: stored ? "settings" : "default", vat_rate: Number(vatPercent) / 100 };
}

/**
 * §3.2 — persist the Rate Configuration (the modal ON the simulator screen).
 *
 * The legacy placement was right (view/admin/extra-charges-simulator.php:481
 * opens #adminModal from the toolbar and saveAdminSettings() recalculates
 * live) — but its save was a lie: it mutated a JS object and alerted "Saved
 * locally!", so a reload restored 615 forever. This one writes the tariff to
 * settings commercial.extra_charge_rates, the same key `rates()` and the
 * engine read, so the next compute — anyone's compute — uses it. FX is NOT
 * accepted here: conversion rates belong to the currency module.
 */
async function saveRates(client, { rates: tariff, actor = {} }) {
  if (!tariff || typeof tariff !== "object") {
    throw new AppError("VALIDATION_ERROR", "A rates object is required", 422);
  }
  if (tariff.fx) {
    throw new AppError("FX_NOT_HERE", "FX rates are managed in Master Data → Currencies, not in the demurrage tariff", 422);
  }
  await putSetting(client, { section: "commercial", key: "extra_charge_rates", value: tariff, actor });
  await audit(client, { actorUserId: actor.user_id || null, action: "extra_charge_rates.updated", moduleKey: events.MODULE, entityRef: "setting:commercial/extra_charge_rates", after: { families: Object.keys(tariff) } });
  return rates(client);
}

/**
 * §3.2 — prefill from the file. The panel is titled "The file"; this is the
 * file. Containers, ATA and the shipping line come from the dossier so a
 * human never retypes what the system already knows; gate-out and empty
 * return stay theirs to enter (the system does not know them yet).
 */
async function prefill(client, dossierId) {
  const d = await repo.dossierPrefill(client, dossierId);
  if (!d) throw new AppError("NOT_FOUND", "Dossier not found", 404);
  const boxes = await repo.dossierContainers(client, dossierId);
  // "2x40HC, 1x20GP" — the same shape parseContainers reads, and still a
  // plain string the pricer can edit.
  const containerText = boxes.map((b) => `${b.qty}x${b.code}`).join(", ");
  return {
    dossier_id: d.dossier_id,
    ref: d.ref,
    shipping_line: d.shipping_line || null,
    ata: d.ata || null,
    eta: d.eta || null,
    vessel_flight: d.vessel_flight || null,
    bl_mawb: d.bl_mawb || null,
    containers: containerText || null,
    container_lines: boxes,
  };
}

const get = (client, id) => repo.getSim(client, id);
const list = (client, q) => repo.listSims(client, q);

module.exports = { preview, create, get, list, rates, saveRates, prefill, parseContainers };
