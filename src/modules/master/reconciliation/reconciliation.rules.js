/**
 * Reconciliation rules (MOD-09) — every judgement the engine makes, as pure
 * functions over plain values.
 *
 * NOTHING HERE TOUCHES THE DATABASE, THE FILESYSTEM OR A MODEL. That is the
 * point of the file, and it is a hard rule rather than a preference.
 *
 * A reconciliation has to be defensible to an auditor a year after it was run,
 * on a laptop, without the original statement file. "The system matched them"
 * is not an answer. So every decision about whether two records are the same
 * money is made by a function in this file: given the same two records and the
 * same settings it returns the same verdict, forever, and a test can pin it.
 *
 * THE MODEL NEVER DECIDES A MATCH. An LLM is used in exactly two places in this
 * module, both of them upstream of any money decision:
 *   • proposing a column map for a file layout nobody has seen before, which a
 *     human then confirms against a preview (see reconciliation.mapping.js), and
 *   • suggesting which client or supplier an unmatched narrative refers to,
 *     which is a hint on a screen and not a posting.
 * Matching itself is the scored ladder in §5 below. It is deterministic, it is
 * cheap, and it replays.
 *
 * WHAT LIVES HERE
 *   §1  Canonical fields — the vocabulary a column map maps ONTO
 *   §2  Text normalisation — accents, case, whitespace, header signatures
 *   §3  Numbers — French/anglophone locale, and how to tell which you are given
 *   §4  Dates — the DD/MM vs MM/DD problem, and refusing to guess it silently
 *   §5  Matching — the deterministic tier ladder
 *   §6  Footing — the arithmetic that catches a mis-parse before a human does
 *   §7  Row identity — the hash that stops overlapping periods double-counting
 */
"use strict";

const crypto = require("crypto");

/* ══ §1  Canonical fields ═══════════════════════════════════════════════════
 *
 * The internal vocabulary. A `statement_profile.column_map` is a mapping from
 * these keys onto whatever the institution called them. Every parser emits
 * these keys and nothing else, so the matcher never learns that Afriland says
 * "Libellé" and MTN says "Description".
 *
 * `synonyms` drives the no-AI heuristic proposal in §1.2 and, just as
 * importantly, cross-checks whatever the model proposes: a model that maps
 * `credit` onto a column called "Date valeur" is overruled, because a wrong
 * map that looks confident is worse than no map.
 */
const CANONICAL_FIELDS = {
  booking_date: {
    required: true,
    label: "Booking date",
    synonyms: ["date", "date operation", "date de operation", "date comptable", "transaction date",
      "booking date", "date valeur", "posting date", "date transaction", "trans date", "datedoperation"],
  },
  value_date: {
    required: false,
    label: "Value date",
    synonyms: ["date valeur", "value date", "val date", "date de valeur"],
  },
  description: {
    required: true,
    label: "Description",
    synonyms: ["libelle", "description", "narration", "details", "detail", "motif", "objet",
      "transaction details", "particulars", "narrative", "operation", "nature"],
  },
  debit: {
    required: false,
    label: "Debit (money out)",
    synonyms: ["debit", "retrait", "sortie", "withdrawal", "withdrawals", "paid out", "montant debit",
      "debits", "dr", "decaissement"],
  },
  credit: {
    required: false,
    label: "Credit (money in)",
    synonyms: ["credit", "depot", "entree", "deposit", "deposits", "paid in", "montant credit",
      "credits", "cr", "encaissement", "versement"],
  },
  amount: {
    required: false,
    label: "Amount (signed)",
    synonyms: ["montant", "amount", "value", "somme", "montant operation", "transaction amount", "amt"],
  },
  direction: {
    required: false,
    label: "Debit/credit indicator",
    synonyms: ["sens", "type", "dc", "d/c", "indicator", "debit credit", "type operation", "sign"],
  },
  running_balance: {
    required: false,
    label: "Balance after",
    synonyms: ["solde", "balance", "running balance", "solde apres", "closing balance", "solde courant",
      "balance after", "cumul"],
  },
  external_ref: {
    required: false,
    label: "Reference",
    synonyms: ["reference", "ref", "no operation", "numero", "transaction id", "txn id", "financial transaction id",
      "id transaction", "piece", "no piece", "reference operation", "external id", "receipt no", "recu"],
  },
  cheque_no: {
    required: false,
    label: "Cheque number",
    synonyms: ["cheque", "no cheque", "cheque no", "check no", "numero cheque", "chq"],
  },
  counterparty: {
    required: false,
    label: "Counterparty",
    synonyms: ["beneficiaire", "counterparty", "payee", "payer", "tiers", "nom", "name", "expediteur",
      "destinataire", "from", "to", "msisdn", "numero telephone", "phone", "partner", "sender", "receiver"],
  },
  fee: {
    required: false,
    label: "Fee",
    synonyms: ["frais", "fee", "fees", "commission", "charges", "taxe", "frais operation", "charge"],
  },
  currency: {
    required: false,
    label: "Currency",
    synonyms: ["devise", "currency", "ccy", "monnaie"],
  },
};

