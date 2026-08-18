/**
 * Column mapping - deciding what each column of an unfamiliar file means.
 *
 * THE PROBLEM. Every institution names its columns differently, in two
 * languages, with and without accents, and nobody publishes a schema. "Date /
 * Libelle / Debit / Credit / Solde" from one bank, "TRANS DATE | NARRATION |
 * WITHDRAWAL | DEPOSIT | BALANCE" from the next, "Date,Type,Amount,Fee,Balance,
 * Financial Transaction Id" from a mobile-money portal.
 *
 * THE ANSWER, in three layers, each of which can overrule the one before it.
 *
 *   LAYER 1 - HEURISTIC (§1). A synonym table scored against the header cells.
 *   Deterministic, free, offline, and right for most files. It is also the
 *   baseline the other two layers are measured against.
 *
 *   LAYER 2 - MODEL (§2). For a header the synonyms do not cover, an LLM is
 *   shown the headers and a few sample rows and asked for a map. This is the
 *   ONLY use of a model in the reconciliation path, and it is upstream of every
 *   money decision - it proposes what a column is called, never whether two
 *   records match.
 *
 *   LAYER 3 - EVIDENCE (§3), which beats both. A proposed map is CHECKED
 *   AGAINST THE DATA: the column claimed to be a date must actually parse as
 *   dates, the column claimed to be an amount must actually parse as numbers,
 *   and a debit/credit pair must actually be mutually exclusive per row. A map
 *   that fails is rejected no matter how confident its proposer was.
 *
 * Layer 3 is what makes layer 2 safe to use at all. A model that hallucinates a
 * mapping produces a map that does not survive contact with the file, and the
 * treasurer sees a specific complaint ("the column you picked for Booking date
 * parses as a date in 3% of rows") rather than a silently wrong import.
 *
 * AND THEN A HUMAN CONFIRMS. Even a map that passes all three layers is shown
 * to the treasurer beside the values it produces, and stored only once they
 * accept it. After that the header signature carries it and nobody is asked
 * again.
 */
"use strict";

const rules = require("./reconciliation.rules");
const { logger } = require("../../../config/logger");

const SAMPLE_ROWS = 12;

/** Markers that unambiguously mean money IN, for AMOUNT_WITH_INDICATOR files. */
const CREDIT_INDICATORS = new Set(["C", "CR", "CREDIT", "CREDIT(+)", "+"]);

/* ══ §1  Heuristic proposal ════════════════════════════════════════════════ */

/**
 * How well does one header cell name one canonical field? 0..1.
 *
 * Exact match on the normalised text is decisive. Otherwise a containment or
 * token-overlap score, with a length penalty so "date" scoring against "date"
 * beats "date" scoring against "date de derniere operation de caisse".
 */
function headerScore(headerCell, field) {
  const h = rules.normalizeHeaderCell(headerCell);
  if (!h) return 0;
  let best = 0;
  for (const syn of rules.CANONICAL_FIELDS[field].synonyms) {
    const s = rules.normalizeHeaderCell(syn);
    if (!s) continue;
    if (h === s) return 1;
    if (h.startsWith(s) || h.endsWith(s)) best = Math.max(best, 0.85);
    else if (h.includes(s)) best = Math.max(best, 0.72);
    else {
      const ht = new Set(h.split(" "));
      const st = s.split(" ");
      const overlap = st.filter((t) => ht.has(t)).length;
      if (overlap) best = Math.max(best, 0.45 * (overlap / Math.max(ht.size, st.length)));
    }
  }
  return best;
}

/**
 * Greedy best-first assignment of headers to canonical fields.
 *
 * Greedy rather than optimal because the scores are not commensurable across
 * fields and a global optimum over incomparable scores is a false precision. In
 * practice the strong hits (an exact "Debit") are unambiguous and the weak ones
 * need a human anyway.
 *
 * `value_date` may share a column with `booking_date` (many statements have one
 * date column and call it "Date valeur"); every other field is exclusive, so a
 * single "Montant" column cannot be claimed as both debit and credit.
 */
function heuristicMap(headers = []) {
  const pairs = [];
  for (const field of rules.FIELD_ORDER) {
    headers.forEach((h, idx) => {
      const score = headerScore(h, field);
      if (score >= 0.4) pairs.push({ field, header: h, index: idx, score });
    });
  }
  pairs.sort((a, b) => b.score - a.score || a.index - b.index);

  const map = {};
  const scores = {};
  const usedColumns = new Set();
  for (const p of pairs) {
    if (map[p.field] !== undefined) continue;
    if (usedColumns.has(p.index) && p.field !== "value_date") continue;
    map[p.field] = p.header;
    scores[p.field] = p.score;
    usedColumns.add(p.index);
  }
  return { map, scores };
}

