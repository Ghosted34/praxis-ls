/**
 * ISO 20022 camt.053 (Bank-to-Customer Statement) parser.
 *
 * WHY THIS FORMAT MATTERS despite being rare in CEMAC today: it needs NO column
 * map and NO locale detection. Amounts carry their currency as an attribute,
 * dates are ISO 8601, and the debit/credit indicator is an explicit `CdtDbtInd`
 * element rather than a convention to be inferred. Everything §3 and §4 of
 * reconciliation.rules.js exist to disambiguate is simply stated in the file.
 *
 * So the moment a bank with an international parent switches on corporate cash
 * management, the tenant gets exact ingestion with zero setup. The parser is
 * small; the option is worth having ready.
 *
 * NO GENERAL XML PARSER, AND THAT IS A SECURITY DECISION, NOT A DEPENDENCY ONE.
 * A statement file is untrusted input. Handing untrusted XML to a full parser
 * opens XXE (external entity expansion reading local files) and billion-laughs
 * entity expansion. This is a scanner: it walks the byte stream for the handful
 * of element names camt.053 defines, and there is no code path that resolves an
 * entity, fetches a URL, or follows a DOCTYPE. A DTD, if present, is skipped
 * unread.
 */
"use strict";

const MAX_ENTRIES = 20000;

/** Undo the five predefined XML entities. Nothing else is expanded, ever. */
function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");                     // last, so &amp;lt; stays literal
}

/** Strip a namespace prefix: "ns:Stmt" -> "Stmt". */
const local = (name) => {
  const i = name.indexOf(":");
  return i === -1 ? name : name.slice(i + 1);
};

/**
 * Slice out every top-level occurrence of <tag>...</tag>, nesting-aware.
 * Returns the inner text of each. Self-closing tags yield "".
 */
function blocks(xml, tag) {
  const out = [];
  const open = new RegExp(`<(?:[\\w.-]+:)?${tag}(\\s[^>]*?)?(/)?>`, "g");
  const close = new RegExp(`</(?:[\\w.-]+:)?${tag}\\s*>`, "g");
  let m;
  while ((m = open.exec(xml)) !== null) {
    if (m[2]) { out.push(""); continue; }                    // self-closing
    let depth = 1;
    let cursor = open.lastIndex;
    while (depth > 0) {
      open.lastIndex = cursor;
      close.lastIndex = cursor;
      const nextOpen = open.exec(xml);
      const nextClose = close.exec(xml);
      if (!nextClose) return out;
      if (nextOpen && nextOpen.index < nextClose.index && !nextOpen[2]) {
        depth += 1; cursor = open.lastIndex;
      } else {
        depth -= 1; cursor = close.lastIndex;
        if (depth === 0) out.push(xml.slice(m.index + m[0].length, nextClose.index));
      }
    }
    open.lastIndex = cursor;
    if (out.length > MAX_ENTRIES) break;
  }
  return out;
}

