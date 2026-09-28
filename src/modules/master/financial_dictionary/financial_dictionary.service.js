"use strict";
const repo = require("./financial_dictionary.repo");
const events = require("./financial_dictionary.events");
const rules = require("./financial_dictionary.rules");
const importer = require("./financial_dictionary.import");
const { resolveContext } = require("../../../services/spreadsheet");
const { emitEvent, audit } = require("../../../shared/events/emit");
const currencyRepo = require("../currency/currency.repo");
const { page } = require("../../../shared/db/query-helpers");

// The only columns a caller may write on dictionary_item. `code`, ids and the
// timestamps are server-owned; picking an explicit set (never spreading the
// whole row) is what keeps update from rewriting created_at or the PK.
//
// `default_price` is NOT here. Since 14120 an item's price is its standard
// expense rate (expense_rate/standard-rate.sql.js); `create` turns a price in
// the payload into that rate, and nothing writes the retired column again.
const ITEM_COLS = [
  "label_fr", "label_en", "description", "category", "direction", "subcategory",
  "unit_of_measure", "applicability_mode", "is_disbursement", "is_billable",
  "currency", "shipping_line", "provider_kind", "proof_source",
  "requires_justification", "receipt_requirement", "disbursement_vat_transparent",
  "pricing_mode", "is_active", "service_type_key", "client_heading_ref_id",
];

const listItems = (c, q) => repo.listItems(c, q);
// The shared finder. Thin on purpose — the ranking is the query's job (repo),
// and every caller across costing/quotation/cash-request wants the same shape.
const searchItems = (c, q) => repo.searchItems(c, q);

async function get(c, id) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  item.posting_rules = await repo.listRules(c, id);
  item.service_tiers = await repo.listTiers(c, id);
  return item;
}

/** Item + rules + tiers + usage + a compliance summary — the 360 payload. */
async function dossier(c, id) {
  const item = await get(c, id);
  if (!item) return null;
  const usage = await repo.usageCounts(c, id);
  const compliance = {
    requires_justification: !!item.requires_justification,
    receipt_requirement: item.receipt_requirement,
    proof_source: item.proof_source || null,
    is_disbursement: !!item.is_disbursement,
    disbursement_vat_transparent: !!item.disbursement_vat_transparent,
    // A billable item that always needs a receipt but names no valid source is
    // the onboarding gap the 360 should surface (not a hard failure).
    needs_attention: rules.needsAttention(item),
  };
  return { item, posting_rules: item.posting_rules, service_tiers: item.service_tiers, usage, compliance };
}

/**
 * One page of the rows behind one of the 360's usage tiles — the drill-in the
 * tile opens. `{ rows, total }`, or null when the item does not exist.
 *
 * `invoiceTypes` narrows the invoices drill to the kinds the viewer may open
 * (the controller resolves it from their grants); the other kinds are gated
 * whole, before this is called.
 */
async function listUsage(c, id, kind, q = {}, { invoiceTypes = [] } = {}) {
  const item = await repo.getItemRow(c, id);
  if (!item) return null;
  const out = await repo.usageRows(c, id, kind, q, { invoiceTypes });
  if (kind !== "rates") return out;
  // In force / superseded by the SAME rule the Cost & evolution tab uses.
  return {
    ...out,
    rows: out.rows.map((r) => ({ ...r, rate: Number(r.rate), ...rules.rateState(r) })),
  };
}

