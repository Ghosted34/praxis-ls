/**
 * Currency & live FX (MOD-08, feature finance.fx). Resolves the rate to stamp on
 * a transaction (rateFor), converts amounts, and records manual overrides. The
 * daily exchangerate-api sync runs from the `fx-sync` worker job. SQL in the repo.
 */
"use strict";
const repo = require("./currency.repo");
const events = require("./currency.events");
const { pickRate, convert } = require("./currency.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const today = () => new Date().toISOString().slice(0, 10);

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

const listCurrencies = (client) => repo.listCurrencies(client);
const listRates = (client, q) => repo.listRates(client, q);

module.exports = { rateFor, convertAmount, setRate, listCurrencies, listRates };
