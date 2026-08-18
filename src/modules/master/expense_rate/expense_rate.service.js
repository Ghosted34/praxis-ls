/**
 * Expense rate cards (MOD-10) — effective-dated tariff rows per dictionary
 * item, scoped by a rate provider (shipping line / airline / authority — NULL
 * means "the item's default") and a container type (NULL means "no equipment
 * dimension" — an authority fee per BL, an air rate priced by weight). The
 * resolver picks the most specific rate effective at a date, cascading down
 * to the carrier's general rate and then the plain default. SQL is in the repo.
 */
"use strict";

const repo = require("./expense_rate.repo");
const providerRepo = require("../rate_provider/rate_provider.repo");
const events = require("./expense_rate.events");
const rules = require("./expense_rate.rules");
const importer = require("./expense_rate.import");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "expense_rate:" + id;

/** provider_kind is a denormalised cache of rate_provider.kind, kept only so
 *  a rate row still reads as "an authority fee" without a join in the hot
 *  costing/simulation path — the FK is the source of truth. */
async function resolveProviderKind(client, rateProviderId) {
  if (!rateProviderId) return null;
  const p = await providerRepo.get(client, rateProviderId);
  if (!p) throw new AppError("NOT_FOUND", "Rate provider not found", 404);
  return p.kind;
}

async function create(client, { dictionaryItemId, rateProviderId = null, containerTypeRefId = null, rate, currency = "XAF", effectiveFrom = null, effectiveTo = null, note = null, actor = {} }) {
  if (!(Number(rate) >= 0)) throw new AppError("BAD_RATE", "rate must be >= 0", 422);
  const providerKind = await resolveProviderKind(client, rateProviderId);
  const row = await repo.insert(client, {
    dictionary_item_id: dictionaryItemId,
    rate_provider_id: rateProviderId,
    container_type_ref_id: containerTypeRefId,
    provider_kind: providerKind,
    rate, currency,
    effective_from: effectiveFrom || new Date().toISOString().slice(0, 10),
    effective_to: effectiveTo,
    note,
  });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.expense_rate_id), after: row });
  return row;
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Expense rate not found", 404);
  const fields = {};
  for (const k of ["rate_provider_id", "container_type_ref_id", "rate", "currency", "effective_from", "effective_to", "note"]) if (patch[k] !== undefined) fields[k] = patch[k];
  if (patch.rate_provider_id !== undefined) fields.provider_kind = await resolveProviderKind(client, patch.rate_provider_id);
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function remove(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Expense rate not found", 404);
  await repo.remove(client, id);
  await audit(client, { actorUserId: actor.user_id || null, action: events.DELETED, moduleKey: events.MODULE, entityRef: ref(id), before });
  return { deleted: true };
}

/** Resolve the effective rate for an item at a date (used by simulators/costing). */
async function resolve(client, { dictionaryItemId, date = null, rateProviderId = null, containerTypeRefId = null }) {
  const rows = await repo.forItem(client, dictionaryItemId);
  return rules.pickRate(rows, { date: date || new Date().toISOString().slice(0, 10), rateProviderId, containerTypeRefId });
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

// ── G7: bulk Excel import (meeting §11.3) ───────────────────────────────────

/** The registers the template's Reference sheet and the row resolution read. */
async function importContext(client) {
  const [dictionaryItems, rateProviders, containerTypes] = await Promise.all([
    repo.listDictionaryItems(client),
    repo.listProviders(client),
    repo.listContainerTypes(client),
  ]);
  return { dictionaryItems, rateProviders, containerTypes };
}

/** The .xlsx a user downloads: the column contract + this tenant's real values. */
async function importTemplate(client) {
  const ctx = await importContext(client);
  return importer.buildTemplate(ctx);
}

/** Parse + validate an upload. Writes NOTHING — staging first, like the dict
 *  importer, so the user sees exactly what will be created before commit. */
async function importValidate(client, { buffer }) {
  const parsed = await importer.parseUploaded(buffer);
  const ctx = await importContext(client);
  const { valid, rejected } = rules.partitionImport(parsed.rows, ctx);
  return {
    sheet: parsed.sheet,
    parsed: parsed.rows.length,
    valid,
    rejected,
    summary: { total: parsed.rows.length, valid: valid.length, rejected: rejected.length },
  };
}

/**
 * Commit the valid rows. PARTIAL by design — each row is its own create, so a
 * 400-row import never rolls back wholesale because one row fails. Rows are
 * RE-validated server-side from the raw cell values (the client round-trip is
 * a convenience, not a security boundary), and each insert goes through
 * repo.insert's WRITABLE allow-list.
 */
async function importCommit(client, { rows = [], actor }) {
  const ctx = await importContext(client);
  const created = [];
  const rejected = [];
  for (const entry of rows) {
    const rowNumber = entry.row || null;
    const check = rules.validateImportRow(entry.raw || {}, rules.buildLookups(ctx));
    if (!check.valid) {
      rejected.push({ row: rowNumber, reasons: check.reasons, raw: entry.raw || {} });
      continue;
    }
    try {
      const row = await create(client, { ...check.data, actor });
      created.push({ row: rowNumber, expense_rate_id: row.expense_rate_id, rate: row.rate, dictionary_item_id: row.dictionary_item_id });
    } catch (err) {
      rejected.push({ row: rowNumber, reasons: [err.message || "could not be created"], raw: entry.raw || {} });
    }
  }
  const summary = { attempted: rows.length, created: created.length, rejected: rejected.length };
  if (created.length) {
    await emitEvent(client, { eventTypeKey: events.IMPORTED, moduleKey: events.MODULE, entityRef: "expense_rate:import", actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.IMPORTED, moduleKey: events.MODULE, entityRef: "expense_rate:import", after: summary });
  }
  return { created, rejected, summary };
}

module.exports = { create, update, remove, resolve, get, list, importTemplate, importValidate, importCommit };