function pickItem(src) {
  const out = {};
  for (const k of ITEM_COLS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

// A débours line always carries the débours flag; the code letter follows the
// direction — one source of truth for both (financial_dictionary.rules).
function normalise(data) {
  const direction = data.direction || "EXPENSE";
  const itemData = pickItem(data);
  itemData.direction = direction;
  itemData.is_disbursement = rules.resolveDisbursement(direction, data.is_disbursement);
  // Title Case on every save, so the catalogue stays the way 90995 left it.
  if (itemData.label_fr !== undefined) itemData.label_fr = rules.titleCase(itemData.label_fr, "fr");
  if (itemData.label_en !== undefined) itemData.label_en = rules.titleCase(itemData.label_en, "en");
  return { itemData, posting_rules: data.posting_rules || [], service_tiers: data.service_tiers || [] };
}

function withCreateDefaults(item) {
  return {
    applicability_mode: "ANY_OPERATIONS",
    receipt_requirement: "NOT_REQUIRED",
    currency: "XAF",
    is_billable: true,
    is_active: true,
    requires_justification: false,
    disbursement_vat_transparent: true,
    pricing_mode: "FLAT",
    ...item,
  };
}

// Keep the legacy single-value service_type_key in step with the tiers so the
// Service-Type 360 (which still reads the column) stays correct until PR2 cuts
// it over to the join.
const primaryServiceKey = rules.primaryServiceKey;

function ruleRow(r, itemId, itemDisbursement) {
  return {
    dictionary_item_id: itemId,
    applies_context: r.applies_context,
    debit_account: r.debit_account || null,
    credit_account: r.credit_account || null,
    tax_code_id: r.tax_code_id || null,
    is_disbursement: r.is_disbursement ?? itemDisbursement,
  };
}

const isUniqueViolation = (err) => err && err.code === "23505";

/**
 * `client_heading_ref_id` is a plain uuid (14130 — no FK on an existing table,
 * the 13791 rule), so the rule the FK would have enforced lives here: it must
 * name an ACTIVE row of the CLIENT_HEADING registry, or be empty.
 */
async function assertClientHeading(c, refId) {
  if (refId === undefined || refId === null) return;
  const { rows } = await c.query(
    "SELECT 1 FROM dictionary_ref WHERE ref_id = $1 AND kind = 'CLIENT_HEADING' AND is_active = true",
    [refId],
  );
  if (!rows[0]) { const e = new Error("client_heading_ref_id must be an active client heading"); e.status = 422; throw e; }
}

/** The tenant's base currency — what a rate is in unless someone says otherwise. */
async function baseCurrency(c) {
  return (await currencyRepo.getBaseCode(c)) || "XAF";
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** A date as a PERSON reads it here — day-first — for messages shown on screen.
 *  pg hands back a `date` column as a Date at UTC midnight. */
function dayFirst(v) {
  const iso = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/**
 * Open (or supersede) ONE rate series inside the caller's transaction.
 *
 * The core of `supersedeRate`, lifted out so the create wizard's price and
 * "apply to all carriers" write through exactly the same expire-then-insert
 * discipline — without each opening a transaction of its own inside another.
 * Returns { before, row }.
 */
async function openRateSeries(c, item, data) {
  const key = {
    rateProviderId: data.rate_provider_id || null,
    containerTypeRefId: data.container_type_ref_id || null,
  };
  // provider_kind is a denormalised cache of rate_provider.kind (repo.js has
  // no join for a single lookup, so this is the one place it is read fresh).
  let providerKind = null;
  if (key.rateProviderId) {
    const { rows } = await c.query("SELECT kind FROM rate_provider WHERE rate_provider_id = $1", [key.rateProviderId]);
    if (!rows[0]) { const e = new Error("rate provider not found"); e.status = 404; throw e; }
    providerKind = rows[0].kind;
  }
  const effectiveFrom = data.effective_from || todayIso();
  const current = await repo.openRate(c, item.dictionary_item_id, key);
  if (current) {
    if (Date.parse(current.effective_from) >= Date.parse(effectiveFrom)) {
      const e = new Error(`the current rate already starts on ${dayFirst(current.effective_from)}; a new rate must start after that day`);
      e.status = 422;
      throw e;
    }
    await repo.expireRate(c, current.expense_rate_id, rules.dayBefore(effectiveFrom));
  }
  const row = await repo.insertRate(c, {
    dictionary_item_id: item.dictionary_item_id,
    rate_provider_id: key.rateProviderId,
    container_type_ref_id: key.containerTypeRefId,
    provider_kind: providerKind,
    rate: data.rate,
    // The BASE currency, not the item's: a rate is in the tenant's own money
    // unless someone deliberately picks another (meeting 5, 01:11:19).
    currency: data.currency || (await baseCurrency(c)),
    effective_from: effectiveFrom,
    effective_to: data.effective_to || null,
    note: data.note || null,
  });
  return { before: current || null, row };
}

async function create(c, { data, actor }) {
  const { itemData, posting_rules, service_tiers } = normalise(data);
  // The wizard's "Default price" step: kept on the payload for the form's sake,
  // stored as the item's STANDARD expense rate (no carrier, no container type),
  // opening today, in the same transaction as the item.
  const price = data.default_price === null || data.default_price === undefined ? null : Number(data.default_price);
  await assertClientHeading(c, itemData.client_heading_ref_id);
  if (posting_rules.length === 0) { const e = new Error("a dictionary item requires at least one posting rule (KB §4)"); e.status = 422; throw e; }
  const base = withCreateDefaults(itemData);

  // Retry the whole transaction on the (rare) code collision — two creates for
  // the same direction can mint the same serial before either commits.
  for (let attempt = 0; attempt < 6; attempt++) {
    await c.query("BEGIN");
    try {
      const row = { ...base, code: await repo.nextCode(c, base.direction), service_type_key: primaryServiceKey(service_tiers) };
      const item = await repo.createItem(c, row);
      for (const r of posting_rules) await repo.createRule(c, ruleRow(r, item.dictionary_item_id, item.is_disbursement));
      if (service_tiers.length) await repo.replaceTiers(c, item.dictionary_item_id, service_tiers);
      if (price !== null) {
        const { row: rate } = await openRateSeries(c, item, { rate: price, currency: data.currency || null });
        await audit(c, { actorUserId: actor.user_id, action: events.RATE_SUPERSEDED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, before: null, after: rate });
      }
      await c.query("COMMIT");
      await emitEvent(c, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, actorUserId: actor.user_id });
      await audit(c, { actorUserId: actor.user_id, action: events.CREATED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, after: item });
      return get(c, item.dictionary_item_id);
    } catch (err) {
      await c.query("ROLLBACK");
      if (isUniqueViolation(err) && attempt < 5) continue; // remint and retry
      throw err;
    }
  }
  const e = new Error("could not allocate a unique code, please retry"); e.status = 409; throw e;
}

async function update(c, { id, patch, actor }) {
  const before = await repo.getItemRow(c, id);
  if (!before) return null;
  const merged = { ...before, ...patch };
  const { itemData, posting_rules, service_tiers } = normalise(merged);
  const rulesSent = Array.isArray(patch.posting_rules);
  const tiersSent = Array.isArray(patch.service_tiers);
  if (rulesSent && posting_rules.length === 0) { const e = new Error("a dictionary item requires at least one posting rule (KB §4)"); e.status = 422; throw e; }
  if (tiersSent) itemData.service_type_key = primaryServiceKey(service_tiers);

  // A direction change moves the item to the new letter's next free number and
  // frees the old one (meeting 5, 01:20:04). Before this, "Documentation fee"
  // moved from revenue to disbursement and kept its #R code — the letter and
  // the accounting said two different things.
  const recoded = itemData.direction && itemData.direction !== before.direction;
  if (patch.client_heading_ref_id !== undefined) await assertClientHeading(c, patch.client_heading_ref_id);

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await updateOnce(c, { id, before, itemData, posting_rules, service_tiers, rulesSent, tiersSent, recoded, actor });
    } catch (err) {
      // Two items re-lettered at once can mint the same serial; remint.
      if (recoded && isUniqueViolation(err) && attempt < 5) continue;
      throw err;
    }
  }
  const e = new Error("could not allocate a unique code, please retry"); e.status = 409; throw e;
}

async function updateOnce(c, { id, before, itemData, posting_rules, service_tiers, rulesSent, tiersSent, recoded, actor }) {
  await c.query("BEGIN");
  try {
    if (recoded) itemData.code = await repo.nextCode(c, itemData.direction);
    const row = await repo.updateItem(c, id, itemData);
    if (recoded) {
      await audit(c, {
        actorUserId: actor.user_id, action: events.RECODED, moduleKey: events.MODULE,
        entityRef: `dict:${row.code}`,
        before: { code: before.code, direction: before.direction },
        after: { code: row.code, direction: row.direction },
      });
    }
    if (rulesSent) {
      await repo.deleteRules(c, id);
      for (const r of posting_rules) await repo.createRule(c, ruleRow(r, id, row ? row.is_disbursement : before.is_disbursement));
    }
    if (tiersSent) await repo.replaceTiers(c, id, service_tiers);
    await emitEvent(c, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: `dict:${row.code}`, actorUserId: actor.user_id });
    await audit(c, { actorUserId: actor.user_id, action: events.UPDATED, moduleKey: events.MODULE, entityRef: `dict:${row.code}`, before, after: row });
    await c.query("COMMIT");
    return get(c, id);
  } catch (err) { await c.query("ROLLBACK"); throw err; }
}