/** The keys, in the order a preview table should show them. */
const FIELD_ORDER = Object.keys(CANONICAL_FIELDS);

/* ══ §2  Text normalisation ═════════════════════════════════════════════════ */

/**
 * Strip diacritics. "Libellé" and "LIBELLE" are the same column, and a bank
 * that drops accents in one export and keeps them in the next (which they do,
 * depending on which system generated the file) must not read as a layout
 * change — that would invalidate a confirmed profile for no reason.
 */
function stripAccents(s) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * A header cell reduced to its meaning: no accents, no case, no punctuation,
 * single spaces. "Date d'opération" → "date d operation".
 */
function normalizeHeaderCell(s) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * The fingerprint stored on `statement_profile.header_signature`.
 *
 * Order-sensitive on purpose. Two banks can use the same words in a different
 * order with different meanings ("Débit | Crédit" vs "Crédit | Débit" is the
 * difference between money in and money out), and a set-based signature would
 * collide them and reconcile an account backwards.
 *
 * Trailing empty cells are dropped: spreadsheet exports pad rows to a ragged
 * width and the padding is not part of the layout.
 */
function headerSignature(headers) {
  const cells = (Array.isArray(headers) ? headers : []).map(normalizeHeaderCell);
  while (cells.length && cells[cells.length - 1] === "") cells.pop();
  if (!cells.length) return null;
  return crypto.createHash("sha256").update(cells.join("|"), "utf8").digest("hex");
}

/**
 * A narrative reduced for comparison: no accents, no case, and no punctuation
 * or digit runs, because the digits in a bank narrative are the parts that
 * differ between two records of the same payment (one carries the bank's own
 * sequence, the other our voucher number).
 */
