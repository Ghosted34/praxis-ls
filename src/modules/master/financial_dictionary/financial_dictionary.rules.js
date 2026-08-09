"use strict";
/**
 * Pure rules for the financial dictionary (MOD-05) — no DB, unit-testable.
 *   - code minting format (#<L><NNN>, letter from direction),
 *   - débours follows direction,
 *   - the nested Basic ⊆ Advanced ⊆ Full tier membership,
 *   - which single service_type_key mirrors a set of tiers,
 *   - the compliance "needs attention" gap.
 *
 * PR2 adds the three families the money views need, all still DB-free:
 *   - period maths (normalisePeriod / monthKeys / spendSeries),
 *   - rate-history maths (rateTimeline / trend),
 *   - import-row validation (validateImportRow), including the OHADA-mapping
 *     completeness rule that a row cannot be committed without,
 *   - the proof obligation an item places on a document (proofObligation).
 */

const LETTER = { REVENUE: "R", EXPENSE: "E", DEBOURS: "D", ASSET: "A" };

/** Code letter for a direction ('X' for an unknown value — never minted). */
function directionLetter(direction) { return LETTER[direction] || "X"; }

/** "#D263" — letter from direction, serial zero-padded to at least 3 digits. */
function formatCode(direction, serial) {
  return `#${directionLetter(direction)}${String(serial).padStart(3, "0")}`;
}

/** A débours item always carries the flag; otherwise the explicit toggle wins. */
function resolveDebours(direction, isDebours) { return direction === "DEBOURS" ? true : !!isDebours; }

const TIER_RANK = { BASIC: 1, ADVANCED: 2, FULL: 3 };
function tierRank(tier) { return TIER_RANK[tier] || 3; }

/**
 * Does an item tagged `itemTier` surface when the service is pulled at
 * `selected` tier? Nested: pulling ADVANCED yields BASIC + ADVANCED lines.
 */
function tierIncludes(selected, itemTier) { return tierRank(itemTier) <= tierRank(selected); }

/**
 * The single legacy service_type_key that mirrors a tier set (kept in step so
 * the Service-Type 360 still reads correctly): first BASIC, else first, else null.
 */
function primaryServiceKey(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const basic = tiers.find((t) => (t.tier || "BASIC") === "BASIC");
  return (basic || tiers[0]).service_key || null;
}

/** A billable item that always needs a receipt but names no proof source. */
function needsAttention(item) {
  return item.receipt_requirement === "ALWAYS_REQUIRED" && !item.proof_source;
}

/* ═══════════════════ SPEND OVER A PERIOD — period maths ═══════════════════ */

/**
 * The three lenses, in the order the dossier reads them. `ACTUAL` is the
 * headline: estimated is what someone hoped, committed is what was promised to
 * a third party, actual is what the ledger says left the building.
 */
const SPEND_LENSES = ["estimated", "committed", "actual"];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s) => typeof s === "string" && ISO_DAY.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const dayOf = (d) => d.toISOString().slice(0, 10);

/**
 * Resolve the requested window into a concrete [from, to] pair of ISO days.
 *
 * Defaults to the trailing twelve months INCLUDING the current one, because
 * that is the window a "how much does this line cost us?" question is actually
 * asking; an unbounded default would scan the whole ledger to answer it.
 *
 * `to` is inclusive — a period picker that says "August" means the whole of
 * August, so the repo's date predicates are `>= from AND <= to`, never `< to`.
 */
function normalisePeriod({ from = null, to = null, today = null } = {}) {
  const now = today && isDay(today) ? new Date(today + "T00:00:00Z") : new Date();
  const end = isDay(to) ? to : dayOf(now);
  let start;
  if (isDay(from)) {
    start = from;
  } else {
    const e = new Date(end + "T00:00:00Z");
    // 11 months back + the 1st = a 12-month window inclusive of `end`'s month.
    start = dayOf(new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - 11, 1)));
  }
  if (Date.parse(start) > Date.parse(end)) return { from: end, to: end, swapped: true };
  return { from: start, to: end, swapped: false };
}