/* ═══════════════════ SPEND OVER A PERIOD (PR2 workstream 1) ═══════════════ */

/**
 * What this line cost us between two dates, through three lenses.
 *
 * The lenses are not three approximations of one number — they are three
 * different questions, and a dossier that showed only one would answer the
 * wrong one for two of its readers:
 *
 *   estimated   what a costing sheet SAID it would cost (the planner's number)
 *   committed   what has been promised to a third party — an open PO, an
 *               approved cash request (the treasurer's number)
 *   actual      what the ledger records as posted (the accountant's number)
 *
 * The HEADLINE is actual, because that is the only one that has happened. The
 * gap between committed and actual is the useful signal: money promised and not
 * yet posted is either work in flight or a document someone forgot to close.
 */
async function spend(c, id, q = {}) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  const period = rules.normalisePeriod({ from: q.from, to: q.to });
  const months = rules.monthKeys(period.from, period.to);
  // Sequential, NOT Promise.all. `req.tenantDb` hands every call in a request
  // the SAME pinned pooled client (middleware/tenant-context.js), and pg
  // serialises concurrent queries on one client through its internal queue —
  // so a Promise.all here would buy no parallelism at all while breaking the
  // invariant that file documents ("nothing runs req.tenantDb calls
  // concurrently"). Three awaits are three round trips either way.
  // Optionally one operations file only (meeting 5, 01:23:15 — "filter per
  // file, so you see everything spent on that file").
  const dossierId = q.dossier_id || null;
  const estimated = await repo.spendEstimated(c, id, period.from, period.to, dossierId);
  const committed = await repo.spendCommitted(c, id, period.from, period.to, dossierId);
  const actual = await repo.spendActual(c, id, period.from, period.to, dossierId);
  const series = rules.spendSeries(months, { estimated, committed, actual });
  const documents = q.include_documents === false ? [] : await repo.spendDocuments(c, id, period.from, period.to, 100, dossierId);
  return {
    item: { dictionary_item_id: item.dictionary_item_id, code: item.code, label_fr: item.label_fr, label_en: item.label_en, currency: item.currency || "XAF", direction: item.direction },
    period,
    dossier_id: dossierId,
    months: series.months,
    totals: series.totals,
    documents,
  };
}

