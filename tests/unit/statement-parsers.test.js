/**
 * Statement source adapters + column mapping.
 *
 * The adapters are tested against files shaped like the ones CEMAC institutions
 * actually emit: semicolon-delimited francophone CSV with comma decimals and a
 * preamble above the header, an Excel export with a cover sheet, and the two
 * self-describing SWIFT/ISO formats.
 *
 * The mapping tests are the ones that guard the promise this module makes —
 * that a column layout is worked out once, checked against the data, and never
 * silently guessed.
 */
"use strict";

const ExcelJS = require("exceljs");
const statements = require("../../src/services/statements");
const csv = require("../../src/services/statements/csv");
const camt053 = require("../../src/services/statements/camt053");
const mt940 = require("../../src/services/statements/mt940");
const mapping = require("../../src/modules/master/reconciliation/reconciliation.mapping");
const rules = require("../../src/modules/master/reconciliation/reconciliation.rules");

/** A francophone bank export: preamble, `;` delimiter, comma decimals. */
const FR_CSV = [
  "RELEVE DE COMPTE",
  "Compte 521101 - Periode du 01/04/2026 au 30/04/2026",
  "",
  "Date d'operation;Libelle;Debit;Credit;Solde",
  "03/04/2026;VIR RECU DUPONT SARL;;250 000,00;1 250 000,00",
  '05/04/2026;"FRAIS, tenue de compte";5 000,00;;1 245 000,00',
  "12/04/2026;CHEQUE 445120 FOURNISSEUR;12 000,00;;1 233 000,00",
].join("\n");

/** A mobile-money merchant export: signed amounts, a separate fee, a strong id. */
const MOMO_CSV = [
  "Date,Type,Amount,Fee,Balance,Financial Transaction Id,Payer Number",
  "2026-04-03,DEPOSIT,150000.00,0.00,150000.00,FT26094AA01,+237670000001",
  "2026-04-04,PAYMENT,-42000.00,210.00,107790.00,FT26094AA02,+237670000002",
].join("\n");

describe("format detection reads the bytes, not the filename", () => {
  it("detects each format", () => {
    expect(statements.detect(Buffer.from(FR_CSV), "x.csv")).toBe("CSV");
    expect(statements.detect(Buffer.from("%PDF-1.7\n..."), "x.txt")).toBe("PDF");
    expect(statements.detect(Buffer.from('<?xml version="1.0"?><Document><BkToCstmrStmt/></Document>'), "x.dat")).toBe("CAMT053");
    expect(statements.detect(Buffer.from(":20:REF\n:25:ACC\n:60F:C260401XAF0,00\n"), "x.txt")).toBe("MT940");
  });

  it("names the problem when handed a legacy .xls", () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => statements.detect(ole, "s.xls")).toThrow(/re-save as \.xlsx/i);
  });

  it("refuses an empty upload", () => {
    expect(() => statements.detect(Buffer.alloc(0), "s.csv")).toThrow(/empty/i);
  });
});

describe("CSV parser", () => {
  it("sniffs a semicolon delimiter rather than assuming a comma", () => {
    expect(csv.parse(Buffer.from(FR_CSV)).meta.delimiter).toBe(";");
  });

  it("finds the real header under a preamble, and keeps the preamble", () => {
    const r = csv.parse(Buffer.from(FR_CSV));
    expect(r.headers).toEqual(["Date d'operation", "Libelle", "Debit", "Credit", "Solde"]);
    expect(r.meta.header_row_index).toBe(4);
    expect(r.meta.preamble[0]).toMatch(/RELEVE DE COMPTE/);
  });

  it("honours RFC 4180 quoting, so a comma inside a narrative is not a column", () => {
    expect(csv.parse(Buffer.from(FR_CSV)).rows[1].Libelle).toBe("FRAIS, tenue de compte");
  });

  it("detects a Windows-1252 file instead of mangling its accents", () => {
    expect(csv.decode(Buffer.from("Libell\xe9", "latin1")).encoding).toBe("windows-1252");
    expect(csv.decode(Buffer.from("﻿Date", "utf8")).encoding).toBe("utf-8-bom");
  });

  it("reports the source line number so an error points into the user's file", () => {
    expect(csv.parse(Buffer.from(FR_CSV)).rows[0].__row).toBe(5);
  });
});