/** Every "YYYY-MM" bucket the window touches, oldest first. Capped at 120. */
function monthKeys(from, to) {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  const out = [];
  const cur = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
  const last = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 1);
  while (cur.getTime() <= last && out.length < 120) {
    out.push(cur.toISOString().slice(0, 7));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Merge the three per-lens month rollups onto ONE dense month axis.
 *
 * Dense, not sparse, and that is the point: a month in which nothing was spent
 * is a fact about the item, and a chart drawn from sparse rows silently closes
 * the gap and reports a flat line where there was a pause. Every month in the
 * window gets a row, zero-filled.
 *
 * @param {string[]} months     from monthKeys()
 * @param {object} byLens       { estimated: [{month, amount, count}], … }
 * @returns {{months: object[], totals: object}}
 */
function spendSeries(months, byLens = {}) {
  const index = {};
  for (const lens of SPEND_LENSES) {
    index[lens] = new Map();
    for (const r of byLens[lens] || []) index[lens].set(String(r.month).slice(0, 7), r);
  }
  const rows = months.map((month) => {
    const row = { month };
    for (const lens of SPEND_LENSES) {
      const hit = index[lens].get(month);
      row[lens] = hit ? n(hit.amount) : 0;
      row[`${lens}_count`] = hit ? n(hit.count) : 0;
    }
    return row;
  });
  const totals = {};
  for (const lens of SPEND_LENSES) {
    totals[lens] = rows.reduce((s, r) => s + r[lens], 0);
    totals[`${lens}_count`] = rows.reduce((s, r) => s + r[`${lens}_count`], 0);
  }
  // Headline = actual (KB: the ledger is the only lens that has actually
  // happened). variance is what was committed but has not yet been posted.
  totals.headline = totals.actual;
  totals.variance_committed_actual = totals.committed - totals.actual;
  totals.variance_estimated_actual = totals.estimated - totals.actual;
  return { months: rows, totals };
}

/* ═══════════════════ COST EVOLUTION — effective-dated rates ═══════════════ */

/**
 * Order an item's rate rows into a readable timeline, oldest first, marking the
 * one in force at `asOf`.
 *
 * "In force" is `effective_from <= asOf AND (effective_to IS NULL OR >= asOf)` —
 * the same window the tax-code picker uses. A row can be superseded (has an
 * effective_to) and still be the current one for a back-dated question, which is
 * why `asOf` is a parameter rather than `now()` baked in.
 */
function rateTimeline(rates = [], asOf = null) {
  const on = isDay(asOf) ? asOf : dayOf(new Date());
  const t = Date.parse(on);
  return [...rates]
    .filter((r) => r && r.effective_from)
    .sort((a, b) => Date.parse(a.effective_from) - Date.parse(b.effective_from))
    .map((r) => {
      const from = Date.parse(r.effective_from);
      const to = r.effective_to ? Date.parse(r.effective_to) : Infinity;
      return { ...r, rate: n(r.rate), in_force: from <= t && t <= to, superseded: !!r.effective_to };
    });
}

/**
 * First → last movement across a timeline. Returns nulls rather than 0 when
 * there is nothing to compare: "no change" and "only one data point" are
 * different answers and a chart that renders 0% for both is lying.
 */
function rateTrend(points = []) {
  const vals = points.map((p) => n(p.rate)).filter((v) => Number.isFinite(v));
  if (vals.length === 0) return { first: null, last: null, delta: null, delta_pct: null, direction: "flat", points: 0 };
  const first = vals[0];
  const last = vals[vals.length - 1];
  const delta = last - first;
  const pct = first === 0 ? null : (delta / Math.abs(first)) * 100;
  return {
    first, last, delta,
    delta_pct: pct === null ? null : Math.round(pct * 100) / 100,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    points: vals.length,
  };
}

/**
 * The day before `effectiveFrom` — where a superseded rate's window closes, so
 * the series is continuous with no overlapping day. Mirrors
 * tax_jurisdiction.service.supersedeCode, deliberately: an item's rate history
 * and a tax code's history are the same discipline and must not drift apart.
 */
function dayBefore(effectiveFrom) {
  return dayOf(new Date(Date.parse(effectiveFrom + "T00:00:00Z") - 86400000));
}

/* ═══════════════════ PROOF OBLIGATIONS (compliance hook) ═══════════════════ */

/**
 * Does this catalogue line demand a supporting document, and why?
 *
 * Two independent triggers, and they are NOT the same claim:
 *   receipt_requirement = ALWAYS_REQUIRED  → a third-party receipt must exist
 *   requires_justification = true          → the spender must explain the spend
 * An item can set either, both, or neither. CONDITIONALLY_REQUIRED is
 * deliberately NOT an obligation here: "it depends" cannot be decided from the
 * catalogue row alone, and a flag raised on a maybe is noise.
 */
function proofObligation(item = {}) {
  const reasons = [];
  if (item.receipt_requirement === "ALWAYS_REQUIRED") reasons.push("ALWAYS_REQUIRED");
  if (item.requires_justification === true) reasons.push("REQUIRES_JUSTIFICATION");
  return {
    required: reasons.length > 0,
    reasons,
    // WARN, never RED. This is advisory (§Q4): a missing receipt must not block
    // a disbursement that operations need today — it must be visible and chased.
    severity: reasons.length > 0 ? "WARN" : null,
  };
}

/** An obliged item used on a document line that carries no proof_vault_id. */
function missingProof(item, line = {}) {
  if (!proofObligation(item).required) return false;
  return !line.proof_vault_id;
}

/** One sentence for the flag + the notification. Same text in both, on purpose. */
function proofMessage(item = {}, { docLabel = "document", amount = null } = {}) {
  const why = item.receipt_requirement === "ALWAYS_REQUIRED"
    ? "always requires a receipt"
    : "requires a written justification";
  const amt = amount === null || amount === undefined || !Number.isFinite(Number(amount))
    ? ""
    : ` (${Number(amount)})`;
  const src = item.proof_source ? ` Expected source: ${item.proof_source}.` : "";
  return `${item.code || "This line"} — ${item.label_en || item.label_fr || "dictionary item"} — ${why}, ` +
    `but the ${docLabel}${amt} has no supporting document attached.${src}`;
}

/* ═══════════════════ BULK IMPORT — the row contract ═══════════════════════ */

const CATEGORIES = ["debours", "service", "overhead", "asset", "other"];
const DIRECTIONS = ["REVENUE", "EXPENSE", "DEBOURS", "ASSET"];
const APPLICABILITIES = ["SERVICE_SCOPED", "ANY_OPERATIONS", "NON_OPERATIONAL"];
const RECEIPTS = ["ALWAYS_REQUIRED", "CONDITIONALLY_REQUIRED", "NOT_REQUIRED"];
const PROVIDER_KINDS = ["SHIPPING_LINE", "CUSTOMS_AUTHORITY", "PORT_TERMINAL", "OTHER"];
const CONTEXTS = ["sale", "purchase", "disbursement"];
const TIERS = ["BASIC", "ADVANCED", "FULL"];

/**
 * The spreadsheet contract, in ONE place, because the template writer, the
 * parser and the error-file writer must agree on it exactly. A column added
 * here appears in all three.
 *
 * `enum` drives the Excel data-validation dropdown; `required` drives the
 * per-row rejection. `code` is absent by design — it is minted server-side from
 * the direction (#<L><NNN>), so a spreadsheet cannot smuggle one in.
 */
const IMPORT_COLUMNS = [
  { key: "label_fr", header: "Name (FR) *", width: 32, required: true },
  { key: "label_en", header: "Name (EN)", width: 32 },
  { key: "category", header: "Category *", width: 14, required: true, enum: CATEGORIES },
  { key: "direction", header: "Direction *", width: 14, required: true, enum: DIRECTIONS },
  { key: "subcategory", header: "Sub-category", width: 20, ref: "SUBCATEGORY" },
  { key: "applicability_mode", header: "Applicability", width: 20, enum: APPLICABILITIES },
  { key: "service_type_keys", header: "Service keys (comma)", width: 26 },
  { key: "tier", header: "Tier", width: 12, enum: TIERS },
  { key: "unit_of_measure", header: "Unit", width: 16, ref: "UNIT" },
  { key: "default_price", header: "Default price", width: 14, number: true },
  { key: "currency", header: "Currency", width: 10 },
  { key: "is_billable", header: "Billable (Y/N)", width: 14, bool: true },
  { key: "provider_kind", header: "Provider kind", width: 20, enum: PROVIDER_KINDS },
  { key: "proof_source", header: "Proof source", width: 22, ref: "PROOF_SOURCE" },
  { key: "receipt_requirement", header: "Receipt requirement", width: 24, enum: RECEIPTS },
  { key: "requires_justification", header: "Justification (Y/N)", width: 18, bool: true },
  { key: "debours_vat_transparent", header: "Show upstream VAT (Y/N)", width: 22, bool: true },
  { key: "description", header: "Description", width: 40 },
  // OHADA mapping — one debit/credit pair per context. At least one complete
  // pair is what makes a row importable at all (see validateImportRow).
  { key: "sale_debit", header: "Sale · debit account", width: 20, account: true },
  { key: "sale_credit", header: "Sale · credit account", width: 20, account: true },
  { key: "sale_tax_code", header: "Sale · tax code", width: 16, taxCode: true },
  { key: "purchase_debit", header: "Purchase · debit account", width: 22, account: true },
  { key: "purchase_credit", header: "Purchase · credit account", width: 22, account: true },
  { key: "purchase_tax_code", header: "Purchase · tax code", width: 18, taxCode: true },
  { key: "disbursement_debit", header: "Disbursement · debit account", width: 24, account: true },
  { key: "disbursement_credit", header: "Disbursement · credit account", width: 24, account: true },
];

const str = (v) => (v === null || v === undefined ? "" : String(typeof v === "object" && v.text ? v.text : v).trim());
const upper = (v) => str(v).toUpperCase();

/** Y/yes/true/1/oui → true; N/no/false/0/non → false; blank → undefined. */
function parseBool(v) {
  const s = str(v).toLowerCase();
  if (s === "") return undefined;
  if (["y", "yes", "true", "1", "oui", "o", "x"].includes(s)) return true;
  if (["n", "no", "false", "0", "non"].includes(s)) return false;
  return null; // unparseable — the caller rejects the row
}

/** A spreadsheet number, tolerant of "1 250,50" and "1,250.50". Blank → undefined. */
function parseNumber(v) {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v).replace(/\s/g, "");
  // "1.250,50" (fr) → the comma is the decimal separator; "1,250.50" (en) → it isn't.
  const norm = /,\d{1,2}$/.test(s) ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const x = Number(norm);
  return Number.isFinite(x) ? x : null;
}