/**
 * One page of the documents behind the Spend tab's tiles, and the true total.
 *
 * The window goes through the SAME `normalisePeriod` as `spend`, so a drill-in
 * opened from a tile lists the period that tile summed — a reversed or garbage
 * range is corrected the same way for both. `lens` NULL is every lens.
 */
async function spendDocumentsPage(c, id, q = {}) {
  const item = await repo.getItemRow(c, id);
  if (!item) return null;
  const period = rules.normalisePeriod({ from: q.from, to: q.to });
  const { limit, offset } = page(q);
  return repo.spendDocumentsPage(c, id, period.from, period.to, {
    lens: q.lens || null,
    dossierId: q.dossier_id || null,
    limit,
    offset,
  });
}

/* ═══════════════════ COST EVOLUTION (PR2 workstream 2) ════════════════════ */

/**
 * The effective-dated rate history behind an item, plus its trend.
 *
 * Grouped into SERIES — one per (provider, shipping line, variant) — because a
 * single item genuinely has several concurrent rates (a 20ft and a 40ft
 * container price are both current, and neither supersedes the other), and a
 * timeline that interleaved them would render a sawtooth that means nothing.
 */
async function rateEvolution(c, id, q = {}) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  const timeline = rules.rateTimeline(await repo.rateHistory(c, id), q.as_of || null);
  const groups = new Map();
  for (const r of timeline) {
    const key = [r.rate_provider_id || "", r.container_type_ref_id || ""].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        rate_provider_id: r.rate_provider_id || null,
        provider_kind: r.provider_kind_resolved || r.provider_kind || null,
        provider_name: r.provider_name || null,
        container_type_ref_id: r.container_type_ref_id || null,
        container_type_code: r.container_type_code || null,
        container_type_name: r.container_type_name || null,
        currency: r.currency || item.currency || "XAF",
        points: [],
      });
    }
    groups.get(key).points.push(r);
  }
  const series = [...groups.values()].map((g) => ({
    ...g,
    current: g.points.find((p) => p.in_force) || null,
    trend: rules.rateTrend(g.points),
  }));
  return {
    item: { dictionary_item_id: item.dictionary_item_id, code: item.code, label_fr: item.label_fr, label_en: item.label_en, currency: item.currency || "XAF", provider_kind: item.provider_kind || null },
    series,
    // Overall movement across every point, for the headline pill.
    trend: rules.rateTrend(timeline),
  };
}

