"use strict";

/**
 * The financial dictionary's price, codes and carrier rates against a real
 * schema (tenant review "meeting 5", 21 Sep 2026):
 *
 *   - a price typed in the create wizard becomes the item's STANDARD expense
 *     rate, and every read (get, list, search, costing's hand-picked line)
 *     reports that rate as `default_price` — the column is never written;
 *   - changing an item's direction moves its code to the new letter's lowest
 *     free number, and the number it gave back is the next one minted;
 *   - "apply to all carriers" supersedes every ticked carrier's series in one
 *     transaction, and one refusal saves none of them.
 *
 * The service commits its own transactions, so the rows it makes are removed
 * afterwards. Runs only with DATABASE_URL pointing at a provisioned tenant;
 * self-skips otherwise, like every suite in this directory.
 */

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("Financial dictionary: standard rate, re-lettered codes, apply to carriers", () => {
  let pool;
  let c;
  const made = [];
  const svc = require("../../src/modules/master/financial_dictionary/financial_dictionary.service");
  const costing = require("../../src/modules/costing/costing/costing.suggest");
  const actor = { user_id: null };
  const rule = [{ applies_context: "purchase", debit_account: "4731", credit_account: "4011" }];
  const one = async (sql, params) => (await c.query(sql, params)).rows[0];

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (!c) return;
    const ids = made.map((m) => m.dictionary_item_id);
    if (ids.length) {
      // The item goes first: its rates, rules and tiers cascade with it, and
      // deleting the rules on their own would trip the "no item without a
      // posting rule" guard (KB §23.14).
      await c.query("DELETE FROM dictionary_item WHERE dictionary_item_id = ANY($1::uuid[])", [ids]);
    }
    c.release();
    await pool.end();
  });

  test("a wizard price is the standard rate; the column stays empty; every read sees it", async () => {
    const item = await svc.create(c, {
      data: { label_fr: "frais essai prix", label_en: "price trial charge", category: "disbursement", direction: "DISBURSEMENT", default_price: 1500, posting_rules: rule },
      actor,
    });
    made.push(item);
    expect(item.label_en).toBe("Price Trial Charge");
    expect(item.label_fr).toBe("Frais Essai Prix");
    expect(Number(item.default_price)).toBe(1500);

    const raw = await one("SELECT default_price FROM dictionary_item WHERE dictionary_item_id = $1", [item.dictionary_item_id]);
    expect(raw.default_price).toBeNull();

    const std = await one(
      `SELECT rate FROM expense_rate WHERE dictionary_item_id = $1
          AND rate_provider_id IS NULL AND container_type_ref_id IS NULL AND effective_to IS NULL`,
      [item.dictionary_item_id],
    );
    expect(Number(std.rate)).toBe(1500);

    const hits = await svc.searchItems(c, { q: "Price Trial Charge" });
    expect(Number(hits.find((h) => h.dictionary_item_id === item.dictionary_item_id).default_price)).toBe(1500);

    const priced = await costing.priceOne(c, { dictionaryItemId: item.dictionary_item_id });
    expect(priced.unit_cost).toBe(1500);
    expect(priced.price_source).toBe("EXPENSE_RATE");

    // An edit cannot carry a price: the service no longer writes the column.
    await svc.update(c, { id: item.dictionary_item_id, patch: { default_price: 9, description: "x" }, actor });
    const after = await one("SELECT default_price FROM dictionary_item WHERE dictionary_item_id = $1", [item.dictionary_item_id]);
    expect(after.default_price).toBeNull();
  });

  test("a direction change re-letters the code, and the freed number is minted next", async () => {
    const a = await svc.create(c, {
      data: { label_fr: "essai recodage", category: "disbursement", direction: "DISBURSEMENT", posting_rules: rule },
      actor,
    });
    made.push(a);
    expect(a.code).toMatch(/^#D\d{3,}$/);

    const moved = await svc.update(c, {
      id: a.dictionary_item_id,
      patch: { direction: "EXPENSE", category: "overhead", posting_rules: [{ applies_context: "purchase", debit_account: "6051", credit_account: "4011" }] },
      actor,
    });
    expect(moved.code).toMatch(/^#E\d{3,}$/);

    const b = await svc.create(c, {
      data: { label_fr: "essai numero libere", category: "disbursement", direction: "DISBURSEMENT", posting_rules: rule },
      actor,
    });
    made.push(b);
    expect(b.code).toBe(a.code);
  });

  test("apply-to-carriers supersedes every ticked series, all or nothing", async () => {
    const item = await svc.create(c, {
      data: { label_fr: "essai transporteurs", category: "disbursement", direction: "DISBURSEMENT", posting_rules: rule },
      actor,
    });
    made.push(item);
    const { rows } = await c.query(
      "SELECT rate_provider_id FROM rate_provider WHERE kind = 'SHIPPING_LINE' AND is_active IS DISTINCT FROM false ORDER BY name LIMIT 3",
    );
    const ids = rows.map((r) => r.rate_provider_id);
    if (ids.length < 2) return; // a tenant with fewer than two carriers has nothing to apply across

    const first = await svc.applyRateToProviders(c, { id: item.dictionary_item_id, data: { rate: 72700, effective_from: "2030-01-01", rate_provider_ids: ids }, actor });
    expect(first.applied).toBe(ids.length);

    const second = await svc.applyRateToProviders(c, { id: item.dictionary_item_id, data: { rate: 72500, effective_from: "2030-02-01", rate_provider_ids: ids }, actor });
    expect(second.applied).toBe(ids.length);
    const expired = await one(
      "SELECT count(*)::int AS n FROM expense_rate WHERE dictionary_item_id = $1 AND effective_to = '2030-01-31'",
      [item.dictionary_item_id],
    );
    expect(expired.n).toBe(ids.length);

    // The LAST carrier already has a later rate, so the ones before it would
    // succeed on their own — and still nothing is written for any of them.
    await svc.supersedeRate(c, { id: item.dictionary_item_id, data: { rate: 1, effective_from: "2030-06-01", rate_provider_id: ids[ids.length - 1] }, actor });
    const before = await one("SELECT count(*)::int AS n FROM expense_rate WHERE dictionary_item_id = $1", [item.dictionary_item_id]);
    await expect(
      svc.applyRateToProviders(c, { id: item.dictionary_item_id, data: { rate: 2, effective_from: "2030-03-01", rate_provider_ids: ids }, actor }),
    ).rejects.toMatchObject({ status: 422 });
    const afterRefusal = await one("SELECT count(*)::int AS n FROM expense_rate WHERE dictionary_item_id = $1", [item.dictionary_item_id]);
    expect(afterRefusal.n).toBe(before.n);
  });

  test("the seed's SQL title case and the service's JS title case agree", async () => {
    // Loaded from the seed file itself, so the test runs the SQL that ships.
    const fs = require("fs");
    const path = require("path");
    const { titleCase } = require("../../src/modules/master/financial_dictionary/financial_dictionary.rules");
    const seed = fs.readFileSync(path.join(__dirname, "../../migrations/seeds/90995_dictionary_meeting5_cleanup.sql"), "utf8");
    const fn = /CREATE OR REPLACE FUNCTION pg_temp\.praxis_title_case[\s\S]*?END \$\$;/.exec(seed);
    expect(fn).not.toBeNull();
    await c.query(fn[0]);
    const cases = [
      ["frais de dossier", "fr"], ["Frais De Dossier", "fr"],
      ["frais d'agence et de documentation", "fr"], ["commissions sur débours", "fr"],
      ["transport — pour compte client", "fr"], ["l'entrepôt", "fr"],
      ["frais DE ligne THC (pdf)", "fr"], ["à la charge du client", "fr"], ["porte-à-porte", "fr"],
      ["commission on disbursements", "en"], ["THC per box", "en"], ["type A container", "en"],
      ["air waybill (awb) fee", "en"], ["last-mile / port exit", "en"], ["the end of the line", "en"],
      ["bank caution — deposit", "en"], ["IT equipment & hardware", "en"],
    ];
    for (const [label, lang] of cases) {
      const { rows } = await c.query("SELECT pg_temp.praxis_title_case($1, $2) AS t", [label, lang]);
      expect([label, rows[0].t]).toEqual([label, titleCase(label, lang)]);
    }
  });
});
