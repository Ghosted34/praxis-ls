/**
 * Asset management (MOD-54) — acquisition → depreciation → disposal (KB §11).
 * On create, the full monthly depreciation schedule is generated (asset.rules).
 * `depreciate(period)` posts one period's dotation to the ledger; `dispose` marks
 * the asset out and recognises gain/loss. Schedule maths are pure + verified; GL
 * posting is STRICT: a GL rejection fails the call rather than recording the
 * period as posted without an entry (audit DATA 5.5). Method surface matches
 * the controller.
 */
"use strict";
const repo = require("./asset.repo");
const events = require("./asset.events");
const { buildSchedule, scheduleTotal } = require("./asset.rules");
const journal = require("../journal_entry/journal_entry.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");

const ref = (id) => "asset:" + id;
const round = (n) => Math.round(Number(n) * 100) / 100;

async function create(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    const asset = await repo.insert(client, { ...data, status: "ACTIVE" });
    const rows = buildSchedule(asset);
    for (const r of rows) {
      await repo.insertScheduleRow(client, { asset_id: asset.asset_id, period_code: r.period_code, amount: r.amount, posted: false });
    }
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(asset.asset_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(asset.asset_id), after: asset });
    await client.query("COMMIT");
    return { ...asset, schedule_periods: rows.length, depreciable_base: scheduleTotal(rows) };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function get(client, id) {
  const asset = await repo.findById(client, id);
  if (!asset) return null;
  const schedule = await repo.listSchedule(client, id);
  const accumulated = await repo.accumulatedPosted(client, id);
  const nbv = round(Number(asset.acquisition_cost) - accumulated);
  return { ...asset, schedule, accumulated_depreciation: accumulated, net_book_value: nbv };
}

const list = (client, q) => repo.list(client, q);

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.findById(client, id);
  if (!before) return null;
  const row = await repo.update(client, id, patch);
  await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/** Post one period's depreciation. Debit 6813 (dotation), credit the asset's
 *  accumulated-depreciation account (coa_depr_code). Idempotent per period. */
async function depreciate(client, { id, period_code, actor = {} }) {
  const asset = await repo.findById(client, id);
  if (!asset) throw new AppError("NOT_FOUND", "Asset not found", 404);
  if (asset.status !== "ACTIVE") throw new AppError("ASSET_DISPOSED", "Asset is disposed", 422);
  const row = await repo.scheduleRow(client, id, period_code);
  if (!row) throw new AppError("NO_SCHEDULE", `No depreciation scheduled for ${period_code}`, 422);
  if (row.posted) return { already_posted: true, depreciation: row };

  // ---------------------------------------------------------------------
  // Audit DATA 5.5 (Critical) — this never reached the general ledger.
  //
  // Two defects compounded:
  //
  //   1. The lines used `account:`. buildAndInsert reads `ln.account_code`
  //      (journal_entry.service.js:69). It also requires `sourceDocRef` when
  //      validating (:42, SOURCE_DOC_REQUIRED), and none was passed — so the
  //      call threw before it ever looked at the account.
  //   2. `catch (err) { entryId = null }` swallowed that, and markPosted then
  //      set posted = true with entry_id NULL.
  //
  // Net effect: depreciation never posted, on any asset, ever — and was
  // recorded as posted. `accumulatedPosted()` sums `WHERE posted = true`, so
  // the fixed-asset register reported accumulated depreciation and a net book
  // value that the trial balance did not contain. `dispose()` then computed
  // gain/loss from that same phantom figure.
  //
  // This is the IDENTICAL bug that was found and fixed in payroll — the fix is
  // documented in a comment at payroll.service.js:149-151 — and was never
  // applied here. A sweep of the codebase on 2026-08-04 found these two the
  // only occurrences of either pattern.
  //
  // The swallow is gone. A ledger rejection is a closed period, an unbalanced
  // entry or a non-postable account: all things an accountant must be told
  // about. Recording "posted" for an entry that does not exist is the worse
  // outcome by a wide margin, and it is what made this invisible for so long.
  // ---------------------------------------------------------------------
  let entryId = null;
  try {
    const entry = await journal.post(client, {
      entityId: asset.entity_id,
      entryDate: lastDayOf(period_code),
      journalCode: "OD",
      description: `Depreciation ${asset.label} ${period_code}`,
      sourceDocRef: ref(id),
      source: "SYSTEM_AUTO",
      lines: [
        { account_code: "6813", debit: round(row.amount), credit: 0, label: "Dotation aux amortissements" },
        { account_code: asset.coa_depr_code || "2845", debit: 0, credit: round(row.amount), label: "Amortissements cumulés" },
      ],
      actor,
    });
    entryId = entry ? entry.entry_id || entry.entryId || null : null;
  } catch (err) {
    logger.error(
      { err, asset_id: id, period_code, amount: row.amount },
      "asset depreciation could not be posted to the GL — NOT marking it posted",
    );
    throw new AppError(
      "GL_POST_FAILED",
      `Depreciation for ${period_code} could not be posted to the general ledger: ${err.message}`,
      422,
    );
  }

  if (!entryId) {
    // Defensive: journal.post resolved without giving back an id. Marking this
    // posted would recreate the exact divergence above.
    throw new AppError(
      "GL_POST_FAILED",
      `Depreciation for ${period_code} returned no journal entry id; refusing to mark it posted.`,
      500,
    );
  }

  const updated = await repo.markPosted(client, row.depreciation_id, entryId);
  await emitEvent(client, { eventTypeKey: events.DEPRECIATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null, payload: { period_code, amount: row.amount, posted_to_gl: Boolean(entryId) } });
  await audit(client, { actorUserId: actor.user_id || null, action: events.DEPRECIATED, moduleKey: events.MODULE, entityRef: ref(id), after: updated });
  return { depreciation: updated, posted_to_gl: Boolean(entryId) };
}

/** Dispose an asset: mark DISPOSED and report the gain/loss vs net book value. */
async function dispose(client, { id, disposed_on, proceeds = 0, actor = {} }) {
  const asset = await repo.findById(client, id);
  if (!asset) throw new AppError("NOT_FOUND", "Asset not found", 404);
  if (asset.status === "DISPOSED") throw new AppError("ALREADY_DISPOSED", "Asset already disposed", 422);
  const accumulated = await repo.accumulatedPosted(client, id);
  const nbv = round(Number(asset.acquisition_cost) - accumulated);
  const gainLoss = round(Number(proceeds) - nbv); // + gain, − loss
  const row = await repo.update(client, id, { status: "DISPOSED", disposed_on: disposed_on || new Date().toISOString().slice(0, 10) });
  await emitEvent(client, { eventTypeKey: events.DISPOSED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null, payload: { nbv, proceeds: round(proceeds), gain_loss: gainLoss } });
  await audit(client, { actorUserId: actor.user_id || null, action: events.DISPOSED, moduleKey: events.MODULE, entityRef: ref(id), before: asset, after: row });
  return { asset: row, net_book_value: nbv, proceeds: round(proceeds), gain_loss: gainLoss };
}

function lastDayOf(periodCode) {
  const [y, m] = String(periodCode).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

module.exports = { create, get, list, update, depreciate, dispose };