const splitList = (v) => str(v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean);

/**
 * Validate ONE spreadsheet row against the catalogue contract and the tenant's
 * reference data. Pure: the caller supplies what exists (`ctx`), this decides.
 *
 * THE RULE THAT MATTERS — OHADA-mapping completeness. A dictionary item without
 * a posting rule is not a lesser item, it is an unusable one: the moment it
 * lands on an invoice the determination engine has nowhere to post it and the
 * document fails. `create()` already refuses one over HTTP; an import that let
 * it through would be a bulk loader for broken catalogue rows. So a row needs
 * at least ONE context with BOTH a debit and a credit, and any context the user
 * has half-filled is an error rather than a silent drop — a row with a purchase
 * debit and no purchase credit is a typo, not a decision.
 *
 * @param {object} raw   header-keyed cell values (see IMPORT_COLUMNS)
 * @param {object} ctx   { accounts:Set<code>, taxCodes:Map<code,id>,
 *                         serviceTypes:Map<key,id>, existingLabels:Set<string> }
 * @returns {{valid:boolean, reasons:string[], data:object|null}}
 */
function validateImportRow(raw = {}, ctx = {}) {
  const accounts = ctx.accounts instanceof Set ? ctx.accounts : new Set(ctx.accounts || []);
  const taxCodes = ctx.taxCodes instanceof Map ? ctx.taxCodes : new Map(Object.entries(ctx.taxCodes || {}));
  const serviceTypes = ctx.serviceTypes instanceof Map ? ctx.serviceTypes : new Map(Object.entries(ctx.serviceTypes || {}));
  const reasons = [];
  const out = {};

  // ── identity + enums ──
  out.label_fr = str(raw.label_fr);
  if (!out.label_fr) reasons.push("Name (FR) is required");
  const labelEn = str(raw.label_en);
  if (labelEn) out.label_en = labelEn;
  const desc = str(raw.description);
  if (desc) out.description = desc;

  out.category = str(raw.category).toLowerCase();
  if (!out.category) reasons.push("Category is required");
  else if (!CATEGORIES.includes(out.category)) reasons.push(`Category "${out.category}" is not one of ${CATEGORIES.join(", ")}`);

  out.direction = upper(raw.direction);
  if (!out.direction) reasons.push("Direction is required");
  else if (!DIRECTIONS.includes(out.direction)) reasons.push(`Direction "${out.direction}" is not one of ${DIRECTIONS.join(", ")}`);

  const applic = upper(raw.applicability_mode);
  if (applic) {
    if (!APPLICABILITIES.includes(applic)) reasons.push(`Applicability "${applic}" is not one of ${APPLICABILITIES.join(", ")}`);
    else out.applicability_mode = applic;
  }
  const receipt = upper(raw.receipt_requirement);
  if (receipt) {
    if (!RECEIPTS.includes(receipt)) reasons.push(`Receipt requirement "${receipt}" is not one of ${RECEIPTS.join(", ")}`);
    else out.receipt_requirement = receipt;
  }
  const provider = upper(raw.provider_kind);
  if (provider) {
    if (!PROVIDER_KINDS.includes(provider)) reasons.push(`Provider kind "${provider}" is not one of ${PROVIDER_KINDS.join(", ")}`);
    else out.provider_kind = provider;
  }
  for (const k of ["subcategory", "unit_of_measure", "proof_source"]) {
    const v = upper(raw[k]);
    if (v) out[k] = v;
  }

  // ── numbers / booleans ──
  const price = parseNumber(raw.default_price);
  if (price === null) reasons.push(`Default price "${str(raw.default_price)}" is not a number`);
  else if (price !== undefined) {
    if (price < 0) reasons.push("Default price cannot be negative");
    else out.default_price = price;
  }
  const currency = upper(raw.currency);
  if (currency) {
    if (currency.length !== 3) reasons.push(`Currency "${currency}" must be a 3-letter code`);
    else out.currency = currency;
  }
  for (const k of ["is_billable", "requires_justification", "debours_vat_transparent"]) {
    const b = parseBool(raw[k]);
    if (b === null) reasons.push(`${k.replace(/_/g, " ")} must be Y or N (got "${str(raw[k])}")`);
    else if (b !== undefined) out[k] = b;
  }

  // ── service tiers ──
  const keys = splitList(raw.service_type_keys);
  const tier = upper(raw.tier) || "BASIC";
  if (tier && !TIERS.includes(tier)) reasons.push(`Tier "${tier}" is not one of ${TIERS.join(", ")}`);
  const tiers = [];
  for (const key of keys) {
    const id = serviceTypes.get(key) || serviceTypes.get(key.toUpperCase());
    if (!id) reasons.push(`Service type "${key}" does not exist`);
    else tiers.push({ service_type_id: id, service_key: key, tier: TIERS.includes(tier) ? tier : "BASIC" });
  }
  out.service_tiers = tiers;
  if ((out.applicability_mode || "") === "SERVICE_SCOPED" && tiers.length === 0) {
    reasons.push("A SERVICE_SCOPED row must name at least one service key");
  }

  // ── OHADA mapping ──
  const postingRules = [];
  for (const ctxName of CONTEXTS) {
    const debit = str(raw[`${ctxName}_debit`]);
    const credit = str(raw[`${ctxName}_credit`]);
    const taxRaw = str(raw[`${ctxName}_tax_code`]);
    if (!debit && !credit && !taxRaw) continue;
    if (!debit || !credit) {
      reasons.push(`${ctxName}: both a debit and a credit account are required (got debit "${debit || "—"}", credit "${credit || "—"}")`);
      continue;
    }
    let bad = false;
    for (const [side, code] of [["debit", debit], ["credit", credit]]) {
      if (accounts.size && !accounts.has(code)) { reasons.push(`${ctxName}: ${side} account "${code}" is not a postable account`); bad = true; }
    }
    let taxCodeId = null;
    if (taxRaw) {
      taxCodeId = taxCodes.get(taxRaw) || taxCodes.get(taxRaw.toUpperCase()) || null;
      if (!taxCodeId) { reasons.push(`${ctxName}: tax code "${taxRaw}" does not exist`); bad = true; }
    }
    if (!bad) postingRules.push({ applies_context: ctxName, debit_account: debit, credit_account: credit, tax_code_id: taxCodeId });
  }
  if (postingRules.length === 0) {
    reasons.push("No OHADA mapping — a row needs at least one context (sale / purchase / disbursement) with both a debit and a credit account");
  }
  out.posting_rules = postingRules;

  // A débours line always carries the flag — same rule as the HTTP path.
  if (DIRECTIONS.includes(out.direction)) out.is_debours = resolveDebours(out.direction, out.is_debours);

  return { valid: reasons.length === 0, reasons, data: reasons.length === 0 ? out : null };
}