describe("XLSX parser", () => {
  const build = async () => {
    const wb = new ExcelJS.Workbook();
    const cover = wb.addWorksheet("Cover");
    cover.addRow(["Bank X"]);
    const ws = wb.addWorksheet("Transactions");
    ws.addRow(["RELEVE DE COMPTE"]);
    ws.addRow(["Compte", "521101"]);
    ws.addRow([]);
    ws.addRow(["Date", "Libelle", "Debit", "Credit"]);
    ws.addRow([new Date(Date.UTC(2026, 3, 3)), "VIR RECU DUPONT", null, 250000]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  it("picks the sheet with the data, not the first sheet", async () => {
    const r = await statements.parse(await build(), { filename: "s.xlsx" });
    expect(r.meta.sheet).toBe("Transactions");
  });

  it("keeps typed cells typed — which removes the date and number ambiguity entirely", async () => {
    const r = await statements.parse(await build(), { filename: "s.xlsx" });
    expect(r.rows[0].Date).toBeInstanceOf(Date);
    expect(typeof r.rows[0].Credit).toBe("number");
  });
});

describe("camt.053 — self-describing, so no mapping is needed", () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
 <Id>STMT-2026-04</Id>
 <Acct><Id><IBAN>CM21100010000521101000000199</IBAN></Id><Ccy>XAF</Ccy></Acct>
 <FrToDt><FrDtTm>2026-04-01T00:00:00</FrDtTm><ToDtTm>2026-04-30T23:59:59</ToDtTm></FrToDt>
 <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="XAF">1000000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
 <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="XAF">1245000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Bal>
 <Ntry><Amt Ccy="XAF">250000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-04-03</Dt></BookgDt>
  <AddtlNtryInf>VIR RECU DUPONT SARL</AddtlNtryInf>
  <NtryDtls><TxDtls><Refs><EndToEndId>FT26094XYZ12</EndToEndId></Refs>
   <RltdPties><Dbtr><Nm>DUPONT SARL</Nm></Dbtr></RltdPties></TxDtls></NtryDtls></Ntry>
 <Ntry><Amt Ccy="XAF">5000.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-04-05</Dt></BookgDt>
  <AddtlNtryInf>FRAIS TENUE DE COMPTE</AddtlNtryInf></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

  it("reads balances, period and the explicit debit/credit indicator", () => {
    const r = camt053.parse(Buffer.from(XML));
    expect(r.meta.opening_balance).toBe(1000000);
    expect(r.meta.closing_balance).toBe(1245000);
    expect(r.meta.period_start).toBe("2026-04-01");
    expect(r.rows.map((x) => x.amount)).toEqual([250000, -5000]);
    expect(r.rows[0].external_ref).toBe("FT26094XYZ12");
    expect(r.rows[0].counterparty).toBe("DUPONT SARL");
  });

  it("produces a statement that foots by construction", () => {
    const r = camt053.parse(Buffer.from(XML));
    expect(rules.checkFooting({
      openingBalance: r.meta.opening_balance, closingBalance: r.meta.closing_balance, lines: r.rows,
    }).foots).toBe(true);
  });

  /**
   * The file is untrusted input. The scanner has no code path that resolves an
   * entity, so a DOCTYPE declaring one is inert rather than expanded.
   */
  it("does not expand external entities", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE f [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<Document><BkToCstmrStmt><Stmt><Id>&xxe;</Id>
<Ntry><Amt Ccy="XAF">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-04-03</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
    const r = camt053.parse(Buffer.from(xxe));
    expect(r.meta.statement_id).toBe("&xxe;");
    expect(JSON.stringify(r)).not.toMatch(/root:/);
  });
});

describe("MT940", () => {
  const MSG = [
    ":20:STMT2604", ":25:10001-00052110100-19", ":28C:00004/001",
    ":60F:C260401XAF1000000,00",
    ":61:2604030403C250000,00NTRFFT26094XYZ12//BK99001",
    ":86:VIR RECU DUPONT SARL ?32DUPONT SARL",
    ":61:260405D5000,00NCHGFRAIS//BK99002",
    ":86:FRAIS TENUE DE COMPTE",
    ":61:260406RC12000,00NTRFRETOUR//BK99003",
    ":86:CHEQUE IMPAYE CHQ 445120",
    ":62F:C260430XAF1233000,00", "-",
  ].join("\r\n");

  it("reads balances and the D/C letter", () => {
    const r = mt940.parse(Buffer.from(MSG, "latin1"));
    expect(r.meta.opening_balance).toBe(1000000);
    expect(r.meta.closing_balance).toBe(1233000);
    expect(r.rows[0].amount).toBe(250000);
    expect(r.rows[1].amount).toBe(-5000);
  });

  /**
   * `RC` is a REVERSED CREDIT — money leaving. Read as a plain credit it turns
   * a returned cheque into a second receipt.
   */
  it("flips the sign on a reversal", () => {
    const r = mt940.parse(Buffer.from(MSG, "latin1"));
    expect(r.rows[2].amount).toBe(-12000);
    expect(r.rows[2].is_reversal).toBe(true);
  });

  it("pulls the counterparty and cheque number out of the :86: narrative", () => {
    const r = mt940.parse(Buffer.from(MSG, "latin1"));
    expect(r.rows[0].counterparty).toBe("DUPONT SARL");
    expect(r.rows[2].cheque_no).toBe("445120");
  });

  it("foots", () => {
    const r = mt940.parse(Buffer.from(MSG, "latin1"));
    expect(rules.checkFooting({
      openingBalance: r.meta.opening_balance, closingBalance: r.meta.closing_balance, lines: r.rows,
    }).foots).toBe(true);
  });
});

/**
 * A statement file is untrusted input — anyone who can hand the treasurer a
 * file can hand this parser one. Both patterns below were flagged by CodeQL as
 * polynomial ReDoS (js/polynomial-redos) and both were reproducible:
 *
 *   :61: amount run   4,000 commas 15ms -> 12,000 commas 174ms   (quadratic)
 *   /\s+$/ line trim   100,000 spaces took 8.1 SECONDS; 400,000 did not finish
 *
 * The budgets here are deliberately loose — this asserts the growth curve is
 * gone, not a particular machine's speed. Under the old code the second case
 * alone would blow the 15s Jest timeout.
 */
describe("hostile statement files cannot hang the parser", () => {
  it("does not degrade on a long run of commas where the amount should be", () => {
    const started = Date.now();
    for (const n of [4000, 12000, 40000]) {
      // The newline matters: it is what made the old pattern's trailing `(.*)$`
      // fail and re-split the ambiguous amount run from every position.
      expect(mt940.parseLine61(`260403C${",".repeat(n)}\nX`)).toBeNull();
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("does not degrade on a line that is almost entirely trailing whitespace", () => {
    const started = Date.now();
    for (const n of [100000, 400000]) {
      expect(mt940.tagged(`:86:X${" ".repeat(n)}`)).toHaveLength(1);
    }
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("still reads a well-formed line exactly as before the hardening", () => {
    const line = mt940.parseLine61("2604030403C250000,00NTRFFT26094XYZ12//BK99001");
    expect(line).toMatchObject({
      booking_date: "2026-04-03",
      value_date: "2026-04-03",
      amount: 250000,
      transaction_type: "NTRF",
      external_ref: "BK99001",
      is_reversal: false,
    });
  });
});

describe("column mapping", () => {
  const propose = async (buf) => {
    const parsed = await statements.parse(buf, { filename: "s.csv" });
    // useModel:false — the heuristic and evidence layers must stand alone, and
    // the test must not depend on an AI provider being configured.
    const proposal = await mapping.proposeProfile(null, {
      headers: parsed.headers, rows: parsed.rows, useModel: false,
    });
    return { parsed, proposal };
  };

  it("maps a francophone debit/credit layout without help", async () => {
    const { proposal } = await propose(Buffer.from(FR_CSV));
    expect(proposal.profile.column_map).toMatchObject({
      booking_date: "Date d'operation", description: "Libelle", debit: "Debit", credit: "Credit", running_balance: "Solde",
    });
    expect(proposal.profile.sign_convention).toBe("DEBIT_CREDIT_COLUMNS");
    expect(proposal.profile.decimal_separator).toBe(",");
    expect(proposal.verification.ok).toBe(true);
  });

  it("maps a mobile-money layout, including the fee and the transaction id", async () => {
    const { proposal } = await propose(Buffer.from(MOMO_CSV));
    expect(proposal.profile.column_map).toMatchObject({
      amount: "Amount", fee: "Fee", external_ref: "Financial Transaction Id", counterparty: "Payer Number",
    });
    expect(proposal.profile.decimal_separator).toBe(".");
  });

  /**
   * The regression that footing caught during development. `Type` matches the
   * direction synonyms, so a purely structural reading picks an indicator
   * convention and applies a magnitude-plus-marker rule to a column that
   * already carries its own sign — turning a 42,000 payment into a 42,000
   * receipt. The data has to outrank the header.
   */
  it("prefers a signed amount column over a direction column that names it", async () => {
    const { parsed, proposal } = await propose(Buffer.from(MOMO_CSV));
    expect(proposal.profile.sign_convention).toBe("SIGNED_AMOUNT");
    const { rows } = mapping.applyMap(parsed.rows, proposal.profile);
    expect(rows[1].amount).toBe(-42000);
    expect(rows[1].fee).toBe(210);
  });

  it("turns a debit column into a negative movement whether or not it is signed", async () => {
    const { parsed, proposal } = await propose(Buffer.from(FR_CSV));
    const { rows } = mapping.applyMap(parsed.rows, proposal.profile);
    expect(rows.map((r) => r.amount)).toEqual([250000, -5000, -12000]);
  });

  it("rejects a map whose date column does not hold dates", () => {
    const rows = [{ A: "hello", B: "1000" }, { A: "world", B: "2000" }];
    const v = mapping.verifyMap({ booking_date: "A", amount: "B" }, rows);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/Booking date/i);
  });

  it("rejects a map whose amount column does not hold numbers", () => {
    const rows = [{ A: "03/04/2026", B: "not money" }, { A: "04/04/2026", B: "also not" }];
    const v = mapping.verifyMap({ booking_date: "A", amount: "B" }, rows);
    expect(v.ok).toBe(false);
  });

  it("rejects a debit/credit pair that is populated on both sides", () => {
    const rows = Array.from({ length: 10 }, () => ({ A: "03/04/2026", D: "100,00", C: "200,00" }));
    const v = mapping.verifyMap({ booking_date: "A", debit: "D", credit: "C" }, rows);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/BOTH the debit and the credit/i);
  });

  it("insists on a date and an amount", () => {
    expect(mapping.verifyMap({}, []).errors).toHaveLength(2);
  });

  it("keeps unusable rows visible instead of dropping them silently", async () => {
    const withJunk = `${FR_CSV}\nTOTAL;;17 000,00;250 000,00;`;
    const { parsed, proposal } = await propose(Buffer.from(withJunk));
    const { rows, rejected } = mapping.applyMap(parsed.rows, proposal.profile);
    expect(rows).toHaveLength(3);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reasons).toContain("no parsable date");
  });

  it("produces a header signature that survives a re-export with different casing", async () => {
    const shouty = FR_CSV.replace("Date d'operation;Libelle;Debit;Credit;Solde", "DATE D'OPERATION;LIBELLE;DEBIT;CREDIT;SOLDE");
    const a = await propose(Buffer.from(FR_CSV));
    const b = await propose(Buffer.from(shouty));
    expect(a.proposal.profile.header_signature).toBe(b.proposal.profile.header_signature);
  });
});
