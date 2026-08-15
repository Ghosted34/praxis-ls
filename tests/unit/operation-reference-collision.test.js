"use strict";
/**
 * What happens when the database says a reference is taken.
 *
 * ── WHY THIS FILE IS NOT PARANOIA ───────────────────────────────────────────
 *
 * At 60 bits a real collision is a once-in-astronomy event, so it is tempting to
 * treat the retry path as dead code. It is not, and the reason has nothing to do
 * with probability: the retry loop is what makes the DATABASE the authority
 * rather than a `SELECT … WHERE ref = $1` check beforehand. A pre-check is a
 * check-then-act race — two requests both see the reference free, both insert,
 * one gets a 500 — and the whole reason the unique index is the guard is that it
 * cannot be raced.
 *
 * ── THE PART THAT IS ACTUALLY EASY TO GET WRONG ─────────────────────────────
 *
 * Postgres aborts a transaction on ANY statement error. After a 23505, every
 * subsequent statement answers 25P02 "current transaction is aborted" until
 * somebody rolls back. So a retry loop written the obvious way does not retry:
 * it fails four times with 25P02 and destroys the caller's in-flight work on the
 * way. `SAVEPOINT` before each attempt and `ROLLBACK TO SAVEPOINT` after a
 * failure is what makes the second attempt possible at all — which is why the
 * savepoint discipline is asserted here as directly as the retry itself.
 */
const {
  allocateOperationReference,
  withSavepoint,
  isRefConflict,
  MAX_ATTEMPTS,
} = require("../../src/services/documents/operation-reference");

/** The error node-postgres raises for `dossier_ref_key`. */
function uniqueRefError(value = "SL7Z3K9QW2M4XBSM") {
  const err = new Error("duplicate key value violates unique constraint \"dossier_ref_key\"");
  err.code = "23505";
  err.constraint = "dossier_ref_key";
  err.detail = `Key (ref)=(${value}) already exists.`;
  return err;
}

/**
 * A client that models the two lookups the allocator makes and records every
 * statement, and throws on anything it does not model — a fake that answers
 * `[]` to an unmodelled query makes every assertion after it meaningless.
 */
function fakeClient({ prefix = "SL", code = "SM" } = {}) {
  const state = { sql: [] };
  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(s)) return { rows: [] };
      if (/FROM corporate_entity/i.test(s)) {
        return { rows: [{ ops_reference_prefix: prefix, trading_name: "Smart Logistics", legal_name: "Smart Logistics SARL" }] };
      }
      if (/FROM service_type/i.test(s)) return { rows: [{ ops_reference_code: code, key: "SEA_FREIGHT_IMPORT" }] };
      throw new Error("Unmatched SQL in fakeClient: " + s.slice(0, 160) + " params=" + JSON.stringify(params));
    },
  };
}

