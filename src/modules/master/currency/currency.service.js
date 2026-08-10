/**
 * Currency & live FX (MOD-08, feature finance.fx). Two halves:
 *   - the CURRENCY MASTER — add from the ISO-4217 catalogue, edit, activate /
 *     deactivate, set the base, delete (FK-safe), and the per-currency 360; and
 *   - FX RESOLUTION — the rate to stamp on a transaction (rateFor), conversion,
 *     manual overrides (setRate), and the live sync (syncNow).
 * The daily exchangerate-api sync runs from the `fx-sync` worker job; the "Sync
 * now" button calls the same core (currency.sync). SQL lives in the repo.
 */
"use strict";
const repo = require("./currency.repo");
const events = require("./currency.events");
const dossierSvc = require("./currency.dossier");
const sync = require("./currency.sync");
const { pickRate, convert } = require("./currency.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const today = () => new Date().toISOString().slice(0, 10);

/* ── FX resolution ────────────────────────────────────────────────────────── */

async function rateFor(client, { base, quote, date }) {
  const d = date || today();
  if (base === quote) return { base, quote, rate: 1, source: "identity", as_of_date: d, is_override: false };
  const rows = await repo.ratesForPair(client, base, quote, d);
  const row = pickRate(rows, base, quote, d);
  if (!row) throw new AppError("NO_FX_RATE", "No FX rate for " + base + "->" + quote + " on/before " + d, 422);
  return row;
}

async function convertAmount(client, { amount, base, quote, date }) {
  const row = await rateFor(client, { base, quote, date });
  return { amount: Number(amount), base, quote, rate: Number(row.rate), converted: convert(amount, row), as_of_date: row.as_of_date, source: row.source };
}

async function setRate(client, { base, quote, rate, asOfDate, source = "manual", isOverride = true, actor = {} }) {
  if (!(Number(rate) > 0)) throw new AppError("BAD_RATE", "rate must be > 0", 422);
  const row = await repo.upsertRate(client, { base, quote, rate, asOfDate: asOfDate || today(), source, isOverride });
  await emitEvent(client, { eventTypeKey: events.RATE_SET, moduleKey: events.MODULE, entityRef: "fx:" + base + "-" + quote, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.RATE_SET, moduleKey: events.MODULE, entityRef: "fx:" + base + "-" + quote, after: row });
  return row;
}

/** Run the live sync now (base→all active). Same core as the daily cron. */
async function syncNow(client, actor = {}) {
  const result = await sync.syncRates(client, {});
  // Strict `=== true`: `skipped` is the sentinel boolean, never an array. See
  // the syncRates JSDoc — an empty-array escape used to make this branch
  // silently skip the audit on every successful sync.
  if (result.skipped !== true) {
    await emitEvent(client, { eventTypeKey: events.RATE_SYNCED, moduleKey: events.MODULE, entityRef: "fx:sync", actorUserId: actor.user_id || null, payload: { updated: result.updated ? result.updated.length : 0, base: result.base } });
    await audit(client, { actorUserId: actor.user_id || null, action: events.RATE_SYNCED, moduleKey: events.MODULE, entityRef: "fx:sync", after: result });
  }
  return result;
}

/* ── Currency master ──────────────────────────────────────────────────────── */

const listCurrencies = (client) => repo.listCurrencies(client);
const listCurrenciesRich = (client, q = {}) =>
  repo.listCurrenciesRich(client, { all: q.all === "1" || q.all === true, usage: q.usage === "1" || q.usage === true });
const listRates = (client, q) => repo.listRates(client, q);
const dossier = (client, code) => dossierSvc.dossier(client, code);

async function addCurrency(client, { code, name, symbol, decimals, actor = {} }) {
  const row = await repo.insertCurrency(client, { code, name, symbol, decimals });
  await emitEvent(client, { eventTypeKey: events.CURRENCY_ADDED, moduleKey: events.MODULE, entityRef: "currency:" + code, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CURRENCY_ADDED, moduleKey: events.MODULE, entityRef: "currency:" + code, after: row });
  return row;
}

async function editCurrency(client, code, patch, actor = {}) {
  const existing = await repo.getCurrency(client, code);
  if (!existing) throw new AppError("NOT_FOUND", "Currency not found", 404);
  // The base must always be active — deactivating it would leave FX with no anchor.
  if (patch.is_active === false && existing.is_base) {
    throw new AppError("BASE_CURRENCY", "The base currency cannot be deactivated. Set another base first.", 422);
  }
  const row = await repo.updateCurrency(client, code, patch);
  await emitEvent(client, { eventTypeKey: events.CURRENCY_UPDATED, moduleKey: events.MODULE, entityRef: "currency:" + code, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CURRENCY_UPDATED, moduleKey: events.MODULE, entityRef: "currency:" + code, before: existing, after: row });
  return row;
}

async function setBase(client, code, actor = {}) {
  const existing = await repo.getCurrency(client, code);
  if (!existing) throw new AppError("NOT_FOUND", "Currency not found", 404);
  const changed = await repo.setBase(client, code);
  await emitEvent(client, { eventTypeKey: events.BASE_SET, moduleKey: events.MODULE, entityRef: "currency:" + code, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.BASE_SET, moduleKey: events.MODULE, entityRef: "currency:" + code, before: { base: existing.is_base ? code : null }, after: { base: code } });
  return { base: code, changed };
}

async function removeCurrency(client, code, actor = {}) {
  const existing = await repo.getCurrency(client, code);
  if (!existing) throw new AppError("NOT_FOUND", "Currency not found", 404);
  if (existing.is_base) throw new AppError("BASE_CURRENCY", "The base currency cannot be deleted. Set another base first.", 409);
  try {
    await repo.deleteCurrency(client, code);
  } catch (e) {
    // 23503 = FK violation: something still references this currency. Deleting it
    // would orphan real financial records, so refuse and point to deactivation,
    // which hides it from new transactions while keeping its history intact.
    if (e && e.code === "23503") {
      throw new AppError(
        "CURRENCY_IN_USE",
        "This currency is used by existing records and cannot be deleted. Deactivate it instead to remove it from new transactions while keeping its history.",
        409,
      );
    }
    throw e;
  }
  await emitEvent(client, { eventTypeKey: events.CURRENCY_REMOVED, moduleKey: events.MODULE, entityRef: "currency:" + code, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CURRENCY_REMOVED, moduleKey: events.MODULE, entityRef: "currency:" + code, before: existing });
  return { code };
}

module.exports = {
  rateFor,
  convertAmount,
  setRate,
  syncNow,
  listCurrencies,
  listCurrenciesRich,
  listRates,
  dossier,
  addCurrency,
  editCurrency,
  setBase,
  removeCurrency,
};