/**
 * Amend a rate the ONLY way an effective-dated series may be amended: expire the
 * open row the day before the new one opens, and insert the new one — never
 * edit history in place.
 *
 * This is the tax-jurisdiction discipline (tax_jurisdiction.service.supersedeCode)
 * applied to expense_rate, and it is copied deliberately rather than
 * generalised: the two tables have different keys, and the shared thing worth
 * keeping identical is the TRANSACTION BOUNDARY. Expiring the old row in one
 * transaction and inserting the new one in another leaves a window with no
 * effective rate — which for tax codes meant every invoice from that date
 * failed to post until someone noticed by hand. Expire and replace are one unit
 * here for exactly the same reason.
 */
async function supersedeRate(c, { id, data, actor }) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  await c.query("BEGIN");
  try {
    const { before, row } = await openRateSeries(c, item, data);
    await emitEvent(c, { eventTypeKey: events.RATE_SUPERSEDED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, actorUserId: actor.user_id || null });
    await audit(c, { actorUserId: actor.user_id || null, action: events.RATE_SUPERSEDED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, before, after: row });
    await c.query("COMMIT");
    return rateEvolution(c, id);
  } catch (err) { await c.query("ROLLBACK"); throw err; }
}

/**
 * One rate, written for many carriers at once (meeting 5, 01:07:48).
 *
 * Documentation fees and most shipping-line charges are near-identical across
 * lines, and setting MSC, Maersk, CMA CGM… one cell at a time is how a tariff
 * change gets half-applied. The screen offers every active carrier of the tab's
 * kind, all ticked, and the person unticks the exceptions; the ids that arrive
 * here are the ones left ticked.
 *
 * ALL OR NOTHING. Each carrier's series is superseded with the same expire-
 * then-insert as a single cell, inside ONE transaction: a rate that applied to
 * four lines of six because the fifth already had a later-dated rate is worse
 * than a clear refusal naming the carrier that blocked it.
 */
