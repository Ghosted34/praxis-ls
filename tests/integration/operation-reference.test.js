"use strict";
/**
 * The operation-reference allocator against a real Postgres.
 *
 * ── THE TWO THINGS A FAKE CLIENT CANNOT PROVE ───────────────────────────────
 *
 * 1. THAT THE RETRY ACTUALLY RETRIES. Postgres aborts the whole transaction on
 *    any statement error: after a 23505 every subsequent statement answers
 *    25P02 "current transaction is aborted" until somebody rolls back. A fake
 *    that throws a synthetic 23505 and then happily accepts the next INSERT
 *    proves the loop iterates — not that the loop works. Only a real database
 *    can fail the way the savepoints exist to survive.
 *
 * 2. THAT THE SQL SEED AND THE JS DERIVATION AGREE. The prefix rule is written
 *    twice — as plpgsql in migration 0682, for the rows that already exist, and
 *    as `derivePrefix` here, for everything created afterwards. That is the
 *    exact shape of drift this repo keeps paying for (the transport-reference
 *    normaliser was written three times and had already diverged). No amount of
 *    unit testing on either side catches a disagreement BETWEEN them.
 *
 * Skipped unless DATABASE_URL points at a migrated tenant schema — same
 * convention as the other integration suites.
 *
 *   DATABASE_URL   postgres connection string (search_path = the tenant schema)
 */
const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

const opsRef = require("../../src/services/documents/operation-reference");

/** Migration 0682's derivation, isolated so it can be run on the same inputs. */
const SEED_DERIVATION = `
  SELECT upper(
    COALESCE(NULLIF(substr(COALESCE(w[1], ''), 1, 1), ''), 'X') ||
    COALESCE(NULLIF(substr(COALESCE(w[2], ''), 1, 1), ''),
             NULLIF(substr(COALESCE(w[1], ''), 2, 1), ''), 'X')
  ) AS want
  FROM (SELECT regexp_split_to_array(
          btrim(regexp_replace(
            normalize(regexp_replace($1::text, '[^[:alnum:]]+', ' ', 'g'), NFD),
            '[^A-Za-z0-9 ]', '', 'g')), '\\s+') AS w) s`;

d("operation references (real Postgres)", () => {
  let pool;
  let client;
  let entityId;

  beforeAll(async () => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    const { rows } = await client.query("SELECT entity_id FROM corporate_entity ORDER BY created_at LIMIT 1");
    entityId = rows.length ? rows[0].entity_id : null;
  });

  afterAll(async () => {
    if (client) client.release();
    if (pool) await pool.end();
  });

  /** Every dossier this suite opens is rolled back, so the tenant is untouched. */
  const inRollback = async (fn) => {
    await client.query("BEGIN");
    try {
      return await fn();
    } finally {
      await client.query("ROLLBACK");
    }
  };

  const insert = (ref) =>
    client
      .query("INSERT INTO dossier (ref, entity_id, status) VALUES ($1, $2, 'OPEN') RETURNING *", [ref, entityId])
      .then((r) => r.rows[0]);

  it("allocates a unique, correctly shaped reference", async () => {
    if (!entityId) return;
    const out = await inRollback(() =>
      opsRef.allocateOperationReference(client, { entityId, serviceTypeId: null, write: insert }),
    );
    expect(out.ref).toMatch(/^[A-Z0-9]{2}[0-9A-HJKMNP-TV-Z]{12}[A-Z0-9]{2}$/);
    expect(out.row.ref).toBe(out.ref);
    expect(out.attempts).toBe(1);
  });

  it("allocates a hundred in one transaction without a duplicate", async () => {
    if (!entityId) return;
    const refs = await inRollback(async () => {
      const out = [];
      for (let i = 0; i < 100; i += 1) {
        out.push((await opsRef.allocateOperationReference(client, { entityId, serviceTypeId: null, write: insert })).ref);
      }
      return out;
    });
    expect(new Set(refs).size).toBe(100);
  });

  /**
   * The one that a fake cannot express: a genuine 23505 from the unique index,
   * mid-transaction, followed by more work on the SAME transaction.
   */
  it("survives a real unique violation and leaves the transaction usable", async () => {
    if (!entityId) return;
    const taken = "ZZ" + opsRef.randomCore() + "ZZ";
    const { out, after } = await inRollback(async () => {
      await insert(taken);
      let first = true;
      const result = await opsRef.allocateOperationReference(client, {
        entityId,
        serviceTypeId: null,
        write: (ref) => {
          const use = first ? taken : ref;
          first = false;
          return insert(use);
        },
      });
      // If the savepoint had not contained the 23505, this would answer 25P02.
      const { rows } = await client.query("SELECT count(*)::int AS n FROM dossier WHERE ref = $1", [result.ref]);
      return { out: result, after: rows[0].n };
    });
    expect(out.attempts).toBe(2);
    expect(out.ref).not.toBe(taken);
    expect(after).toBe(1);
  });

  it("does not rewrite a reference that already exists", async () => {
    if (!entityId) return;
    // Whatever scheme the tenant's oldest file was numbered under, it keeps it.
    const { rows } = await client.query("SELECT ref FROM dossier ORDER BY created_at LIMIT 1");
    if (!rows.length) return;
    const before = rows[0].ref;
    await inRollback(() =>
      opsRef.allocateOperationReference(client, { entityId, serviceTypeId: null, write: insert }),
    );
    const { rows: still } = await client.query("SELECT ref FROM dossier ORDER BY created_at LIMIT 1");
    expect(still[0].ref).toBe(before);
    expect(opsRef.classifyReference(before)).toBeTruthy();
  });

  it("derives prefixes exactly as migration 0682's seed does", async () => {
    const names = [
      "Smart Logistics", "Base Cameroon Limited", "Praxis", "Bolloré",
      "Étoile Logistique", "Société Générale de Transit", "Smart-Logistics",
      "Smart & Logistics", "SMART_LOGISTICS SARL", "7 Seas Shipping",
      "Trans Africa Freight Services", "  leading space", "ÀÉÎÕÜ Company",
      "X", "Ångström Cargo", "l'Océan Bleu",
    ];
    for (const name of names) {
      const { rows } = await client.query(SEED_DERIVATION, [name]);
      expect([name, rows[0].want]).toEqual([name, opsRef.derivePrefix(name)]);
    }
  });

  it("keeps the shape and the uniqueness in the database, not only in the code", async () => {
    if (!entityId) return;
    await inRollback(async () => {
      const bad = ["sl", "SLX", "S", ""];
      for (const value of bad) {
        await client.query("SAVEPOINT probe");
        await expect(
          client.query("UPDATE corporate_entity SET ops_reference_prefix = $1 WHERE entity_id = $2", [value, entityId]),
        ).rejects.toMatchObject({ code: "23514" });
        await client.query("ROLLBACK TO SAVEPOINT probe");
      }
    });
  });
});