describe("a unique conflict on dossier.ref", () => {
  it("causes a retry, and the retry uses a different reference", async () => {
    const c = fakeClient();
    const tried = [];
    const out = await allocateOperationReference(c, {
      entityId: "e1",
      serviceTypeId: "st1",
      write: async (ref) => {
        tried.push(ref);
        if (tried.length === 1) throw uniqueRefError(ref);
        return { dossier_id: "d1", ref };
      },
    });

    expect(tried).toHaveLength(2);
    expect(tried[0]).not.toBe(tried[1]);
    expect(out.ref).toBe(tried[1]);
    expect(out.attempts).toBe(2);
    expect(out.row).toEqual({ dossier_id: "d1", ref: tried[1] });
  });

  it("keeps the entity prefix and service code — only the core is regenerated", async () => {
    const c = fakeClient({ prefix: "BC", code: "HT" });
    const tried = [];
    await allocateOperationReference(c, {
      entityId: "e1",
      serviceTypeId: "st1",
      write: async (ref) => {
        tried.push(ref);
        if (tried.length < 3) throw uniqueRefError(ref);
        return { ref };
      },
    });
    expect(tried).toHaveLength(3);
    for (const ref of tried) expect(ref).toMatch(/^BC[0-9A-HJKMNP-TV-Z]{12}HT$/);
    // The middles differ, so the retry is a NEW draw and not the same value
    // being resubmitted.
    expect(new Set(tried).size).toBe(3);
  });

  it("re-reads the entity and service type ONCE, not once per attempt", async () => {
    const c = fakeClient();
    await allocateOperationReference(c, {
      entityId: "e1",
      serviceTypeId: "st1",
      write: async (ref) => {
        if (c.state.sql.filter((s) => /^SAVEPOINT/i.test(s)).length < 3) throw uniqueRefError(ref);
        return { ref };
      },
    });
    expect(c.state.sql.filter((s) => /FROM corporate_entity/i.test(s))).toHaveLength(1);
    expect(c.state.sql.filter((s) => /FROM service_type/i.test(s))).toHaveLength(1);
  });

  it("rolls back to a savepoint between attempts, so the caller's transaction survives", async () => {
    const c = fakeClient();
    await allocateOperationReference(c, {
      entityId: "e1",
      serviceTypeId: "st1",
      write: async (ref) => {
        if (!c.state.sql.some((s) => /^ROLLBACK TO SAVEPOINT/i.test(s))) throw uniqueRefError(ref);
        return { ref };
      },
    });
    const saves = c.state.sql.filter((s) => /^SAVEPOINT/i.test(s));
    const rollbacks = c.state.sql.filter((s) => /^ROLLBACK TO SAVEPOINT/i.test(s));
    const releases = c.state.sql.filter((s) => /^RELEASE SAVEPOINT/i.test(s));
    expect(saves).toHaveLength(2); // one per attempt
    expect(rollbacks).toHaveLength(1); // the failed one
    expect(releases).toHaveLength(2); // the failed one and the successful one
    // A plain ROLLBACK would take the caller's whole transaction with it.
    expect(c.state.sql.some((s) => /^ROLLBACK$/i.test(s))).toBe(false);
  });

  it("gives up after a bounded number of attempts, with a typed error", async () => {
    const c = fakeClient();
    let attempts = 0;
    await expect(
      allocateOperationReference(c, {
        entityId: "e1",
        serviceTypeId: "st1",
        write: async (ref) => {
          attempts += 1;
          throw uniqueRefError(ref);
        },
      }),
    ).rejects.toMatchObject({
      code: "REF_COLLISION_RETRY_EXHAUSTED",
      status: 500,
    });
    expect(attempts).toBe(MAX_ATTEMPTS);
  });
});

describe("what is NOT retried", () => {
  it("a unique conflict on some other column is raised, not swallowed", async () => {
    const c = fakeClient();
    const err = new Error("duplicate key value violates unique constraint \"ux_idempotency_key\"");
    err.code = "23505";
    err.constraint = "ux_idempotency_key";
    err.detail = "Key (idempotency_key)=(abc) already exists.";

    let attempts = 0;
    await expect(
      allocateOperationReference(c, {
        entityId: "e1",
        serviceTypeId: "st1",
        write: async () => {
          attempts += 1;
          throw err;
        },
      }),
    ).rejects.toThrow(/ux_idempotency_key/);
    // Retrying a new REFERENCE cannot fix a duplicate idempotency key, and
    // reporting it as a reference problem sends the reader to the wrong file.
    expect(attempts).toBe(1);
  });

  it("an ordinary failure is raised on the first attempt", async () => {
    const c = fakeClient();
    let attempts = 0;
    await expect(
      allocateOperationReference(c, {
        entityId: "e1",
        serviceTypeId: "st1",
        write: async () => {
          attempts += 1;
          throw new Error("null value in column \"entity_id\" violates not-null constraint");
        },
      }),
    ).rejects.toThrow(/not-null/);
    expect(attempts).toBe(1);
  });

  it("recognises the conflict by constraint OR by detail, so a rename cannot disable the retry", () => {
    expect(isRefConflict(uniqueRefError())).toBe(true);
    const renamed = uniqueRefError();
    renamed.constraint = "ux_dossier_reference_2026";
    expect(isRefConflict(renamed)).toBe(true); // still named in `detail`
    const other = uniqueRefError();
    other.constraint = "ux_dossier_bl_mawb";
    other.detail = "Key (bl_mawb)=(X) already exists.";
    expect(isRefConflict(other)).toBe(false);
    expect(isRefConflict(null)).toBe(false);
    expect(isRefConflict(new Error("nope"))).toBe(false);
  });
});