async function applyRateToProviders(c, { id, data, actor }) {
  const item = await repo.getItem(c, id);
  if (!item) return null;
  const ids = [...new Set(data.rate_provider_ids || [])];
  if (!ids.length) { const e = new Error("tick at least one carrier"); e.status = 422; throw e; }
  const { rows: providers } = await c.query(
    "SELECT rate_provider_id, name FROM rate_provider WHERE rate_provider_id = ANY($1::uuid[])",
    [ids],
  );
  if (providers.length !== ids.length) { const e = new Error("one or more carriers were not found"); e.status = 404; throw e; }
  const nameOf = new Map(providers.map((p) => [p.rate_provider_id, p.name]));
  await c.query("BEGIN");
  try {
    const written = [];
    for (const providerId of ids) {
      try {
        const { before, row } = await openRateSeries(c, item, { ...data, rate_provider_id: providerId });
        await audit(c, { actorUserId: actor.user_id || null, action: events.RATE_SUPERSEDED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, before, after: row });
        written.push(row);
      } catch (err) {
        if (err.status === 422) err.message = `${nameOf.get(providerId)}: ${err.message}`;
        throw err;
      }
    }
    await emitEvent(c, { eventTypeKey: events.RATE_SUPERSEDED, moduleKey: events.MODULE, entityRef: `dict:${item.code}`, actorUserId: actor.user_id || null });
    await c.query("COMMIT");
    return { applied: written.length, evolution: await rateEvolution(c, id) };
  } catch (err) { await c.query("ROLLBACK"); throw err; }
}

/* ═══════════════════ BULK EXCEL IMPORT (PR2 workstream 3) ═════════════════ */

/** Everything a row is validated against, read once per upload, not per row. */
async function importContext(c) {
  // Sequential for the same reason as spend() above: one pinned client, pg
  // serialises regardless. Six round trips ONCE per upload, not per row —
  // which is the optimisation that actually matters here (a 500-row sheet
  // validated row-by-row would be 1500 lookups against three small tables).
  const accounts = await repo.postableAccounts(c);
  const taxCodes = await repo.taxCodeIndex(c);
  const serviceTypes = await repo.serviceTypeIndex(c);
  const subcategories = await repo.listRefs(c, "SUBCATEGORY");
  const units = await repo.listRefs(c, "UNIT");
  const proofSources = await repo.listRefs(c, "PROOF_SOURCE");
  return {
    accounts, taxCodes, serviceTypes,
    refs: { SUBCATEGORY: subcategories, UNIT: units, PROOF_SOURCE: proofSources },
    // The lookup shapes rules.validateImportRow wants.
    lookups: {
      accounts: new Set(accounts.map((a) => String(a.code))),
      taxCodes: new Map(taxCodes.map((t) => [String(t.code), t.tax_code_id])),
      serviceTypes: new Map(serviceTypes.map((s) => [String(s.key), s.service_type_id])),
    },
  };
}

/** The .xlsx a user downloads: enum dropdowns + this tenant's real references.
 *  Branded via resolveContext on the caller's connection. */
async function importTemplate(c) {
  const [ctx, context] = await Promise.all([
    importContext(c),
    resolveContext(c, { title: "Financial dictionary — import template" }),
  ]);
  return importer.buildTemplate({ accounts: ctx.accounts, taxCodes: ctx.taxCodes, serviceTypes: ctx.serviceTypes, refs: ctx.refs, context });
}

/**
 * Parse + validate an upload. Writes NOTHING.
 *
 * A separate step from commit on purpose: the user sees exactly what will be
 * created, and what will not and why, BEFORE anything is minted. An importer
 * that validates and commits in one call has to choose between all-or-nothing
 * (400 good rows lost to one typo) and silent partial success (rows created
 * that the user never saw); showing the staging table first makes that a
 * decision rather than a policy.
 */
async function importValidate(c, { buffer }) {
  const parsed = await importer.parseUpload(buffer);
  const ctx = await importContext(c);
  const { valid, rejected } = rules.partitionImport(parsed.rows, ctx.lookups);
  return {
    sheet: parsed.sheet,
    parsed: parsed.rows.length,
    valid,
    rejected,
    summary: { total: parsed.rows.length, valid: valid.length, rejected: rejected.length },
  };
}

/**
 * Commit the valid rows. PARTIAL by design.
 *
 * Re-validates server-side rather than trusting the staging payload: the client
 * round-trip is a convenience, not a security boundary, and the tenant's
 * accounts could have changed between validate and commit.
 *
 * Each row is its own transaction — NOT one transaction for the batch. A
 * 400-row import that rolls back entirely because row 397 hit a code collision
 * is the failure mode partial commit exists to avoid, and the rows are
 * independent (an item is complete on its own). A row that fails at insert
 * joins `rejected` with the database's own reason and the user re-uploads the
 * error file.
 */
