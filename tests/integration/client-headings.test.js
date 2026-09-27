"use strict";

/**
 * Client headings against a real schema (PR 2, tenant review "meeting 5"):
 *
 *   - the starter headings are seeded and the catalogue is mapped to them;
 *   - a dictionary line's heading must be an active CLIENT_HEADING (the rule the
 *     plain uuid column cannot enforce itself, 13791);
 *   - a quotation keeps its DETAILED lines — with the pricer's overrides — and
 *     the print payload carries each line's heading beside it, for the
 *     template to group at render time;
 *   - the Spend tab can be narrowed to one operations file.
 *
 * Commits (the services own their transactions), so everything made here is
 * removed afterwards. Runs only with DATABASE_URL pointing at a provisioned
 * tenant; self-skips otherwise, like every suite in this directory.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Client headings: seeded, validated, carried on the quotation, grouped at print", () => {
  let pool;
  let c;
  const items = [];
  const quotations = [];
  const dict = require("../../src/modules/master/financial_dictionary/financial_dictionary.service");
  const quotation = require("../../src/modules/commercial/quotation/quotation.service");
  const templates = require("../../src/modules/documents/template/template.service");
  const { groupLines } = require("../../src/services/documents/templates/client-headings");
  const actor = { user_id: null };
  const rule = [{ applies_context: "purchase", debit_account: "4731", credit_account: "4011" }];

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (!c) return;
    if (quotations.length) await c.query("DELETE FROM quotation WHERE quotation_id = ANY($1::uuid[])", [quotations]);
    if (items.length) await c.query("DELETE FROM dictionary_item WHERE dictionary_item_id = ANY($1::uuid[])", [items]);
    c.release();
    await pool.end();
  });

  const heading = async (code) =>
    (await c.query("SELECT ref_id FROM dictionary_ref WHERE kind = 'CLIENT_HEADING' AND code = $1", [code])).rows[0];

  test("the starter headings are seeded and operational lines are mapped", async () => {
    const { rows } = await c.query("SELECT code FROM dictionary_ref WHERE kind = 'CLIENT_HEADING'");
    expect(rows.map((r) => r.code)).toEqual(expect.arrayContaining(["CUSTOMS_FORMALITIES", "PORT_TERMINAL", "OTHER"]));
    const unmapped = await c.query(
      `SELECT count(*)::int AS n FROM dictionary_item
        WHERE client_heading_ref_id IS NULL AND applicability_mode IS DISTINCT FROM 'NON_OPERATIONAL'
          AND created_at < now() - interval '1 second'`,
    );
    expect(unmapped.rows[0].n).toBe(0);
  });

  test("a dictionary line's heading must be an active client heading", async () => {
    const customs = await heading("CUSTOMS_FORMALITIES");
    const made = await dict.create(c, {
      data: { label_fr: "essai famille", category: "disbursement", direction: "DISBURSEMENT", client_heading_ref_id: customs.ref_id, posting_rules: rule },
      actor,
    });
    items.push(made.dictionary_item_id);
    expect(made.client_heading_en).toBe("Customs Formalities");

    const unit = (await c.query("SELECT ref_id FROM dictionary_ref WHERE kind = 'UNIT' LIMIT 1")).rows[0];
    await expect(
      dict.update(c, { id: made.dictionary_item_id, patch: { client_heading_ref_id: unit.ref_id }, actor }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("a quotation stores detailed lines with overrides; the print payload carries the headings", async () => {
    const customs = await heading("CUSTOMS_FORMALITIES");
    const item = await dict.create(c, {
      data: { label_fr: "droits essai", category: "disbursement", direction: "DISBURSEMENT", client_heading_ref_id: customs.ref_id, posting_rules: rule },
      actor,
    });
    items.push(item.dictionary_item_id);
    const q = await quotation.createDraft(c, {
      data: {
        lines: [
          { dictionary_item_id: item.dictionary_item_id, label: "Duties", qty: 1, unit_price: 300000, is_disbursement: true },
          { dictionary_item_id: item.dictionary_item_id, label: "Gate pass", qty: 1, unit_price: 5000, is_disbursement: true },
          { label: "Leg to Bangui", qty: 1, unit_price: 900000, is_disbursement: true, client_heading: "DAP Douala–Bangui" },
        ],
      },
      actor,
    });
    quotations.push(q.quotation_id);
    // Stored detailed: three lines, the override on the third.
    const stored = await c.query("SELECT label, client_heading FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no", [q.quotation_id]);
    expect(stored.rows).toEqual([
      { label: "Duties", client_heading: null },
      { label: "Gate pass", client_heading: null },
      { label: "Leg to Bangui", client_heading: "DAP Douala–Bangui" },
    ]);
    // The payload the signature hashes still has the three lines…
    const rec = await templates.loadRecord(c, "QUOTATION", q.quotation_id);
    expect(rec.data.lines).toHaveLength(3);
    expect(rec.data.lines[0]).toMatchObject({ client_heading_code: "CUSTOMS_FORMALITIES", is_disbursement: true });
    // …and the page prints two families.
    const printed = groupLines(rec.data.lines, "en", rec.data.client_headings);
    expect(printed.map((l) => [l.label, l.amount])).toEqual([
      ["Customs Formalities", 305000],
      ["DAP Douala–Bangui", 900000],
    ]);
  });

  test("Spend can be narrowed to one operations file", async () => {
    const id = items[0];
    const all = await dict.spend(c, id, {});
    const none = await dict.spend(c, id, { dossier_id: "00000000-0000-0000-0000-000000000000" });
    expect(none.dossier_id).toBe("00000000-0000-0000-0000-000000000000");
    expect(none.totals.estimated).toBe(0);
    expect(all.totals.estimated).toBeGreaterThanOrEqual(0);
  });
});
