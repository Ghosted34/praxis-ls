/** Expense rate card (MOD-10) — pure resolver. Given a set of effective-dated
 *  rows for one dictionary item, pick the rate effective at a date, optionally
 *  scoped by a rate provider (carrier/authority) and a container type — most
 *  specific match wins, cascading down to the carrier's general rate and then
 *  the item's default. */
"use strict";
const { AppError } = require("../../../utils/errors");

function within(row, date) {
  const from = row.effective_from ? Date.parse(row.effective_from) : -Infinity;
  const to = row.effective_to ? Date.parse(row.effective_to) : Infinity;
  const d = Date.parse(date);
  return d >= from && d <= to;
}

/**
 * Cascade: (provider + container type) → (provider, any type) →
 * (any provider, container type) → (the item's plain default). A row that
 * NAMES a provider/type only applies when the request matches it — it is
 * never a fallback for a different provider — which is what keeps a Maersk
 * 40ft rate from silently answering an MSC 20ft request.
 */
function pickRate(rows, { date, rateProviderId = null, containerTypeRefId = null }) {
  const eff = rows.filter((r) => within(r, date));
  // "No rate on file" is a not-found condition, not bad input: the caller
  // (costing) catches it and falls back to a free-typed rate. A 422 here would
  // route through the validation reporter and surface as
  // `ValidationError: NO_RATE: unknown` in the error centre — noise for a
  // condition the product treats as normal.
  if (eff.length === 0) throw new AppError("NO_RATE", "no expense rate effective at " + date, 404);
  const eligible = eff.filter((r) =>
    (!r.rate_provider_id || r.rate_provider_id === rateProviderId) &&
    (!r.container_type_ref_id || r.container_type_ref_id === containerTypeRefId));
  if (eligible.length === 0) throw new AppError("NO_RATE_MATCH", "no expense rate matches the given provider/container type", 404);
  const score = (r) => (r.rate_provider_id ? 2 : 0) + (r.container_type_ref_id ? 1 : 0);
  eligible.sort((a, b) => score(b) - score(a) || Date.parse(b.effective_from) - Date.parse(a.effective_from));
  return eligible[0];
}

/**
 * G7 — bulk Excel import contract (meeting §11.3: "an Excel template the
 * client fills, which we import"). The column list is the single contract for
 * the template, the parser and the error file — a column can never exist in
 * one and not the others.
 */
const IMPORT_COLUMNS = [
  { key: "dictionary_item", header: "Dictionary item (name or code)", width: 34, required: true },
  { key: "rate_provider", header: "Rate provider (name or code)", width: 26 },
  { key: "container_type", header: "Container type (code)", width: 18 },
  { key: "rate", header: "Rate", width: 12, required: true },
  { key: "currency", header: "Currency", width: 10 },
  { key: "effective_from", header: "Effective from (YYYY-MM-DD)", width: 24, required: true },
  { key: "effective_to", header: "Effective to (YYYY-MM-DD)", width: 22 },
  { key: "note", header: "Note", width: 30 },
];

/** Resolve human identifiers → ids. All lookups are case-insensitive. */
function buildLookups(ctx) {
  const byName = (rows) => {
    const m = new Map();
    for (const r of rows || []) {
      m.set(String(r.name || "").toLowerCase(), r);
      if (r.code) m.set(String(r.code).toLowerCase(), r);
    }
    return m;
  };
  const byItem = new Map();
  for (const r of ctx.dictionaryItems || []) {
    for (const k of [r.name_en, r.name_fr, r.code]) {
      if (k) byItem.set(String(k).toLowerCase(), r);
    }
  }
  return {
    dictionaryItems: byItem,
    providers: byName(ctx.rateProviders),
    containerTypes: byName(ctx.containerTypes),
  };
}

const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());

/**
 * Validate one raw row against the lookups. Returns { valid, reasons?, data? }.
 * `data` carries ONLY the WRITABLE columns, resolved to ids — never the raw
 * human text, which the insert allow-list would reject.
 */
function validateImportRow(raw = {}, lookups) {
  const reasons = [];
  const text = (v) => String(v ?? "").trim();

  const itemName = text(raw.dictionary_item);
  const item = itemName ? lookups.dictionaryItems.get(itemName.toLowerCase()) : null;
  if (!itemName) reasons.push("dictionary item is required");
  else if (!item) reasons.push(`unknown dictionary item "${itemName}"`);

  const providerName = text(raw.rate_provider);
  const provider = providerName ? lookups.providers.get(providerName.toLowerCase()) : null;
  if (providerName && !provider) reasons.push(`unknown rate provider "${providerName}"`);

  const typeName = text(raw.container_type);
  const container = typeName ? lookups.containerTypes.get(typeName.toLowerCase()) : null;
  if (typeName && !container) reasons.push(`unknown container type "${typeName}"`);

  const rate = Number(raw.rate);
  if (raw.rate === undefined || raw.rate === null || raw.rate === "") reasons.push("rate is required");
  else if (!Number.isFinite(rate) || rate < 0) reasons.push("rate must be a non-negative number");

  const from = text(raw.effective_from);
  if (!from) reasons.push("effective from is required");
  else if (!isoDate(from)) reasons.push("effective from must be YYYY-MM-DD");

  const to = text(raw.effective_to);
  if (to && !isoDate(to)) reasons.push("effective to must be YYYY-MM-DD");
  if (from && to && isoDate(from) && isoDate(to) && to < from) reasons.push("effective to is before effective from");

  const currency = text(raw.currency) || "XAF";
  if (!/^[A-Za-z]{3}$/.test(currency)) reasons.push("currency must be a 3-letter code");

  if (reasons.length) return { valid: false, reasons };

  return {
    valid: true,
    data: {
      dictionary_item_id: item.dictionary_item_id,
      rate_provider_id: provider ? provider.rate_provider_id : null,
      container_type_ref_id: container ? container.ref_id : null,
      rate,
      currency: currency.toUpperCase(),
      effective_from: from,
      effective_to: to || null,
      note: text(raw.note) || null,
    },
  };
}

/** Split parsed rows into valid / rejected with row numbers for the staging table. */
function partitionImport(rows, ctx) {
  const lookups = buildLookups(ctx);
  const valid = [];
  const rejected = [];
  rows.forEach((raw, i) => {
    const rowNo = i + 2; // header is row 1
    const check = validateImportRow(raw, lookups);
    if (check.valid) valid.push({ row: rowNo, data: check.data, raw });
    else rejected.push({ row: rowNo, reasons: check.reasons, raw });
  });
  return { valid, rejected };
}

module.exports = { pickRate, within, IMPORT_COLUMNS, buildLookups, validateImportRow, partitionImport };