async function importCommit(c, { rows = [], actor }) {
  const ctx = await importContext(c);
  const created = [];
  const rejected = [];
  for (const entry of rows) {
    const rowNumber = entry.row || null;
    const check = rules.validateImportRow(entry.raw || entry.data || {}, ctx.lookups);
    if (!check.valid) { rejected.push({ row: rowNumber, reasons: check.reasons, raw: entry.raw || entry.data || {} }); continue; }
    try {
       
      const item = await create(c, { data: check.data, actor });
      created.push({ row: rowNumber, dictionary_item_id: item.dictionary_item_id, code: item.code, label_fr: item.label_fr });
    } catch (err) {
      rejected.push({ row: rowNumber, reasons: [err.message || "could not be created"], raw: entry.raw || entry.data || {} });
    }
  }
  const summary = { attempted: rows.length, created: created.length, rejected: rejected.length };
  if (created.length) {
    // One event and one audit row for the BATCH, not per item — `create()` has
    // already emitted dictionary_item.created for each. A 400-row import that
    // also emitted 400 batch events would drown the feed it is meant to inform.
    await emitEvent(c, { eventTypeKey: events.IMPORTED, moduleKey: events.MODULE, entityRef: "dict:import", actorUserId: actor.user_id || null });
    await audit(c, { actorUserId: actor.user_id || null, action: events.IMPORTED, moduleKey: events.MODULE, entityRef: "dict:import", after: { ...summary, codes: created.map((r) => r.code) } });
  }
  return { created, rejected, summary };
}

/** The rejected rows as an .xlsx the user fixes and re-uploads. Branded like
 *  the template it answers, so the fix-and-reupload loop stays one product. */
async function importErrorFile(c, rejected) {
  const context = await resolveContext(c, { title: "Financial dictionary — rejected rows" });
  return importer.buildErrorFile(rejected, context);
}

/* ── dictionary_ref registry (dropdown values, gear-modal editable) ─────────── */
const listRefs = (c, kind, includeInactive) => repo.listRefs(c, kind, includeInactive);

async function createRef(c, { data, actor }) {
  const row = await repo.createRef(c, { ...data, code: String(data.code).toUpperCase() });
  await audit(c, { actorUserId: actor.user_id, action: "dictionary_ref.created", moduleKey: events.MODULE, entityRef: `ref:${row.kind}:${row.code}`, after: row });
  return row;
}
async function updateRef(c, { id, patch, actor }) {
  const before = await repo.getRef(c, id);
  if (!before) return null;
  if (before.is_system && (patch.code || patch.kind)) { const e = new Error("a system reference's code/kind cannot be changed"); e.status = 422; throw e; }
  // The create path refuses a container type with no TEU or no size (they are
  // read as numbers by the TEU totals and as the rate-card key respectively, and
  // both fail silently when absent). A patch must not be the way back in.
  if (before.kind === "CONTAINER_TYPE" && patch.extra !== undefined) {
    const teu = patch.extra?.teu;
    if (typeof teu !== "number" || !(teu > 0)) { const e = new Error("TEU is required for a container type and must be greater than 0"); e.status = 422; throw e; }
    if (!patch.extra?.size) { const e = new Error("size is required for a container type (the rate-lookup key)"); e.status = 422; throw e; }
  }
  const row = await repo.updateRef(c, id, patch);
  await audit(c, { actorUserId: actor.user_id, action: "dictionary_ref.updated", moduleKey: events.MODULE, entityRef: `ref:${before.kind}:${before.code}`, before, after: row });
  return row;
}

module.exports = {
  listItems, searchItems, get, dossier, listUsage, create, update,
  spend, spendDocumentsPage, rateEvolution, supersedeRate, applyRateToProviders,
  importTemplate, importValidate, importCommit, importErrorFile,
  listRefs, createRef, updateRef,
};
