"use strict";
/**
 * DB-backed proof of the ledger posting engine against the real Postgres triggers
 * in migrations/tenant/0220_ledger.sql. Skipped unless DATABASE_URL points at a
 * database with the tenant schema migrated and seeded (a provisioned tenant DB).
 *
 * Env it needs:
 *   DATABASE_URL   postgres connection string (search_path = the tenant schema)
 *   TEST_ENTITY_ID a corporate_entity id with an OPEN accounting_period covering
 *                  TEST_ENTRY_DATE, and journal 'BQ' seeded.
 *
 * Run in CI by adding a postgres service + `db:provision`, then set these vars.
 *
 * ACCOUNTS: 5211 and 4191, both `is_postable = true` in 9000_seed_coa.sql.
 * This used to post to 521, which is the PARENT ('Banques locales',
 * is_postable=false) — 5211 'Banque principale' is the leaf. The service refused
 * it with "account 521 is not postable (KB §23.3)", which is the rule working.
 * Worth noticing what that did to the second test: it asserts only that the post
 * REJECTS, so it passed on the not-postable error and never once reached the
 * balance check it exists to prove. A negative test that cannot say WHY it
 * failed will happily pass for the wrong reason.
 */
const hasDb = !!process.env.DATABASE_URL && !!process.env.TEST_ENTITY_ID;
const d = hasDb ? describe : describe.skip;

d("ledger posting (real Postgres)", () => {
  let pool; let service; let entityId; let date;
  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    service = require("../../src/modules/finance/journal_entry/journal_entry.service");
    entityId = process.env.TEST_ENTITY_ID;
    date = process.env.TEST_ENTRY_DATE || new Date().toISOString().slice(0, 10);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  const withClient = async (fn) => {
    const c = await pool.connect();
    try { return await fn(c); } finally { c.release(); }
  };

  it("posts a balanced validated entry and reads it back with lines", async () => {
    const { entry } = await withClient((c) => service.post(c, {
      journalCode: "BQ", entityId, entryDate: date, sourceDocRef: "test:doc",
      lines: [ { account_code: "5211", debit: 1000, credit: 0 }, { account_code: "4191", debit: 0, credit: 1000 } ],
      actor: { user_id: null },
    }));
    expect(entry.status).toBe("validated");
    const full = await withClient((c) => service.get(c, entry.entry_id));
    expect(full.lines).toHaveLength(2);
  });

  it("rejects an unbalanced entry at the database", async () => {
    await expect(withClient((c) => service.post(c, {
      journalCode: "BQ", entityId, entryDate: date, sourceDocRef: "test:doc",
      lines: [ { account_code: "5211", debit: 1000, credit: 0 }, { account_code: "4191", debit: 0, credit: 1 } ],
      actor: { user_id: null },
      // `/Out of balance/`, not a bare `.toThrow()`. A bare one asserts only
      // that SOMETHING failed, which is how this test spent its whole life
      // passing on "account 521 is not postable" without ever reaching the
      // balance check. Naming the message is what makes the pass mean the thing
      // the test is called after (§23.1, ENTRY_UNBALANCED).
    }))).rejects.toThrow(/Out of balance/i);
  });
});
