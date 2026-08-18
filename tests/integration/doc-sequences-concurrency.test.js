"use strict";

/**
 * G10 — gap-free document numbering under concurrency, against a real
 * Postgres. The review called this out as untested end-to-end: two operators
 * issue documents for the same entity in the same year and both print the
 * same number until the second is silently renumbered.
 *
 * The allocator is a single atomic `INSERT … ON CONFLICT DO UPDATE …
 * RETURNING seq`, so N concurrent allocations MUST produce N distinct,
 * gap-free sequence values. A fake client cannot prove this — only a real
 * database serialises the upsert. The suite self-skips without DATABASE_URL
 * (CI sets it; see ci.yaml "migrations" job).
 */

const { Pool } = require("pg");

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;
const itDb = hasDb ? it : it.skip;

let pool;

d("doc_sequences — gap-free allocation under concurrency (G10)", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
  });
  afterAll(async () => {
    if (pool) await pool.end();
  });

  itDb("20 concurrent allocations yield 20 distinct, gap-free numbers", async () => {
    const moduleKey = "G10_TEST";
    const entityId = process.env.TEST_ENTITY_ID || "00000000-0000-4000-8000-000000000001";
    // The tenant DB is migrated but the test entity may not exist in the
    // fixture — doc_sequence only FKs entity_id if the column is constrained.
    // Clean the counter first so the test is deterministic.
    await pool.query(
      "DELETE FROM doc_sequence WHERE module_key = $1 AND entity_id = $2 AND year = 2026",
      [moduleKey, entityId],
    );

    const worker = async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const { rows } = await c.query(
          "INSERT INTO doc_sequence (module_key, year, entity_id, seq) VALUES ($1, 2026, $2, 1) " +
            "ON CONFLICT (module_key, year, entity_id) DO UPDATE SET seq = doc_sequence.seq + 1 RETURNING seq",
          [moduleKey, entityId],
        );
        await c.query("COMMIT");
        return rows[0].seq;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    };

    const N = 20;
    const seqs = await Promise.all(Array.from({ length: N }, worker));
    const sorted = [...seqs].sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(N); // no duplicates
    expect(sorted[0]).toBe(1); // gap-free from 1
    for (let i = 1; i < N; i += 1) expect(sorted[i]).toBe(sorted[i - 1] + 1);
  });
});