/**
 * Which sign convention does a map imply?
 *
 * Read off the columns, then CHECKED AGAINST THE DATA, because the columns
 * alone are not conclusive.
 *
 * The case that forces this: a mobile-money export with `Amount` holding
 * "150000.00" and "-42000.00", beside a `Type` column holding "DEPOSIT" and
 * "PAYMENT". `Type` matches the direction synonyms, so a purely structural
 * reading picks AMOUNT_WITH_INDICATOR - and then applies a magnitude-plus-
 * marker rule to a column that already carries its own sign, silently turning
 * a 42,000 payment into a 42,000 receipt. The account still foots against
 * nothing, and the error is invisible.
 *
 * So: if the amount column contains negative values, it is already signed and
 * SIGNED_AMOUNT wins whatever else is present. The data outranks the header.
 */
function inferSignConvention(map, rows = [], numberOpts = {}) {
  if (map.debit && map.credit) return "DEBIT_CREDIT_COLUMNS";

  if (map.amount) {
    const values = rows
      .slice(0, 200)
      .map((r) => rules.parseAmount(r[map.amount], numberOpts))
      .filter((v) => (v !== null && v !== undefined));
    const hasNegative = values.some((v) => v < 0);
    if (hasNegative) return "SIGNED_AMOUNT";
    if (map.direction) return "AMOUNT_WITH_INDICATOR";
    return "SIGNED_AMOUNT";
  }

  if (map.debit || map.credit) return "DEBIT_CREDIT_COLUMNS";
  return "DEBIT_CREDIT_COLUMNS";
}

/* ══ §2  Model proposal ════════════════════════════════════════════════════ */

const MAP_PROMPT = `You are mapping the columns of a bank or mobile-money statement export onto a fixed schema.

Return ONLY a compact JSON object, no prose, no code fence, of the form:
{"booking_date":"<exact source column name or null>","description":"...","debit":"...","credit":"...","amount":"...","direction":"...","running_balance":"...","external_ref":"...","cheque_no":"...","counterparty":"...","fee":"...","value_date":"...","currency":"..."}

Rules you must follow:
- Every value must be EXACTLY one of the given source column names, or null. Never invent a column name.
- Use "debit" and "credit" when the statement has two separate money columns (debit = money OUT of the account, credit = money IN).
- Use "amount" only when there is ONE money column. If that column also needs a separate D/C marker column, put the marker column in "direction".
- "running_balance" is the balance AFTER each transaction, not a transaction amount.
- "external_ref" is the institution's own transaction identifier (a transaction id, a MoMo financial transaction id, a reference number).
- Set a field to null when no source column corresponds. Do not guess.`;

/**
 * Ask the model for a map. Returns null on any failure - a missing key, a
 * timeout, unparsable output - because the heuristic map is always available
 * and a reconciliation must never be blocked on an AI provider being reachable.
 */
async function modelMap(client, { headers, rows }) {
  let llm;
  try { llm = require("../../../services/ai/llm.service"); } catch { return null; }
  if (!llm || typeof llm.chat !== "function") return null;

  const sample = rows.slice(0, 6).map((r) => {
    const o = {};
    for (const h of headers) o[h] = r[h] instanceof Date ? r[h].toISOString().slice(0, 10) : String(r[h] ?? "").slice(0, 60);
    return o;
  });

  try {
    // llm.service.chat takes ONE options object and resolves its own vendor
    // (platform-configured primary, then fallback). When no provider is
    // configured it returns a STUB whose `provider` is null - which is a
    // successful call returning prose, not JSON, so it must be treated as
    // "no answer" rather than parsed.
    const answer = await llm.chat({
      client,
      temperature: 0,
      messages: [
        { role: "system", content: MAP_PROMPT },
        { role: "user", content: `Source columns:\n${JSON.stringify(headers)}\n\nSample rows:\n${JSON.stringify(sample, null, 1)}` },
      ],
    });
    if (!answer || !answer.provider) return null;

    const json = /\{[\s\S]*\}/.exec(String(answer.text || "").replace(/```json|```/g, ""));
    if (!json) return null;
    const parsed = JSON.parse(json[0]);

    // Discard anything that is not a real column name. A model that returns a
    // plausible-sounding column the file does not have must not create one.
    const valid = new Set(headers);
    const map = {};
    for (const [field, column] of Object.entries(parsed)) {
      if (!rules.CANONICAL_FIELDS[field]) continue;
      if (typeof column === "string" && valid.has(column)) map[field] = column;
    }
    return Object.keys(map).length ? map : null;
  } catch (err) {
    logger.warn({ err }, "statement column-map proposal failed; falling back to heuristics");
    return null;
  }
}

