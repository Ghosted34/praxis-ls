/**
 * SWIFT MT940 (Customer Statement Message) parser.
 *
 * The older sibling of camt.053 and, in practice, the one an African corporate
 * banking desk is more likely to be able to send today. Line-oriented, tagged,
 * fixed-ish: every field is `:NN:` at the start of a line, continuing until the
 * next tag.
 *
 * Like camt.053 it is self-describing - the sign is a D/C letter in the field,
 * dates are YYMMDD, and the decimal mark is a comma BY SPECIFICATION (SWIFT
 * mandates it), so none of §3/§4's ambiguity applies. No column map needed.
 *
 * The tags that carry a statement:
 *   :20:  transaction reference
 *   :25:  account identification
 *   :28C: statement / sequence number
 *   :60F: opening balance   (F = final, M = intermediate on a paged statement)
 *   :61:  a statement line
 *   :86:  narrative for the line above
 *   :62F: closing balance
 *   :64:  closing available balance (ignored - not a movement)
 */
"use strict";

const MAX_LINES = 20000;

/** YYMMDD -> 'YYYY-MM-DD'. SWIFT has no century; the window is the same as §4. */
function swiftDate(s) {
  if (!s || s.length !== 6 || !/^\d{6}$/.test(s)) return null;
  const yy = Number(s.slice(0, 2));
  const year = yy < 80 ? 2000 + yy : 1900 + yy;
  const month = Number(s.slice(2, 4));
  const day = Number(s.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** SWIFT amounts are always comma-decimal, never grouped. */
function swiftAmount(s) {
  const n = Number(String(s || "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * A balance field (:60F:, :62F:): <D|C><YYMMDD><CCY><amount>.
 * A `D` balance is an overdraft and comes back negative.
 */
function parseBalance(body) {
  // SWIFT bounds the amount subfield at 15 characters. Saying so in the pattern
  // is not cosmetic: an unbounded run of digits/commas next to another
  // quantifier is what turns a hostile statement file into a CPU hang.
  const m = /^([DC])(\d{6})([A-Z]{3})([\d,.]{1,15})/.exec(String(body || "").trim());
  if (!m) return null;
  const amount = swiftAmount(m[4]);
  if ((amount === null || amount === undefined)) return null;
  return { date: swiftDate(m[2]), currency: m[3], amount: m[1] === "D" ? -amount : amount };
}

/**
 * A :61: statement line.
 *
 *   <valueDate YYMMDD><entryDate MMDD?><D|C|RC|RD><amount><txnType 4><ref>
 *
 * `RC`/`RD` are REVERSALS and flip the sign of what the letter would otherwise
 * mean - a reversed credit is money leaving. Getting that backwards turns a
 * returned cheque into a second receipt, so it is handled explicitly rather
 * than by matching on the first character.
 */
function parseLine61(body) {
  const s = String(body || "").trim();

  // TWO BOUNDED PASSES, NOT ONE PATTERN, and this is a hardening fix rather
  // than a style choice.
  //
  // The single anchored pattern this replaces ended `([\d,.]+)(...)?(.*)$`.
  // The amount run and the trailing catch-all both accept a comma, and the
  // amount run was unbounded, so a line carrying a long run of commas gave the
  // engine a quadratic number of ways to split it — a statement file is
  // untrusted input, and that is a CPU denial of service with a bank's logo on
  // it (CodeQL js/polynomial-redos).
  //
  // Splitting at the amount removes the ambiguity outright: the head pattern
  // has nothing after the amount to back-track into, and every quantifier in
  // it is bounded by the SWIFT field widths.
  const head = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d,.]{1,15})/.exec(s);
  if (!head) return null;

  const magnitude = swiftAmount(head[5]);
  if ((magnitude === null || magnitude === undefined)) return null;

  // The remainder: an optional 4-character transaction type code, then the
  // bank's reference. Both groups here are bounded, so this pattern is linear.
  const rest = s.slice(head[0].length);
  const tail = /^([A-Z][A-Z0-9]{3})?([\s\S]*)$/.exec(rest) || [rest, null, rest];

  const mark = head[3];
  const isCredit = mark === "C" || mark === "RD";      // RD = reversal of a debit = money in
  const signed = isCredit ? magnitude : -magnitude;

  const valueDate = swiftDate(head[1]);
  let bookingDate = valueDate;
  if (head[2] && valueDate) {
    // Entry date carries MMDD only; it borrows the value date's year, stepping
    // back one when the statement straddles a year end (value 02 Jan, entry 31 Dec).
    const year = Number(valueDate.slice(0, 4));
    const mm = Number(head[2].slice(0, 2));
    const dd = Number(head[2].slice(2, 4));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const vMonth = Number(valueDate.slice(5, 7));
      const useYear = vMonth === 1 && mm === 12 ? year - 1 : year;
      bookingDate = `${useYear}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  // The reference field is `ourRef//bankRef`; the bank's own side is the one
  // worth matching on because it is what appears on their advices.
  const refField = (tail[2] || "").trim();
  const [ownRef, bankRef] = refField.split("//");

  return {
    booking_date: bookingDate,
    value_date: valueDate,
    amount: signed,
    transaction_type: tail[1] || null,
    external_ref: (bankRef || ownRef || "").trim() || null,
    is_reversal: mark === "RC" || mark === "RD",
  };
}

/**
 * Split the message into `{ tag, body }` records. A line not starting with a
 * tag continues the previous one - which is how :86: narratives, the most
 * useful field for matching, are always laid out.
 */
function tagged(text) {
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    // `trimEnd()` rather than a `/\s+$/` replace: the regex form is the
    // textbook polynomial-ReDoS shape (CodeQL js/polynomial-redos) because the
    // engine re-scans the trailing run from every start position, and a
    // statement file is untrusted input. The built-in is linear.
    const line = rawLine.trimEnd();
    if (line === "-}" || line === "-") continue;
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
    if (m) out.push({ tag: m[1], body: m[2] });
    else if (out.length) out[out.length - 1].body += ` ${line.trim()}`;
    if (out.length > MAX_LINES * 3) break;
  }
  return out;
}

function parse(buffer) {
  // MT940 is ASCII/latin-1 by specification; utf8 decoding of a latin-1 accent
  // would corrupt a narrative, and narratives are matched on.
  const text = Buffer.isBuffer(buffer) ? buffer.toString("latin1") : String(buffer);
  const fields = tagged(text);

  const rows = [];
  const meta = {
    format: "MT940", canonical: true,
    account: null, statement_number: null,
    opening_balance: null, closing_balance: null,
    period_start: null, period_end: null, currency: null,
  };

  let current = null;
  const flush = () => { if (current) { current.__row = rows.length + 1; rows.push(current); current = null; } };

  for (const { tag, body } of fields) {
    switch (tag) {
      case "25": meta.account = body.trim(); break;
      case "28C": meta.statement_number = body.trim(); break;
      case "60F": case "60M": {
        const b = parseBalance(body);
        if (b && (meta.opening_balance === null || meta.opening_balance === undefined)) {
          meta.opening_balance = b.amount; meta.period_start = b.date; meta.currency = b.currency;
        }
        break;
      }
      case "62F": case "62M": {
        const b = parseBalance(body);
        if (b) { meta.closing_balance = b.amount; meta.period_end = b.date; meta.currency = meta.currency || b.currency; }
        break;
      }
      case "61": {
        flush();
        const l = parseLine61(body);
        if (l) {
          current = {
            ...l, currency: meta.currency, description: null, counterparty: null,
            cheque_no: null, running_balance: null, fee: 0,
          };
        }
        break;
      }
      case "86": {
        if (current) {
          const narrative = body.trim();
          current.description = narrative;
          // Structured :86: subfields (?20..?29 narrative, ?32 counterparty
          // name) when the bank sends them; free text when it does not.
          const name = /\?3[23]([^?]{2,})/.exec(narrative);
          if (name) current.counterparty = name[1].trim();
          const chq = /\b(?:CHQ|CHEQUE|CHECK)[\s.:#-]*(\d{4,})/i.exec(narrative);
          if (chq) current.cheque_no = chq[1];
        }
        break;
      }
      default: break;
    }
    if (rows.length >= MAX_LINES) break;
  }
  flush();

  return {
    headers: Object.keys(rows[0] || {}).filter((k) => k !== "__row"),
    rows,
    meta,
  };
}

module.exports = { parse, parseLine61, parseBalance, swiftDate, swiftAmount, tagged };