function normalizeDescription(s) {
  return stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words worth comparing: 3+ characters, and not banking filler. */
const STOPWORDS = new Set([
  "the", "and", "for", "from", "via", "ref", "reference", "payment", "paiement", "virement",
  "transfer", "transfert", "vers", "pour", "par", "des", "les", "une", "avec", "sur",
  "trf", "pmt", "txn", "transaction", "operation", "compte", "account", "bank", "banque",
]);

function tokens(s) {
  return normalizeDescription(s)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Similarity of two narratives, 0..1 — a Jaccard index over meaningful tokens.
 *
 * Chosen over an edit distance because bank narratives are re-ordered field
 * dumps, not sentences: "VIR RECU DUPONT SARL /REF 8891" and "DUPONT SARL —
 * virement" are the same payment and are far apart by Levenshtein.
 *
 * Never used alone. It only ever ADJUSTS a score whose amount already agrees
 * (§5), because two payments to the same supplier in the same week look
 * identical by name and are not the same money.
 */
function nameSimilarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/**
 * Do two references denote the same instrument? Compared on digits and letters
 * only, and — because institutions zero-pad inconsistently — with leading zeros
 * on all-numeric references removed. A reference shorter than 4 characters is
 * never a match: "1" appears in every statement ever written.
 */
function refEquals(a, b) {
  const norm = (v) => {
    const s = stripAccents(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
    return /^\d+$/.test(s) ? s.replace(/^0+/, "") : s;
  };
  const x = norm(a);
  const y = norm(b);
  return x.length >= 4 && x === y;
}

/**
 * Does a ledger narrative CONTAIN the institution's reference? The common case
 * where a bank gives a clean transaction id and our posting only mentions it in
 * passing ("Règlement FACT-2026-0117 chq 445120").
 */
function refAppearsIn(ref, haystack) {
  const r = stripAccents(ref).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (r.length < 5) return false;                       // stricter than refEquals: substring hits are cheap
  const h = stripAccents(haystack).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return h.includes(r);
}

/* ══ §3  Numbers ════════════════════════════════════════════════════════════
 *
 * The single highest-yield source of silent error in statement import.
 *
 * CEMAC exports are overwhelmingly French-locale: `1 234 567,89` — space (often
 * a non-breaking or narrow non-breaking space) for thousands, comma for the
 * decimal. Read with the anglophone assumption, `1 234 567,89` becomes
 * 1234567.89 by luck or 1.23456789 by disaster, depending on the parser. Both
 * produce a plausible-looking statement. Only the footing check in §6 notices.
 *
 * So: the convention is a PROPERTY OF THE PROFILE, detected once from a sample,
 * shown to a human, and then applied. `parseAmount` never sniffs per value —
 * per-value sniffing is what makes an importer inconsistent across a file whose
 * small numbers have no separators and whose large ones do.
 */

// Every space character a spreadsheet or PDF might use as a thousands grouper,
// written as escapes: NO-BREAK (U+00A0), NARROW NO-BREAK (U+202F), THIN
// (U+2009) and FIGURE (U+2007) spaces all appear in real exports, and as
// literal bytes in source they are invisible to review and fragile to any
// re-encoding of this file.
const SPACE_CHARS = /[\s\u00a0\u202f\u2009\u2007]/g;

/**
 * Parse one money cell under a KNOWN convention. Returns a Number, or null when
 * the cell holds no number at all (blank, "-", "N/A") — null and 0 are
 * different answers and the caller needs to tell them apart.
 *
 * Handles the four ways a statement writes a negative: a leading minus, a
 * trailing minus (mainframe exports), parentheses (accountancy), and a separate
 * indicator column (which is §3.3's job, not this one's).
 */
function parseAmount(value, opts = {}) {
  if ((value === null || value === undefined)) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const decimal = opts.decimalSeparator || ",";
  const thousands = opts.thousandsSeparator ?? " ";

  let s = String(value).trim();
  if (!s) return null;

  // A currency code or symbol sitting in the amount cell.
  s = s.replace(/[A-Za-z$€£¥]/g, "").trim();
  if (!s || s === "-" || s === "--") return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { negative = true; s = s.slice(1); }
  if (/-$/.test(s)) { negative = true; s = s.slice(0, -1); }
  if (/^\+/.test(s)) s = s.slice(1);

  // Remove the thousands grouper, then swap the decimal mark for a point.
  if (thousands === " ") s = s.replace(SPACE_CHARS, "");
  else if (thousands) s = s.split(thousands).join("");
  s = s.replace(SPACE_CHARS, "");
  if (decimal !== ".") s = s.replace(new RegExp(`\\${decimal}`, "g"), ".");

  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * Work out which locale a column of money is written in.
 *
 * The rules, in order of how much they prove:
 *   1. Both `.` and `,` appear in one value → the LAST one is the decimal mark.
 *      `1.234.567,89` and `1,234,567.89` are both unambiguous this way.
 *   2. A separator appears MORE THAN ONCE in one value → it groups thousands,
 *      so the other candidate is the decimal mark.
 *   3. A separator is followed by other than 2 digits → it groups thousands
 *      (`1,234` with 3 trailing digits) or is a decimal (`1,5`).
 *   4. Nothing decides → fall back to French, and say so. `confidence` comes
 *      back below 1 and the caller MUST put the answer in front of a human.
 *      This is the one place the engine is allowed to assume, and it is only
 *      allowed because it also declares that it assumed.
 */
function detectNumberConvention(samples = []) {
  const values = samples.map((v) => String(v ?? "")).filter((s) => /\d/.test(s));
  if (!values.length) {
    return { decimalSeparator: ",", thousandsSeparator: " ", confidence: 0, reason: "no numeric samples" };
  }

  let commaDecimal = 0;
  let dotDecimal = 0;

  for (const raw of values) {
    const s = raw.replace(SPACE_CHARS, "").replace(/[^0-9.,]/g, "");
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    const dots = (s.match(/\./g) || []).length;
    const commas = (s.match(/,/g) || []).length;

    if (dots && commas) {                                   // rule 1 — decisive
      if (lastDot > lastComma) dotDecimal += 3; else commaDecimal += 3;
      continue;
    }
    if (dots > 1) { commaDecimal += 2; continue; }          // rule 2
    if (commas > 1) { dotDecimal += 2; continue; }          // rule 2
    if (dots === 1) {                                       // rule 3
      const after = s.length - lastDot - 1;
      if (after === 3) commaDecimal += 1; else dotDecimal += 1;
    }
    if (commas === 1) {
      const after = s.length - lastComma - 1;
      if (after === 3) dotDecimal += 1; else commaDecimal += 1;
    }
  }

  const total = commaDecimal + dotDecimal;
  if (!total) {                                             // rule 4 — integers only
    return {
      decimalSeparator: ",", thousandsSeparator: " ", confidence: 0.4,
      reason: "no fractional values in sample; assumed French locale",
    };
  }
  const comma = commaDecimal >= dotDecimal;
  return {
    decimalSeparator: comma ? "," : ".",
    thousandsSeparator: comma ? " " : ",",
    confidence: Math.min(1, Math.max(commaDecimal, dotDecimal) / total),
    reason: comma ? "comma-decimal (French locale)" : "dot-decimal (anglophone locale)",
  };
}

/* ══ §4  Dates ══════════════════════════════════════════════════════════════
 *
 * `03/04/2026` is the 3rd of April or the 4th of March and the file will not
 * tell you. Get it wrong and every transaction lands in a plausible but wrong
 * month; the statement still foots, because footing is about amounts. This is
 * the one parse error arithmetic does NOT catch, which is why the engine
 * refuses to resolve the ambiguity on its own — `detectDateFormat` reports
 * `ambiguous` and the mapping preview makes the human choose.
 */
const MONTHS = {
  jan: 1, janv: 1, january: 1, janvier: 1,
  feb: 2, fev: 2, fevr: 2, february: 2, fevrier: 2,
  mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, april: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, juin: 6, june: 6,
  jul: 7, juil: 7, july: 7, juillet: 7,
  aug: 8, aou: 8, august: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MON-YYYY", "DD.MM.YYYY"];

const pad2 = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

/** Is (y,m,d) a date that exists? Catches 31/02 and the non-leap 29 Feb. */
function isRealDate(y, m, d) {
  if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Two-digit year → 20xx for 00-79, 19xx above. Statement data is never 1980s. */
const expandYear = (y) => (y >= 100 ? y : y < 80 ? 2000 + y : 1900 + y);

/**
 * Parse one date cell under a KNOWN format. Returns 'YYYY-MM-DD' or null.
 *
 * Accepts a JS Date directly because ExcelJS hands back real Date objects for
 * cells the spreadsheet had typed as dates — which is the good case, and the
 * one where no format guessing is needed at all.
 */
function parseDate(value, format = "DD/MM/YYYY") {
  if ((value === null || value === undefined) || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : isoOf(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  const s = String(value).trim();
  if (!s) return null;

  // ISO first, whatever the declared format — a source that emits ISO means it.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return isRealDate(y, m, d) ? isoOf(y, m, d) : null;
  }

  // Textual month: "12 JAN 2026", "12-janv-2026". Unambiguous, so also accepted
  // regardless of the declared format.
  const named = /^(\d{1,2})[\s./-]+([A-Za-zÀ-ÿ]{3,10})[\s./-]+(\d{2,4})$/.exec(s);
  if (named) {
    const m = MONTHS[stripAccents(named[2]).toLowerCase().replace(/\.$/, "")];
    const d = Number(named[1]);
    const y = expandYear(Number(named[3]));
    if (m && isRealDate(y, m, d)) return isoOf(y, m, d);
  }

  const parts = /^(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})/.exec(s);
  if (!parts) return null;
  const a = Number(parts[1]);
  const b = Number(parts[2]);
  const c = Number(parts[3]);

  let y;
  let m;
  let d;
  if (format === "YYYY-MM-DD" || a > 31) { y = expandYear(a); m = b; d = c; }
  else if (format === "MM/DD/YYYY") { m = a; d = b; y = expandYear(c); }
  else { d = a; m = b; y = expandYear(c); }               // DD/MM/YYYY and DD.MM.YYYY

  return isRealDate(y, m, d) ? isoOf(y, m, d) : null;
}

/**
 * Infer the date format from a column of samples.
 *
 * Decisive evidence is a component that CANNOT be a month. If any sample has
 * first-component > 12 the format is day-first; if any has second-component >
 * 12 it is month-first. Both, and the column is inconsistent — which happens,
 * and is worth saying out loud rather than averaging away.
 *
 * With no decisive sample the answer is `ambiguous: true`. The caller must not
 * proceed silently: unlike a number-locale error, a date-order error survives
 * every downstream check the engine has.
 */
function detectDateFormat(samples = []) {
  const values = samples.map((v) => (v ?? "")).filter((v) => v !== "");
  if (!values.length) return { format: "DD/MM/YYYY", confidence: 0, ambiguous: true, reason: "no samples" };

  if (values.every((v) => v instanceof Date)) {
    return { format: "YYYY-MM-DD", confidence: 1, ambiguous: false, reason: "source supplied typed dates" };
  }

  let dayFirst = 0;
  let monthFirst = 0;
  let isoCount = 0;
  let named = 0;
  let parsed = 0;

  for (const raw of values) {
    if (raw instanceof Date) { isoCount += 1; parsed += 1; continue; }
    const s = String(raw).trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) { isoCount += 1; parsed += 1; continue; }
    if (/^\d{1,2}[\s./-]+[A-Za-zÀ-ÿ]{3,10}[\s./-]+\d{2,4}$/.test(s)) { named += 1; parsed += 1; continue; }
    const p = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(s);
    if (!p) continue;
    parsed += 1;
    const a = Number(p[1]);
    const b = Number(p[2]);
    if (a > 12 && b <= 12) dayFirst += 1;
    else if (b > 12 && a <= 12) monthFirst += 1;
  }

  if (!parsed) return { format: "DD/MM/YYYY", confidence: 0, ambiguous: true, reason: "no parsable samples" };
  if (isoCount === parsed) return { format: "YYYY-MM-DD", confidence: 1, ambiguous: false, reason: "ISO 8601" };
  if (named === parsed) return { format: "DD-MON-YYYY", confidence: 1, ambiguous: false, reason: "textual month" };

  if (dayFirst && monthFirst) {
    return {
      format: "DD/MM/YYYY", confidence: 0.3, ambiguous: true,
      reason: `inconsistent column: ${dayFirst} sample(s) can only be day-first, ${monthFirst} can only be month-first`,
    };
  }
  if (dayFirst) {
    return { format: "DD/MM/YYYY", confidence: 1, ambiguous: false, reason: `${dayFirst} sample(s) have a first component > 12` };
  }
  if (monthFirst) {
    return { format: "MM/DD/YYYY", confidence: 1, ambiguous: false, reason: `${monthFirst} sample(s) have a second component > 12` };
  }
  // Every sample fits both readings — the genuinely ambiguous case.
  return {
    format: "DD/MM/YYYY", confidence: 0.5, ambiguous: true,
    reason: "every sample is valid read either way; defaulted to day-first (CEMAC convention) — confirm before importing",
  };
}

/* ══ §5  Matching — the deterministic tier ladder ═══════════════════════════
 *
 * Given one statement line and a candidate journal line, decide whether they
 * are the same money and how sure we are.
 *
 * A LADDER, NOT A WEIGHTED SUM. The tiers are tried in order and the first that
 * fits wins. A weighted model would let a very strong name similarity drag a
 * wrong amount over the line, and the amount is the one field that is never
 * approximately right — money either agrees or it does not. So amount agreement
 * is a GATE on every tier; narrative similarity and date proximity only ever
 * move a score WITHIN the tier the amount already qualified for.
 *
 *   1  institution reference matches, amount agrees      0.99
 *   2  institution reference appears in the narrative, amount agrees   0.96
 *   3  amount agrees, same date                          0.94
 *   4  amount agrees, date within the near window        0.80–0.92
 *   5  amount agrees, date within the far window, narrative agrees     0.62–0.80
 *   6  amount agrees within tolerance (fee/FX rounding), date near     0.55–0.75
 *
 * Anything scoring below SUGGEST_FLOOR is not offered at all: a queue of weak
 * guesses costs more attention than it saves, and the treasurer stops reading
 * it after the first bad week.
 *
 * AUTO_CONFIRM_TIER is 1. Only an exact institution-reference hit with an
 * agreeing amount is confirmed without a human, and that is defensible because
 * a MoMo Financial Transaction ID or a cheque number identifies an instrument,
 * not a coincidence. Everything else is SUGGESTED and waits. Note that even a
 * confirmed match writes nothing to the ledger (see the migration header) — it
 * records that two existing records describe one event.
 */
const SUGGEST_FLOOR = 0.5;
const AUTO_CONFIRM_TIER = 1;
const DEFAULT_NEAR_DAYS = 3;
const DEFAULT_FAR_DAYS = 10;
const DEFAULT_NAME_FLOOR = 0.34;

/** Whole days between two 'YYYY-MM-DD' strings. */
function daysBetween(a, b) {
  const t1 = Date.parse(`${a}T00:00:00Z`);
  const t2 = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((t1 - t2) / 86400000));
}

/** Money compared at 2dp, because numeric(18,2) is what both sides are stored as. */
const cents = (n) => Math.round(Number(n || 0) * 100);

/**
 * Do two amounts agree?
 *
 * `tolerance` is absolute, in currency units, and defaults to zero — a bank
 * reconciliation is exact arithmetic and a "close enough" default would quietly
 * paper over real differences. It is opened up deliberately by the caller in
 * two situations, both real:
 *   • mobile money, where the provider's fee may or may not be inside the
 *     figure the export shows, and
 *   • a foreign-currency account, where our posting carries an FX rounding of a
 *     unit or two against the bank's own conversion.
 */
function amountsAgree(statementAmount, ledgerAmount, tolerance = 0) {
  return Math.abs(cents(statementAmount) - cents(ledgerAmount)) <= cents(tolerance);
}

/**
 * The signed movement a journal line represents on a class-5 treasury leaf.
 *
 * A debit to an asset account is money IN, which is the same sign convention
 * `bank_statement_line.amount` uses (see the migration). Doing this conversion
 * in one function means the matcher never reasons about debits and credits, and
 * a sign error can only be made once.
 */
function ledgerSignedAmount(journalLine) {
  return Number(journalLine.debit || 0) - Number(journalLine.credit || 0);
}

/**
 * Score one candidate pairing.
 *
 * Returns `{ tier, confidence, method, reasons }`, or null when the pair does
 * not qualify at any tier. `reasons` is written to `reconciliation_match.reasons`
 * and is the audit answer to "why did you match these two".
 */
function scoreMatch(line, candidate, opts = {}) {
  const nearDays = opts.nearDays ?? DEFAULT_NEAR_DAYS;
  const farDays = opts.farDays ?? DEFAULT_FAR_DAYS;
  const nameFloor = opts.nameFloor ?? DEFAULT_NAME_FLOOR;
  const tolerance = opts.tolerance ?? 0;

  const stAmount = Number(line.amount);
  const glAmount = ledgerSignedAmount(candidate);

  // GATE 1 — direction. Money in cannot explain money out, at any similarity.
  if (Math.sign(stAmount) !== Math.sign(glAmount)) return null;

  const exact = amountsAgree(stAmount, glAmount, 0);
  const within = exact || amountsAgree(stAmount, glAmount, tolerance);
  if (!within) return null;                              // GATE 2 — amount

  const stDate = line.booking_date || line.value_date;
  const glDate = candidate.entry_date;
  const gap = stDate && glDate ? daysBetween(stDate, glDate) : Number.POSITIVE_INFINITY;

  const narrative = [candidate.description, candidate.narrative, candidate.counterparty]
    .filter(Boolean).join(" ");
  const similarity = nameSimilarity(
    [line.description, line.counterparty].filter(Boolean).join(" "),
    narrative,
  );

  const reasons = [];
  const refs = [line.external_ref, line.cheque_no].filter(Boolean);
  const ledgerRefs = [candidate.external_ref, candidate.source_doc_ref, candidate.doc_number].filter(Boolean);

  // ── Tier 1 — the institution's own identifier, matched outright.
  if (exact) {
    for (const r of refs) {
      for (const lr of ledgerRefs) {
        if (refEquals(r, lr)) {
          reasons.push(`reference ${r} matches ledger reference ${lr}`, "amount agrees exactly");
          return { tier: 1, confidence: 0.99, method: "REFERENCE_EXACT", reasons };
        }
      }
    }
  }

  // ── Tier 2 — the identifier appears inside our narrative.
  if (exact && refs.length && narrative) {
    for (const r of refs) {
      if (refAppearsIn(r, `${narrative} ${ledgerRefs.join(" ")}`)) {
        reasons.push(`reference ${r} appears in the ledger narrative`, "amount agrees exactly");
        return { tier: 2, confidence: 0.96, method: "REFERENCE_IN_NARRATIVE", reasons };
      }
    }
  }

  // ── Tier 3 — same amount, same day.
  if (exact && gap === 0) {
    reasons.push("amount agrees exactly", "same date");
    const bump = similarity >= nameFloor ? 0.01 : 0;
    if (bump) reasons.push(`narrative similarity ${similarity.toFixed(2)}`);
    return { tier: 3, confidence: 0.94 + bump, method: "AMOUNT_DATE_EXACT", reasons };
  }

  // ── Tier 4 — same amount, a few days apart. Value-date vs booking-date lag,
  //    and the ordinary gap between our recording a payment and the bank
  //    clearing it.
  if (exact && gap <= nearDays) {
    const decay = 0.92 - (gap - 1) * 0.04;               // 1d 0.92 · 2d 0.88 · 3d 0.84
    const bump = similarity >= nameFloor ? 0.03 : 0;
    reasons.push("amount agrees exactly", `${gap} day(s) apart`);
    if (bump) reasons.push(`narrative similarity ${similarity.toFixed(2)}`);
    return { tier: 4, confidence: Math.min(0.92, decay + bump), method: "AMOUNT_EXACT_DATE_NEAR", reasons };
  }

  // ── Tier 5 — same amount, further apart, and the narratives agree. Without
  //    the narrative this is just "two payments of the same size in the same
  //    fortnight", which is not evidence of anything.
  if (exact && gap <= farDays && similarity >= nameFloor) {
    const conf = 0.62 + Math.min(0.18, similarity * 0.25) - (gap - nearDays) * 0.01;
    reasons.push("amount agrees exactly", `${gap} day(s) apart`, `narrative similarity ${similarity.toFixed(2)}`);
    return { tier: 5, confidence: Math.max(SUGGEST_FLOOR, conf), method: "AMOUNT_EXACT_NARRATIVE", reasons };
  }

  // ── Tier 6 — the amount is off by no more than the tolerance the caller
  //    allowed. For mobile money that tolerance IS the fee; for an FX account
  //    it is the rounding. Never reached with the default tolerance of zero.
  if (!exact && gap <= farDays) {
    const delta = Math.abs(stAmount - glAmount);
    const conf = 0.55 + (similarity >= nameFloor ? 0.12 : 0) - Math.min(0.1, gap * 0.01);
    if (conf < SUGGEST_FLOOR) return null;
    reasons.push(
      `amount differs by ${delta.toFixed(2)} (within the ${Number(tolerance).toFixed(2)} tolerance)`,
      `${gap} day(s) apart`,
    );
    if (similarity >= nameFloor) reasons.push(`narrative similarity ${similarity.toFixed(2)}`);
    return { tier: 6, confidence: conf, method: "AMOUNT_TOLERANCE", reasons };
  }

  return null;
}

/**
 * Rank every candidate for one statement line, best first, dropping anything
 * below the suggestion floor.
 *
 * The tie-break is deliberate: equal confidence resolves to the SMALLER date
 * gap, then to the lower journal line id. Determinism matters more than which
 * of two indistinguishable candidates wins — re-running the matcher must not
 * shuffle the queue under the treasurer.
 */
function rankCandidates(line, candidates = [], opts = {}) {
  const scored = [];
  for (const c of candidates) {
    const s = scoreMatch(line, c, opts);
    if (!s || s.confidence < SUGGEST_FLOOR) continue;
    const gap = line.booking_date && c.entry_date ? daysBetween(line.booking_date, c.entry_date) : 9999;
    scored.push({ ...s, candidate: c, gap });
  }
  scored.sort((a, b) =>
    b.confidence - a.confidence
    || a.tier - b.tier
    || a.gap - b.gap
    || String(a.candidate.line_id).localeCompare(String(b.candidate.line_id)));
  return scored;
}

/**
 * One statement line against a SUM of several ledger lines — the lodgement of
 * five cheques that the bank shows as one credit.
 *
 * Bounded hard at `maxSubsetSize` (default 4) and at 24 candidates. Subset-sum
 * is exponential, this runs inside a request, and a treasurer who lodged nine
 * cheques as one deposit is better served by picking them by hand than by a
 * search that ties up a connection. Candidates are pre-filtered to those that
 * cannot individually exceed the target.
 */
function findSplitMatch(line, candidates = [], opts = {}) {
  const maxSize = opts.maxSubsetSize ?? 4;
  const target = cents(line.amount);
  const pool = candidates
    .filter((c) => {
      const v = cents(ledgerSignedAmount(c));
      return v !== 0 && Math.sign(v) === Math.sign(target) && Math.abs(v) <= Math.abs(target);
    })
    .slice(0, 24);

  let best = null;
  const walk = (start, chosen, sum) => {
    if (best) return;                                     // first exact hit wins
    if (chosen.length >= 2 && sum === target) { best = chosen.slice(); return; }
    if (chosen.length >= maxSize || Math.abs(sum) > Math.abs(target)) return;
    for (let i = start; i < pool.length; i += 1) {
      chosen.push(pool[i]);
      walk(i + 1, chosen, sum + cents(ledgerSignedAmount(pool[i])));
      chosen.pop();
      if (best) return;
    }
  };
  walk(0, [], 0);

  if (!best) return null;
  return {
    tier: 7,
    confidence: 0.7,
    method: "SPLIT_SUM",
    reasons: [`${best.length} ledger lines sum exactly to this statement line`],
    candidates: best,
  };
}

/* == §6  Footing - the arithmetic gate =====================================
 *
 * The check that makes the whole import trustworthy, and the reason the engine
 * can afford to be relaxed about PDF extraction quality.
 *
 * A statement asserts an opening balance, a closing balance, and a list of
 * movements. Those three are redundant - and redundancy is exactly what lets us
 * verify a parse we did not write the parser for. If
 *
 *     closing - opening != sum of movements
 *
 * then something was mis-read: a dropped row (PDF page break, a footer counted
 * as data), a sign convention read backwards (debit column treated as credit),
 * a thousands separator eaten as a decimal point, a duplicated row. Every one
 * of those is silent, and every one of them fails here.
 *
 * Returns `foots: null` when the source declared no balances and carried no
 * running balance. That is a THIRD answer and not a pass: it records that the
 * check could not run, and `bank_statement.foots` stays NULL to say so, rather
 * than a `true` that would claim a verification nobody performed.
 */
function checkFooting({ openingBalance, closingBalance, lines = [], feeAware = true }) {
  // A line's row number for error messages. Canonical rows carry `__row` (the
  // source file's line); stored rows carry `row_index`. Both are accepted so
  // the check reports a number the reader can find in their file either way.
  const rowNo = (l) => ((l === null || l === undefined) ? null : (l.row_index ?? (l.__row ?? null)));

  // Two readings of "the movement", because providers differ on whether the
  // balance already has the fee taken out of it.
  //
  // MTN and Orange exports typically show `Amount` as the transaction and
  // `Fee` as a separate charge, with the running balance reflecting BOTH. A
  // 42,000 payment carrying a 210 fee moves the balance by 42,210. Read
  // fee-blind, such a statement never foots and the treasurer is told their
  // file is broken when it is perfectly correct.
  //
  // So both are computed and whichever reconciles is reported, along with
  // which one it was - that flag is itself the answer to "does this provider's
  // balance include its fees", which the fee-splitting posting logic needs.
  const plain = lines.reduce((sum, l) => sum + cents(l.amount), 0);
  const netOfFees = lines.reduce((sum, l) => sum + cents(l.amount) - Math.abs(cents(l.fee || 0)), 0);
  const anyFees = plain !== netOfFees;

  if ((openingBalance !== null && openingBalance !== undefined) && (closingBalance !== null && closingBalance !== undefined)) {
    const expected = cents(closingBalance) - cents(openingBalance);
    const plainDiff = plain - expected;
    const feeDiff = netOfFees - expected;
    const useFees = feeAware && anyFees && plainDiff !== 0 && feeDiff === 0;
    const movement = useFees ? netOfFees : plain;
    const difference = (movement - expected) / 100;

    return {
      foots: difference === 0,
      difference,
      movement: movement / 100,
      expected: expected / 100,
      basis: "DECLARED_BALANCES",
      fees_included_in_balance: anyFees ? useFees : null,
      reason: difference === 0
        ? (useFees
          ? "declared closing = declared opening + sum of movements, once each line's fee is also deducted"
          : "declared closing = declared opening + sum of movements")
        : `sum of movements is ${(movement / 100).toFixed(2)} but the declared balances imply ${(expected / 100).toFixed(2)}`,
    };
  }

  // Fallback: a running-balance column is the same assertion, per row. Walking
  // it also localises the failure - the first row where the walk breaks is
  // usually the row that was mis-parsed, which is far more use to a human than
  // "the file does not add up".
  const withBalance = lines.filter((l) => (l.running_balance !== null && l.running_balance !== undefined));
  if (withBalance.length >= 2) {
    const walk = (deductFees) => {
      for (let i = 1; i < withBalance.length; i += 1) {
        const prev = cents(withBalance[i - 1].running_balance);
        const here = cents(withBalance[i].running_balance);
        const step = cents(withBalance[i].amount) - (deductFees ? Math.abs(cents(withBalance[i].fee || 0)) : 0);
        if (here - prev !== step) return withBalance[i];
      }
      return null;
    };

    let brokeAt = walk(false);
    let useFees = false;
    if (brokeAt && feeAware && anyFees && walk(true) === null) { brokeAt = null; useFees = true; }

    const movement = useFees ? netOfFees : plain;
    const first = withBalance[0];
    const last = withBalance[withBalance.length - 1];
    const firstStep = cents(first.amount) - (useFees ? Math.abs(cents(first.fee || 0)) : 0);
    const expected = cents(last.running_balance) - cents(first.running_balance) + firstStep;

    return {
      foots: brokeAt === null,
      difference: (movement - expected) / 100,
      movement: movement / 100,
      expected: expected / 100,
      basis: "RUNNING_BALANCE",
      fees_included_in_balance: anyFees ? useFees : null,
      broke_at_row: rowNo(brokeAt),
      reason: brokeAt === null
        ? (useFees
          ? "the running balance walks correctly through every row, once each line's fee is also deducted"
          : "the running balance column walks correctly through every row")
        : `the running balance stops walking at row ${rowNo(brokeAt)} - that row is the likely mis-parse`,
    };
  }

  return {
    foots: null,
    difference: null,
    movement: plain / 100,
    expected: null,
    basis: "UNCHECKABLE",
    fees_included_in_balance: null,
    reason: "the source declared no opening/closing balance and carried no running balance column - footing could not be verified",
  };
}

/**
 * The etat de rapprochement identity (see the `reconciliation` table comment):
 *
 *   ledger + deposits in transit - outstanding payments
 *         + unrecorded credits  - unrecorded debits   = statement
 *
 * `unexplained_difference` is what that identity fails to close, and a
 * reconciliation cannot be approved while it is non-zero.
 */
function reconciliationDifference({
  ledgerBalance = 0, statementBalance = 0,
  depositsInTransit = 0, outstandingPayments = 0,
  unrecordedCredits = 0, unrecordedDebits = 0,
}) {
  const explained = cents(ledgerBalance)
    + cents(depositsInTransit) - cents(outstandingPayments)
    + cents(unrecordedCredits) - cents(unrecordedDebits);
  return (cents(statementBalance) - explained) / 100;
}

/* == §7  Row identity ======================================================
 *
 * The hash behind `ux_statement_row`, which is what stops overlapping statement
 * periods double-counting.
 *
 * Built from the transaction's NATURAL KEY - the facts about the payment - and
 * deliberately NOT from its position in the file, its row number, or the
 * statement it arrived in. Those are properties of the export, and the same
 * payment has different ones in each export it appears in, which is precisely
 * the case the guard exists to catch.
 *
 * The institution's own reference dominates when it gave one: a MoMo Financial
 * Transaction ID identifies the transaction better than anything we could
 * derive. Without one, the key falls back to date + signed amount + normalised
 * narrative.
 *
 * A KNOWN AND ACCEPTED LIMIT: two genuinely distinct payments, same day, same
 * amount, same narrative, no reference, collide - a supplier paid twice in one
 * day for the same thing. The second import is flagged as a duplicate and the
 * treasurer marks it as distinct on the review screen. Erring this way is
 * deliberate: a duplicate surfaced for a human to dismiss costs a click, while
 * a duplicate silently admitted costs a reconciliation that will not close and
 * nobody will know why.
 */
function rowHash({ treasuryAccountId, bookingDate, amount, description, externalRef }) {
  const key = externalRef && String(externalRef).trim()
    ? ["REF", treasuryAccountId, String(externalRef).trim().toUpperCase()].join(" ")
    : ["NAT", treasuryAccountId, bookingDate, cents(amount), normalizeDescription(description)].join(" ");
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

/** SHA-256 of an uploaded file, for `bank_statement.file_hash`. */
function fileHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

module.exports = {
  // §1 canonical vocabulary
  CANONICAL_FIELDS, FIELD_ORDER,
  // §2 text
  stripAccents, normalizeHeaderCell, headerSignature, normalizeDescription,
  tokens, nameSimilarity, refEquals, refAppearsIn,
  // §3 numbers
  parseAmount, detectNumberConvention,
  // §4 dates
  DATE_FORMATS, parseDate, detectDateFormat, isRealDate,
  // §5 matching
  SUGGEST_FLOOR, AUTO_CONFIRM_TIER, DEFAULT_NEAR_DAYS, DEFAULT_FAR_DAYS, DEFAULT_NAME_FLOOR,
  daysBetween, amountsAgree, ledgerSignedAmount, scoreMatch, rankCandidates, findSplitMatch,
  // §6 footing
  checkFooting, reconciliationDifference,
  // §7 identity
  rowHash, fileHash,
};