/**
 * Split a parsed sheet into what can be committed and what cannot, preserving
 * the 1-based spreadsheet row number so the staging table and the error file
 * point at the line the user is looking at.
 *
 * Duplicate labels WITHIN the upload are rejected rather than silently merged:
 * two rows claiming the same name are a copy-paste mistake far more often than
 * an intent to create two identically-named lines, and minting two codes for
 * them makes the mistake permanent.
 */
function partitionImport(rows = [], ctx = {}) {
  const valid = [];
  const rejected = [];
  const seen = new Map();
  rows.forEach((r, i) => {
    const rowNumber = r.__row || i + 2; // +2: 1-based, and row 1 is the header
    const res = validateImportRow(r, ctx);
    const key = str(r.label_fr).toLowerCase();
    if (key && seen.has(key)) {
      rejected.push({ row: rowNumber, reasons: [...res.reasons, `Duplicate of row ${seen.get(key)} in this file (same Name (FR))`], raw: r });
      return;
    }
    if (key) seen.set(key, rowNumber);
    if (res.valid) valid.push({ row: rowNumber, data: res.data, raw: r });
    else rejected.push({ row: rowNumber, reasons: res.reasons, raw: r });
  });
  return { valid, rejected };
}

module.exports = {
  directionLetter, formatCode, resolveDebours, tierRank, tierIncludes, primaryServiceKey, needsAttention,
  // spend
  SPEND_LENSES, normalisePeriod, monthKeys, spendSeries,
  // cost evolution
  rateTimeline, rateTrend, dayBefore,
  // compliance
  proofObligation, missingProof, proofMessage,
  // import
  IMPORT_COLUMNS, CATEGORIES, DIRECTIONS, APPLICABILITIES, RECEIPTS, PROVIDER_KINDS, CONTEXTS, TIERS,
  parseBool, parseNumber, validateImportRow, partitionImport,
};