/** First <tag> inner text, searched at any depth. */
function first(xml, tag) {
  const m = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*?)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}\\s*>`).exec(xml);
  return m ? unescapeXml(m[1]).trim() : null;
}

/** An <Amt Ccy="XAF">1234.56</Amt> pair. */
function amountOf(xml, tag = "Amt") {
  const m = new RegExp(`<(?:[\\w.-]+:)?${tag}(\\s[^>]*?)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}\\s*>`).exec(xml);
  if (!m) return { amount: null, currency: null };
  const ccy = m[1] ? (/Ccy\s*=\s*"([^"]+)"/.exec(m[1]) || [])[1] : null;
  const n = Number(unescapeXml(m[2]).trim());
  return { amount: Number.isFinite(n) ? n : null, currency: ccy || null };
}

/** <Dt>2026-04-03</Dt> or <DtTm>2026-04-03T09:12:00</DtTm>. */
function dateOf(xml, tag) {
  const b = first(xml, tag);
  if ((b === null || b === undefined)) return null;
  const d = /(\d{4}-\d{2}-\d{2})/.exec(b);
  return d ? d[1] : null;
}

/**
 * A <Bal> block for a given ISO balance code. OPBD is the opening booked
 * balance and CLBD the closing booked balance - the two numbers the footing
 * check in §6 wants. Note the sign: camt.053 states balances as a magnitude
 * plus a CdtDbtInd, so a DBIT balance is an overdraft and must go negative.
 */
function balanceOf(xml, code) {
  for (const bal of blocks(xml, "Bal")) {
    const cd = first(bal, "Cd");
    if (cd !== code) continue;
    const { amount } = amountOf(bal);
    if ((amount === null || amount === undefined)) return null;
    return first(bal, "CdtDbtInd") === "DBIT" ? -amount : amount;
  }
  return null;
}

/**
 * Parse a camt.053 document into the same `{ headers, rows, meta }` shape the
 * tabular parsers return - deliberately, so downstream code has one contract.
 * Here `rows` are already canonical (§1 field names), which is why a profile
 * for this source kind carries no column_map.
 */
function parse(buffer) {
  const xml = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer);
  const statements = blocks(xml, "Stmt");
  const stmt = statements[0];
  if (!stmt) return { headers: [], rows: [], meta: { format: "CAMT053", error: "no <Stmt> element found" } };

  const acct = blocks(stmt, "Acct")[0] || "";
  const period = blocks(stmt, "FrToDt")[0] || "";

  const rows = [];
  for (const ntry of blocks(stmt, "Ntry")) {
    if (rows.length >= MAX_ENTRIES) break;
    const { amount, currency } = amountOf(ntry);
    if ((amount === null || amount === undefined)) continue;

    // The explicit indicator. CRDT is money in, which is our positive.
    const signed = first(ntry, "CdtDbtInd") === "DBIT" ? -amount : amount;

    // Narrative: <AddtlNtryInf> is the human line; the structured
    // <RmtInf><Ustrd> under the transaction detail is usually richer.
    const detail = blocks(ntry, "TxDtls")[0] || "";
    const remittance = blocks(detail, "RmtInf").map((r) => blocks(r, "Ustrd").join(" ")).join(" ").trim();
    const description = [first(ntry, "AddtlNtryInf"), remittance].filter(Boolean).join(" - ") || null;

    // Counterparty is whichever party is NOT us: for money in that is the
    // debtor, for money out the creditor.
    const parties = blocks(detail, "RltdPties")[0] || "";
    const counterparty = signed > 0
      ? first(blocks(parties, "Dbtr")[0] || "", "Nm")
      : first(blocks(parties, "Cdtr")[0] || "", "Nm");

    const refs = blocks(detail, "Refs")[0] || "";
    rows.push({
      __row: rows.length + 1,
      booking_date: dateOf(ntry, "BookgDt"),
      value_date: dateOf(ntry, "ValDt"),
      amount: signed,
      currency: currency || null,
      description,
      counterparty: counterparty || null,
      external_ref: first(refs, "EndToEndId") || first(refs, "TxId") || first(ntry, "AcctSvcrRef") || null,
      cheque_no: first(refs, "ChqNb") || null,
      running_balance: null,
      fee: (amountOf(blocks(ntry, "Chrgs")[0] || "", "Amt").amount) || 0,
      raw_status: first(ntry, "Sts"),
    });
  }

  return {
    headers: Object.keys(rows[0] || {}).filter((k) => k !== "__row"),
    rows,
    meta: {
      format: "CAMT053",
      canonical: true,                       // rows already speak §1; no map needed
      account_iban: first(acct, "IBAN"),
      account_other_id: first(blocks(acct, "Othr")[0] || "", "Id"),
      currency: first(acct, "Ccy"),
      period_start: dateOf(period, "FrDtTm") || first(period, "FrDt"),
      period_end: dateOf(period, "ToDtTm") || first(period, "ToDt"),
      opening_balance: balanceOf(stmt, "OPBD"),
      closing_balance: balanceOf(stmt, "CLBD"),
      statement_id: first(stmt, "Id"),
      statement_count: statements.length,
    },
  };
}

module.exports = { parse, blocks, first, unescapeXml, local };