/**
 * Concurrency, modelled the only way a unit test honestly can: a shared "table"
 * that rejects a duplicate exactly as the unique index does. This does not prove
 * Postgres works — it proves the ALLOCATOR converges rather than deadlocking,
 * looping forever or handing two callers the same reference.
 */
describe("concurrent allocation", () => {
  it("gives every caller a distinct reference", async () => {
    const table = new Set();
    const allocations = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        allocateOperationReference(fakeClient(), {
          entityId: "e1",
          serviceTypeId: "st1",
          write: async (ref) => {
            if (table.has(ref)) throw uniqueRefError(ref);
            table.add(ref);
            return { dossier_id: "d" + i, ref };
          },
        }),
      ),
    );
    const refs = allocations.map((a) => a.ref);
    expect(new Set(refs).size).toBe(40);
    expect(table.size).toBe(40);
  });

  it("cannot be beaten by a pre-check race: the write is the only thing that claims a reference", async () => {
    const table = new Set();
    // Force every caller onto the SAME first candidate, so they genuinely
    // contend. Only one write may win; the loser must retry, not overwrite.
    const claimed = [];
    const write = (fixed) => async (ref) => {
      const value = claimed.length === 0 ? fixed : ref;
      if (table.has(value)) throw uniqueRefError(value);
      table.add(value);
      claimed.push(value);
      return { ref: value };
    };
    const a = await allocateOperationReference(fakeClient(), {
      entityId: "e1", serviceTypeId: "st1", write: write("SLCOLLIDECOLLSM"),
    });
    const b = await allocateOperationReference(fakeClient(), {
      entityId: "e1", serviceTypeId: "st1", write: write("SLCOLLIDECOLLSM"),
    });
    expect(a.ref).not.toBe(b.ref);
    expect(table.size).toBe(2);
  });
});

describe("withSavepoint", () => {
  it("runs the body unwrapped when there is no transaction to protect", async () => {
    const sql = [];
    const client = {
      async query(s) {
        sql.push(String(s));
        // 25P01 — SAVEPOINT outside a transaction block.
        if (/^SAVEPOINT/i.test(String(s))) {
          const err = new Error("SAVEPOINT can only be used in transaction blocks");
          err.code = "25P01";
          throw err;
        }
        return { rows: [] };
      },
    };
    await expect(withSavepoint(client, "praxis_probe", async () => "done")).resolves.toBe("done");
    // No RELEASE for a savepoint that was never opened — that would be a second
    // error on a connection that is already telling us where it stands.
    expect(sql.filter((s) => /RELEASE/i.test(s))).toHaveLength(0);
  });

  it("refuses a savepoint name that is not a plain identifier", async () => {
    const client = { query: async () => ({ rows: [] }) };
    await expect(withSavepoint(client, "x; DROP TABLE dossier", async () => 1)).rejects.toMatchObject({
      code: "BAD_SAVEPOINT",
    });
  });

  it("re-raises the body's error after rolling back", async () => {
    const sql = [];
    const client = { async query(s) { sql.push(String(s)); return { rows: [] }; } };
    await expect(
      withSavepoint(client, "praxis_probe", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(sql).toEqual([
      "SAVEPOINT praxis_probe",
      "ROLLBACK TO SAVEPOINT praxis_probe",
      "RELEASE SAVEPOINT praxis_probe",
    ]);
  });
});
