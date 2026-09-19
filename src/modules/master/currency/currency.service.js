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
const { pickRate, convert, rebaseRates } = require("./currency.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { atomically } = require("../../../shared/db/tx");
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

/**
 * The base→quote rate table as a `{ [code]: rate }` map for a given date,
 * INCLUDING the base at 1. This is the shape the simulators need (one lookup
 * per currency), and it is resolved LIVE from fx_rate_daily via rateFor — not
 * a JS literal — so a treasurer's rate edit moves every quote immediately.
 *
 * `extra` are additional codes the caller wants even if they are not active
 * (e.g. a legacy simulation that quoted a since-deactivated currency). An
 * unknown/unpriced code is simply omitted; callers fall back to identity for
 * anything missing rather than crashing a what-if.
 *
 * PROPERTY-INJECTION HARDENING (CodeQL js/remote-property-injection). `extra`
 * can originate in a request body, so a computed property write keyed on it
 * (`out[code] = …`) is the exact sink the query flags — and the query does
 * not credit regex guards or null prototypes as sanitisers, so the sink has
 * to GO, not be fenced. Rates therefore accumulate in a Map (Map.set is not
 * a property write; "__proto__" is just an ordinary Map key) and become a
 * plain object once, via Object.fromEntries, at the end. The ISO-4217 shape
 * filter on extras stays as defence in depth: a non-code never even joins
 * the lookup set, which is the same "omit and fall back" contract as an
 * unpriced code.
 */
const ISO_CODE = /^[A-Z0-9]{3}$/;

async function rateMap(client, { date, extra = [] } = {}) {
  const d = date || today();
  const base = (await repo.getBaseCode(client)) || "XAF";
  const wanted = (Array.isArray(extra) ? extra : [])
    .map((c) => String(c || "").toUpperCase().trim())
    .filter((c) => ISO_CODE.test(c));
  const codes = new Set((await repo.listActiveCodes(client)).concat(wanted));
  codes.delete(base);
  const rates = new Map([[base, 1]]);
  for (const code of codes) {
    try {
      const r = await rateFor(client, { base, quote: code, date: d });
      rates.set(code, Number(r.rate));
    } catch {
      /* @silent:storage — a missing FX pair is an expected what-if state
         (a currency the tenant has not priced yet), not an error; omit it and
         let the caller fall back to identity for that code. */
    }
  }
  return Object.fromEntries(rates);
}

async function setRate(client, { base, quote, rate, asOfDate, source = "manual", isOverride = true, actor = {} }) {
  if (!(Number(rate) > 0)) throw new AppError("BAD_RATE", "rate must be > 0", 422);
  // Persist the actor on the rate row (audit #9 — "who set it") AND in the
  // immutable ledger. The denormalised column lets the 360 override log render
  // the name without a cross-table join; the audit is the tamper-evident record.
  const row = await repo.upsertRate(client, { base, quote, rate, asOfDate: asOfDate || today(), source, isOverride, setByUserId: actor.user_id || null });
  await emitEvent(client, { eventTypeKey: events.RATE_SET, moduleKey: events.MODULE, entityRef: "fx:" + base + "-" + quote, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.RATE_SET, moduleKey: events.MODULE, entityRef: "fx:" + base + "-" + quote, after: row });
  return row;
}

/**
 * Run the live sync now (base→all active). Same core as the daily cron, and now
 * WRAPPED IN A SYNC-RUN RECORD (audit #6) so an administrator can see when sync
 * last ran, whether it succeeded, and what it updated/left unsupported. A skip
 * (no key / no quotes) and a real failure are both recorded — a disabled sync
 * and a silently-failing one must be distinguishable. `trigger` marks manual vs
 * cron so the master-page banner can say which.
 */
async function syncNow(client, actor = {}, { trigger = "manual" } = {}) {
  const runId = await repo.startSyncRun(client, { trigger, actorUserId: actor.user_id || null });
  try {
    const result = await sync.syncRates(client, {});
    // Strict `=== true`: `skipped` is the sentinel boolean, never an array. See
    // the syncRates JSDoc — an empty-array escape used to make this branch
    // silently skip the audit on every successful sync.
    if (result.skipped === true) {
      await repo.finishSyncRun(client, runId, { status: "skipped", reason: result.reason || null, base: result.base || null });
    } else {
      const status = result.unsupported && result.unsupported.length ? "partial" : "ok";
      await repo.finishSyncRun(client, runId, {
        status,
        updatedCount: result.updated ? result.updated.length : 0,
        unsupported: result.unsupported || [],
        base: result.base || null,
      });
      await emitEvent(client, { eventTypeKey: events.RATE_SYNCED, moduleKey: events.MODULE, entityRef: "fx:sync", actorUserId: actor.user_id || null, payload: { updated: result.updated ? result.updated.length : 0, base: result.base } });
      await audit(client, { actorUserId: actor.user_id || null, action: events.RATE_SYNCED, moduleKey: events.MODULE, entityRef: "fx:sync", after: result });
    }
    return result;
  } catch (e) {
    // Record the failure before rethrowing so the run log shows WHY, not just
    // that a run started and vanished. The message is provider/HTTP text from
    // syncRates (never the URL — the API key is a path segment).
    await repo.finishSyncRun(client, runId, { status: "error", reason: e && e.message ? String(e.message).slice(0, 500) : "sync failed" });
    throw e;
  }
}

/* ── Currency master ──────────────────────────────────────────────────────── */

const listCurrencies = (client) => repo.listCurrencies(client);
const listCurrenciesRich = (client, q = {}) =>
  repo.listCurrenciesRich(client, { all: q.all === "1" || q.all === true, usage: q.usage === "1" || q.usage === true });
const listRates = (client, q) => repo.listRates(client, q);
const dossier = (client, code) => dossierSvc.dossier(client, code);

/**
 * A page of rate history for a pair — the Gate-0 contract shared with the
 * dossier and the generic list: `{ data, total, limit, offset, has_more }`,
 * deterministic ordering, actor name for overrides. The dossier's first page is
 * embedded in the 360; this endpoint serves the "load more" beyond it.
 */
async function rateHistoryPage(client, { base, quote, limit, offset } = {}) {
  if (!base || !quote) throw new AppError("VALIDATION_ERROR", "base and quote are required", 422);
  const r = await repo.rateHistory(client, { base, quote, limit, offset });
  return { data: r.rows, total: r.total, limit: r.limit, offset: r.offset, has_more: r.offset + r.rows.length < r.total };
}

/**
 * Operational sync status for the master page (audit #6): whether a provider key
 * is configured, whether the nightly scheduler is enabled, and the last run's
 * outcome/freshness. Read-only; safe to call on every page load.
 */
async function syncStatus(client) {
  const [key, last, base] = await Promise.all([
    sync.resolveKey(client),
    repo.lastSyncRun(client),
    repo.getBaseCode(client),
  ]);
  return {
    key_configured: !!key,
    scheduler_enabled: !!require("../../../config/env").config.FX_SYNC_CRON,
    base,
    last_run: last,
  };
}

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

/**
 * Change the base currency — FORMAL REBASE (Gate-0 decision, audit #7).
 *
 * A base change is not just a flag flip: the whole cross-rate table is anchored
 * on the base, so the CURRENT working rates are rebased onto the new base in the
 * same transaction (currency.rules.rebaseRates does the pure math):
 *   · new→old  = 1 / (old→new)          keeps the old base priced under the new one
 *   · new→quote = (old→quote)/(old→new)  cancels the old base out of every cross
 * The rebased rows are written as-of today with source 'rebase', is_override=true
 * so they win in the resolver immediately and are visibly distinct from a feed.
 *
 * DATED HISTORY IS NOT REWRITTEN. Old base→quote rows stay exactly as they are —
 * posted transactions already stamp their own fx_rate at posting time, so no
 * historical amount is reinterpreted. The rebase only sets the new CURRENT rate.
 *
 * A rebase requires a known old→new rate; without one there is no meaningful
 * anchor and we refuse (NO_REBASE_RATE) rather than silently leave the new base
 * unpriced. Flipping to the very first base (no prior base) is a plain flip.
 *
 * The whole thing runs in one transaction so a partial rebase can never leave
 * two bases or a half-written cross table.
 */
async function setBase(client, code, actor = {}) {
  const existing = await repo.getCurrency(client, code);
  if (!existing) throw new AppError("NOT_FOUND", "Currency not found", 404);
  if (existing.is_base) return { base: code, changed: [], rebased: [], skipped: "already-base" };

  const oldBase = await repo.getBaseCode(client);
  const asOf = today();

  return atomically(client, async () => {
    const rebased = [];
    // Only rebase when there IS an old base to rebase FROM. The first-ever base
    // (oldBase === null) has no cross table to convert.
    if (oldBase && oldBase !== code) {
      const rows = await repo.latestRatesFromBase(client, oldBase);
      const { pairs, missing } = rebaseRates(rows, oldBase, code);
      if (missing) {
        throw new AppError(
          "NO_REBASE_RATE",
          `Cannot rebase onto ${code}: there is no current ${oldBase}→${code} rate to anchor the conversion. Sync or set that rate first, then change the base.`,
          422,
        );
      }
      for (const p of pairs) {
        const row = await repo.upsertRate(client, {
          base: code,
          quote: p.quote,
          rate: p.rate,
          asOfDate: asOf,
          source: "rebase",
          isOverride: true,
        });
        rebased.push({ quote: p.quote, rate: Number(row.rate) });
      }
    }

    const changed = await repo.setBase(client, code);
    await emitEvent(client, { eventTypeKey: events.BASE_SET, moduleKey: events.MODULE, entityRef: "currency:" + code, actorUserId: actor.user_id || null, payload: { from: oldBase, to: code, rebased: rebased.length } });
    if (rebased.length) {
      await emitEvent(client, { eventTypeKey: events.BASE_REBASED, moduleKey: events.MODULE, entityRef: "currency:" + code, actorUserId: actor.user_id || null, payload: { from: oldBase, to: code, pairs: rebased.length } });
    }
    await audit(client, { actorUserId: actor.user_id || null, action: events.BASE_SET, moduleKey: events.MODULE, entityRef: "currency:" + code, before: { base: oldBase }, after: { base: code, rebased } });
    return { base: code, previous_base: oldBase, changed, rebased };
  });
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
  rateMap,
  setRate,
  syncNow,
  listCurrencies,
  listCurrenciesRich,
  listRates,
  rateHistoryPage,
  syncStatus,
  dossier,
  addCurrency,
  editCurrency,
  setBase,
  removeCurrency,
};
