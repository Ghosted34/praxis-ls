"use strict";
/**
 * DB-backed proof that the 0464 hardening TRIGGERS fire — not just the app-layer
 * pre-checks. Each negative case builds the entry with RAW SQL (bypassing
 * journal_entry.rules) so the database itself is what rejects it. Skipped unless
 * DATABASE_URL points at a migrated+seeded tenant schema with an OPEN period.
 *
 *   DATABASE_URL    postgres connection string (search_path = tenant schema)
 *   TEST_ENTITY_ID  a corporate_entity with a journal + an OPEN period, and
 *                   postable accounts 521 / 4191 seeded.
 */
const hasDb = !!process.env.DATABASE_URL && !!process.env.TEST_ENTITY_ID;
const d = hasDb ? describe : describe.skip;

d("ledger hardening triggers (real Postgres)", () => {
  let pool;
  let service;
  let entityId;
  let journalId;
  let period; // { period_id, starts_on }

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    service = require("../../src/modules/finance/journal_entry/journal_entry.service");
    entityId = process.env.TEST_ENTITY_ID;
    const j = await pool.query("SELECT journal_id FROM journal WHERE entity_id = $1 LIMIT 1", [entityId]);
    journalId = j.rows[0] && j.rows[0].journal_id;
    const p = await pool.query(
      "SELECT period_id, starts_on, ends_on FROM accounting_period WHERE entity_id = $1 AND status = 'OPEN' ORDER BY starts_on DESC LIMIT 1",
      [entityId],
    );
    period = p.rows[0];

    // Fail on the MISSING FIXTURE, not on its symptom.
    //
    // Without this, an absent journal or period leaves `journalId`/`period`
    // undefined and every test below dies on `period.period_id` — six identical
    // "Cannot read properties of undefined" failures that name the reader and
    // not the cause. The first CI run of this suite did exactly that, and the
    // real answer was one missing INSERT in the workflow fixture.
    if (!journalId) throw new Error(`No journal seeded for TEST_ENTITY_ID=${entityId}. The CI fixture step seeds BQ/VT/AC/OD.`);
    if (!period) throw new Error(`No OPEN accounting_period for TEST_ENTITY_ID=${entityId}. The CI fixture step seeds one covering today.`);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  // Build a VALIDATED entry via raw SQL in its own transaction; resolves on
  // COMMIT, rejects if any trigger throws (deferred triggers fire at COMMIT).
  async function rawValidatedEntry({ periodId, entryDate, lines }) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const no = (await c.query(
        "SELECT COALESCE(MAX(entry_no),0)+1 AS n FROM journal_entry WHERE journal_id=$1 AND period_id=$2",
        [journalId, periodId],
      )).rows[0].n;
      const e = await c.query(
        "INSERT INTO journal_entry (journal_id, entity_id, period_id, entry_no, entry_date, source_doc_ref, status, source) " +
          "VALUES ($1,$2,$3,$4,$5,'test:hardening','draft','HUMAN_MANUAL') RETURNING entry_id",
        [journalId, entityId, periodId, no, entryDate],
      );
      const entryId = e.rows[0].entry_id;
      let ln = 1;
      for (const l of lines) {
        // eslint-disable-next-line no-await-in-loop
        await c.query(
          "INSERT INTO journal_line (entry_id, account_code, debit, credit, line_no) VALUES ($1,$2,$3,$4,$5)",
          [entryId, l.account_code, l.debit, l.credit, ln++],
        );
      }
      await c.query("UPDATE journal_entry SET status='validated', validated_at=now() WHERE entry_id=$1", [entryId]);
      await c.query("COMMIT");
      return entryId;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  it("no-compensation trigger rejects an account on both sides (§23.6)", async () => {
    await expect(rawValidatedEntry({
      periodId: period.period_id,
      entryDate: period.starts_on,
      lines: [ { account_code: "5211", debit: 100, credit: 0 }, { account_code: "5211", debit: 0, credit: 100 } ],
    })).rejects.toThrow(/both debited and credited|compensation/i);
  });

  it("period trigger rejects posting into a FROZEN period", async () => {
    const c = await pool.connect();
    let testPeriodId;
    try {
      const r = await c.query(
        "INSERT INTO accounting_period (entity_id, code, starts_on, ends_on, status) " +
          "VALUES ($1, 'TEST-FROZEN-" + Date.now() + "', '2099-01-01','2099-01-31','FROZEN') RETURNING period_id",
        [entityId],
      );
      testPeriodId = r.rows[0].period_id;
    } finally {
      c.release();
    }
    await expect(rawValidatedEntry({
      periodId: testPeriodId,
      entryDate: "2099-01-15",
      lines: [ { account_code: "5211", debit: 100, credit: 0 }, { account_code: "4191", debit: 0, credit: 100 } ],
    })).rejects.toThrow(/FROZEN|cannot post/i);
    // The rejected entry rolled back, so the test period has no entries → drop it.
    await pool.query("DELETE FROM accounting_period WHERE period_id = $1", [testPeriodId]);
  });

  it("period trigger rejects an entry_date outside the period bounds", async () => {
    await expect(rawValidatedEntry({
      periodId: period.period_id,
      entryDate: "1999-01-01", // well outside any real period
      lines: [ { account_code: "5211", debit: 100, credit: 0 }, { account_code: "4191", debit: 0, credit: 100 } ],
    })).rejects.toThrow(/outside its period/i);
  });

  it("double-reversal is rejected (service 409 + unique index backstop)", async () => {
    const withClient = async (fn) => { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } };
    const posted = await withClient((c) => service.post(c, {
      journalId, entityId, entryDate: period.starts_on, sourceDocRef: "test:reversal",
      lines: [ { account_code: "5211", debit: 100, credit: 0 }, { account_code: "4191", debit: 0, credit: 100 } ],
      actor: { user_id: null },
    }));
    await withClient((c) => service.reverse(c, { entryId: posted.entry.entry_id, reason: "test", actor: { user_id: null } }));
    await expect(withClient((c) => service.reverse(c, { entryId: posted.entry.entry_id, reason: "again", actor: { user_id: null } })))
      .rejects.toThrow(/already been reversed|ALREADY_REVERSED/i);
  });
});
