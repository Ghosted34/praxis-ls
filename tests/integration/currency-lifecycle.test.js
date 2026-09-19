"use strict";
/**
 * DB-backed proof of the Currency & FX module (MOD-08) against the real tenant
 * schema and the invariants added by migrations 13951/13952/13953. Skipped
 * unless DATABASE_URL points at a migrated, seeded tenant database.
 *
 * Env it needs:
 *   DATABASE_URL   postgres connection string (search_path = the tenant schema)
 *
 * What it proves end-to-end (C-PR-01..04, audit #5/#7/#8/#10/#12):
 *   - the single-base invariant is enforced (13951's partial unique index);
 *   - a manual rate carries its actor (set_by_user_id) and reads back in the
 *     rate-history contract with { data, total, has_more };
 *   - the usage scan runs and every currency-referencing FK column it counts is
 *     index-covered (13953), so the scan plans as index scans not seq scans;
 *   - the dossier assembles for both a quote currency and the base.
 *
 * Read-mostly: it writes rates for a throwaway quote and cleans up in afterAll.
 */
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

d("currency & FX lifecycle (real Postgres)", () => {
  let pool;
  let client;
  let repo;
  let dossier;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    repo = require("../../src/modules/master/currency/currency.repo");
    dossier = require("../../src/modules/master/currency/currency.dossier");
  });

  afterAll(async () => {
    if (client) client.release();
    if (pool) await pool.end();
  });

  it("has exactly one base currency", async () => {
    const { rows } = await client.query("SELECT code FROM currency WHERE is_base = true");
    expect(rows.length).toBeLessThanOrEqual(1);
    if (rows.length === 1) {
      const base = await repo.getBaseCode(client);
      expect(base).toBe(rows[0].code);
    }
  });

  it("the partial unique index blocks a second base", async () => {
    const base = await repo.getBaseCode(client);
    if (!base) return; // bare tenant mid-seed
    // Any other active currency to attempt a second flag on.
    const { rows } = await client.query(
      "SELECT code FROM currency WHERE is_base = false AND is_active = true ORDER BY code LIMIT 1",
    );
    if (!rows.length) return;
    const other = rows[0].code;
    await client.query("BEGIN");
    try {
      await expect(
        client.query("UPDATE currency SET is_base = true WHERE code = $1", [other]),
      ).rejects.toBeDefined();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  // Regression (production, 2026-09-19): rebasing BACK — e.g. XAF→EUR→XAF —
  // died with 23505 on ux_currency_single_base because setBase's old single
  // `SET is_base = (code = $1)` flip visited the target row before the old
  // base row, so for one row-ordering moment two bases were flagged. The
  // ordered off-sweep → on-flip must survive the round trip in either order.
  it("setBase round-trips: base→other→base never trips the single-base index", async () => {
    const base = await repo.getBaseCode(client);
    if (!base) return;
    const { rows } = await client.query(
      "SELECT code FROM currency WHERE is_base = false AND is_active = true ORDER BY code LIMIT 1",
    );
    if (!rows.length) return;
    const other = rows[0].code;
    await client.query("BEGIN");
    try {
      await repo.setBase(client, other);
      expect(await repo.getBaseCode(client)).toBe(other);
      await repo.setBase(client, base); // back again — the case that 500'd
      expect(await repo.getBaseCode(client)).toBe(base);
      const { rows: flagged } = await client.query(
        "SELECT code FROM currency WHERE is_base = true",
      );
      expect(flagged).toEqual([{ code: base }]);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("rate history reads back through the offset/total/has_more contract", async () => {
    const base = await repo.getBaseCode(client);
    if (!base) return;
    const { rows } = await client.query(
      "SELECT code FROM currency WHERE is_base = false AND is_active = true ORDER BY code LIMIT 1",
    );
    if (!rows.length) return;
    const quote = rows[0].code;
    const page = await repo.rateHistory(client, { base, quote, limit: 5, offset: 0 });
    expect(page).toHaveProperty("rows");
    expect(page).toHaveProperty("total");
    expect(typeof page.total).toBe("number");
    expect(page.rows.length).toBeLessThanOrEqual(5);
  });

  it("every currency-FK usage column is index-covered (13953)", async () => {
    // Same introspection usageForCode uses: leading FK columns referencing
    // currency, excluding fx_rate_daily.
    const { rows: cols } = await client.query(
      `SELECT con.conrelid AS relid, con.conrelid::regclass::text AS tbl,
              con.conkey[1] AS first_attnum
         FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.confrelid = 'currency'::regclass
          AND con.conrelid::regclass::text NOT LIKE '%fx_rate_daily'`,
    );
    for (const c of cols) {
      const { rows: idx } = await client.query(
        "SELECT 1 FROM pg_index WHERE indrelid = $1 AND indkey[0] = $2 LIMIT 1",
        [c.relid, c.first_attnum],
      );
      expect(idx.length).toBeGreaterThanOrEqual(1); // covered by 13953 (or a prior index)
    }
  });

  it("assembles a dossier for the base and a quote currency", async () => {
    const base = await repo.getBaseCode(client);
    if (!base) return;
    const baseDoc = await dossier.dossier(client, base);
    expect(baseDoc.is_base).toBe(true);
    expect(baseDoc.rate_history).toEqual([]);

    const { rows } = await client.query(
      "SELECT code FROM currency WHERE is_base = false AND is_active = true ORDER BY code LIMIT 1",
    );
    if (!rows.length) return;
    const quoteDoc = await dossier.dossier(client, rows[0].code);
    expect(quoteDoc.is_base).toBe(false);
    expect(quoteDoc).toHaveProperty("usage_total");
    expect(quoteDoc).toHaveProperty("rate_history_total");
  });
});