/* ══ §3  Evidence - checking a map against the data ════════════════════════ */

/** Pull one canonical field's raw values out of the sample. */
const columnValues = (rows, column) => rows.map((r) => r[column]).filter((v) => v !== undefined);

/**
 * Verify a proposed map against the file it claims to describe.
 *
 * This is the layer that makes the other two trustworthy, so it reports rather
 * than throws: the caller shows every problem at once on the confirmation
 * screen instead of making the treasurer fix them one round trip at a time.
 *
 * Returns `{ ok, errors, warnings, stats }`.
 */
function verifyMap(map, rows, opts = {}) {
  const errors = [];
  const warnings = [];
  const stats = {};
  const sample = rows.slice(0, 200);
  const dateFormat = opts.dateFormat || "DD/MM/YYYY";
  const numberOpts = {
    decimalSeparator: opts.decimalSeparator || ",",
    thousandsSeparator: opts.thousandsSeparator ?? " ",
  };

  // Required: a date, and some way to get an amount.
  if (!map.booking_date && !map.value_date) errors.push("No date column is mapped - a statement line without a date cannot be reconciled.");
  if (!map.amount && !map.debit && !map.credit) errors.push("No amount column is mapped - map either a single Amount column or a Debit/Credit pair.");
  if (!map.description) warnings.push("No description column is mapped. Matching will rely on amounts and dates alone, which is weaker.");

  // The date column must actually hold dates.
  const dateColumn = map.booking_date || map.value_date;
  if (dateColumn) {
    const values = columnValues(sample, dateColumn).filter((v) => v !== "" && (v !== null && v !== undefined));
    const parsed = values.filter((v) => rules.parseDate(v, dateFormat) !== null).length;
    const ratio = values.length ? parsed / values.length : 0;
    stats.date_parse_ratio = Number(ratio.toFixed(3));
    if (values.length && ratio < 0.8) {
      errors.push(`The column mapped to Booking date ("${dateColumn}") parses as a date in only ${Math.round(ratio * 100)}% of rows - it is probably not the date column, or the date format is wrong.`);
    }
  }

  // Money columns must actually hold money.
  for (const field of ["amount", "debit", "credit", "running_balance", "fee"]) {
    const column = map[field];
    if (!column) continue;
    const values = columnValues(sample, column).filter((v) => v !== "" && (v !== null && v !== undefined));
    const parsed = values.filter((v) => rules.parseAmount(v, numberOpts) !== null).length;
    const ratio = values.length ? parsed / values.length : 1;
    stats[`${field}_parse_ratio`] = Number(ratio.toFixed(3));
    // Debit and credit columns are legitimately empty on most rows, so the
    // ratio is measured over NON-EMPTY cells only and a low fill rate is not
    // itself a fault.
    if (values.length && ratio < 0.9) {
      errors.push(`The column mapped to ${rules.CANONICAL_FIELDS[field].label} ("${column}") parses as a number in only ${Math.round(ratio * 100)}% of its non-empty rows.`);
    }
  }

  // A debit/credit pair must be mutually exclusive: a row is money in OR money
  // out, never both. Both populated means the pair is really something else -
  // most often an amount column beside a balance column.
  if (map.debit && map.credit) {
    let both = 0;
    let neither = 0;
    for (const r of sample) {
      const d = rules.parseAmount(r[map.debit], numberOpts);
      const c = rules.parseAmount(r[map.credit], numberOpts);
      if (d && c) both += 1;
      if (!d && !c) neither += 1;
    }
    stats.debit_credit_both = both;
    stats.debit_credit_neither = neither;
    if (both > sample.length * 0.1) {
      errors.push(`${both} of ${sample.length} sample rows have BOTH the debit and the credit column populated. Those two columns are probably not a debit/credit pair.`);
    }
    if (neither > sample.length * 0.5) {
      warnings.push(`${neither} of ${sample.length} sample rows have neither debit nor credit populated - check the header row is correct.`);
    }
  }

  // An indicator convention is only meaningful if the markers are ones we can
  // read. Unrecognised markers mean every row's direction is a guess, which is
  // the one thing this module must never do quietly.
  if (opts.signConvention === "AMOUNT_WITH_INDICATOR" && map.direction) {
    const known = new Set([
      ...(opts.debitIndicators || ["D", "DR", "DEBIT", "DEBIT(-)"]).map((x) => String(x).toUpperCase()),
      ...CREDIT_INDICATORS,
    ]);
    const markers = new Set(
      sample.map((r) => String(r[map.direction] ?? "").trim().toUpperCase()).filter(Boolean),
    );
    const unknown = [...markers].filter((m) => !known.has(m));
    if (unknown.length) {
      warnings.push(`The Debit/credit indicator column ("${map.direction}") contains values this engine does not recognise: ${unknown.slice(0, 6).join(", ")}. Rows carrying them keep whatever sign the amount column already had. Map those values, or use a signed Amount column instead.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats };
}

/* ══ §4  Proposal - the three layers, in order ═════════════════════════════ */

/**
 * Propose a complete, verified profile for a parsed file.
 *
 * Returns everything the confirmation screen needs: the map, where each field's
 * answer came from, the detected locale settings with their confidence, the
 * verification result, and a preview of the canonical rows the map produces.
 *
 * `needs_confirmation` is the field the caller acts on. It is true whenever
 * anything was inferred rather than known - which, for a file nobody has seen
 * before, is always.
 */
async function proposeProfile(client, { headers, rows, useModel = true }) {
  const sample = rows.slice(0, SAMPLE_ROWS);

  // Layer 1.
  const { map: baseMap, scores } = heuristicMap(headers);
  const source = {};
  for (const f of Object.keys(baseMap)) source[f] = "heuristic";

  // Layer 2 - only consulted for fields the heuristic could not fill, and only
  // when a required one is missing. A file the synonyms already handle should
  // not cost an API call.
  const map = { ...baseMap };
  let modelUsed = false;
  const missingRequired = !map.booking_date || (!map.amount && !map.debit && !map.credit);
  if (useModel && missingRequired) {
    const proposed = await modelMap(client, { headers, rows: sample });
    if (proposed) {
      modelUsed = true;
      for (const [field, column] of Object.entries(proposed)) {
        // The model fills gaps; it does not overrule a confident synonym hit.
        if (map[field] && (scores[field] || 0) >= 0.85) continue;
        map[field] = column;
        source[field] = "model";
      }
    }
  }

  // Locale detection, from the columns the map now points at.
  const amountColumns = [map.amount, map.debit, map.credit, map.running_balance].filter(Boolean);
  const numberSamples = [];
  for (const c of amountColumns) for (const r of rows.slice(0, 60)) if (r[c] !== "" && (r[c] !== null && r[c] !== undefined)) numberSamples.push(r[c]);
  const numberConvention = rules.detectNumberConvention(numberSamples);

  const dateColumn = map.booking_date || map.value_date;
  const dateSamples = dateColumn ? rows.slice(0, 60).map((r) => r[dateColumn]).filter((v) => v !== "" && (v !== null && v !== undefined)) : [];
  const dateDetection = rules.detectDateFormat(dateSamples);

  // Layer 3.
  const signConvention = inferSignConvention(map, rows, {
    decimalSeparator: numberConvention.decimalSeparator,
    thousandsSeparator: numberConvention.thousandsSeparator,
  });
  const verification = verifyMap(map, rows, {
    dateFormat: dateDetection.format,
    decimalSeparator: numberConvention.decimalSeparator,
    thousandsSeparator: numberConvention.thousandsSeparator,
    signConvention,
  });

  const profile = {
    column_map: map,
    sign_convention: signConvention,
    date_format: dateDetection.format,
    decimal_separator: numberConvention.decimalSeparator,
    thousands_separator: numberConvention.thousandsSeparator,
    header_signature: rules.headerSignature(headers),
  };

  return {
    profile,
    field_source: source,
    field_scores: scores,
    model_used: modelUsed,
    detection: { number: numberConvention, date: dateDetection },
    verification,
    // The screen the treasurer actually reads: source values beside what the
    // map turns them into. A wrong map is obvious here in a way it never is in
    // a column-name dropdown.
    preview: applyMap(sample, profile).rows,
    needs_confirmation: true,
    // Ranked so the UI can offer a dropdown per field ordered by plausibility
    // instead of an alphabetical list of every column.
    alternatives: Object.fromEntries(rules.FIELD_ORDER.map((field) => [
      field,
      headers
        .map((h) => ({ header: h, score: Number(headerScore(h, field).toFixed(3)) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
    ])),
  };
}

/* ══ §5  Applying a map ════════════════════════════════════════════════════ */

/**
 * Turn source rows into canonical rows through a profile.
 *
 * The single place a source row becomes money. Every sign decision in the
 * product happens on the `amount` line below, which is why the sign convention
 * is a stored, human-confirmed property rather than something re-derived per
 * import.
 *
 * Rows that cannot yield a date or an amount are not silently dropped - they
 * come back in `rejected` with a reason, so the import summary can say "312
 * rows read, 310 usable, 2 rejected: no parsable date" and the treasurer can
 * decide whether that is a footer or a problem.
 */
function applyMap(sourceRows, profile) {
  const map = profile.column_map || {};
  const numberOpts = {
    decimalSeparator: profile.decimal_separator || ",",
    thousandsSeparator: profile.thousands_separator ?? " ",
  };
  const dateFormat = profile.date_format || "DD/MM/YYYY";
  const convention = profile.sign_convention || inferSignConvention(map, sourceRows, numberOpts);
  const debitIndicators = new Set(
    (profile.debit_indicators || ["D", "DR", "DEBIT", "DEBIT(-)"]).map((s) => String(s).toUpperCase()),
  );

  const get = (row, field) => (map[field] ? row[map[field]] : undefined);
  const rows = [];
  const rejected = [];

  for (const row of sourceRows) {
    const bookingDate = rules.parseDate(get(row, "booking_date") ?? get(row, "value_date"), dateFormat);
    const valueDate = rules.parseDate(get(row, "value_date"), dateFormat);

    let amount = null;
    if (convention === "DEBIT_CREDIT_COLUMNS") {
      const debit = rules.parseAmount(get(row, "debit"), numberOpts);
      const credit = rules.parseAmount(get(row, "credit"), numberOpts);
      // Money in is positive. A debit column holds money OUT of the account, so
      // it becomes negative - regardless of whether the source wrote it with a
      // minus sign, which some do and some do not.
      if (debit || credit) amount = (credit || 0) - Math.abs(debit || 0);
    } else if (convention === "AMOUNT_WITH_INDICATOR") {
      const value = rules.parseAmount(get(row, "amount"), numberOpts);
      if ((value !== null && value !== undefined)) {
        const marker = String(get(row, "direction") ?? "").trim().toUpperCase();
        // A marker we recognise decides the sign. A marker we do NOT recognise
        // leaves the value's own sign alone rather than forcing it positive:
        // an unrecognised indicator means we do not know the direction, and
        // guessing "money in" would invent a receipt.
        if (debitIndicators.has(marker)) amount = -Math.abs(value);
        else if (CREDIT_INDICATORS.has(marker)) amount = Math.abs(value);
        else amount = value;
      }
    } else {
      amount = rules.parseAmount(get(row, "amount"), numberOpts);
    }

    const reasons = [];
    if (!bookingDate) reasons.push("no parsable date");
    if ((amount === null || amount === undefined)) reasons.push("no parsable amount");
    if (reasons.length) {
      rejected.push({ __row: row.__row, reasons, raw: row });
      continue;
    }

    const text = (field) => {
      const v = get(row, field);
      if ((v === null || v === undefined) || v === "") return null;
      return String(v).replace(/\s+/g, " ").trim() || null;
    };

    rows.push({
      __row: row.__row,
      booking_date: bookingDate,
      value_date: valueDate,
      amount,
      currency: text("currency"),
      description: text("description"),
      counterparty: text("counterparty"),
      external_ref: text("external_ref"),
      cheque_no: text("cheque_no"),
      running_balance: rules.parseAmount(get(row, "running_balance"), numberOpts),
      fee: Math.abs(rules.parseAmount(get(row, "fee"), numberOpts) || 0),
      raw: row,
    });
  }

  return { rows, rejected };
}

module.exports = {
  headerScore, heuristicMap, inferSignConvention, CREDIT_INDICATORS,
  modelMap, verifyMap, proposeProfile, applyMap,
  SAMPLE_ROWS,
};
