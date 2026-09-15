"use strict";
/**
 * DB-backed proof of the orchestration outbox (Plan A) on the import-freight lane
 * (A7 #1). Walks: won opportunity → (dispatcher) opens & links a dossier →
 * approve a costing — and proves the whole thing is idempotent (re-dispatch
 * creates nothing new).
 *
 * THE LANE STOPS AT THE COSTING (12766). It used to end at "a DRAFT final
 * invoice appears for the dossier", asserted here both as a synchronous handoff
 * and as an idempotent async backstop. Both paths are gone: a costing is a
 * BUDGET raised by an operations officer, the final invoice is raised by a
 * finance officer from the accepted quotation, and a document that silently
 * creates another department's document is a control weakness rather than a
 * convenience.
 *
 * The test is INVERTED rather than deleted, and that is the point of keeping
 * it: this is the only place the decoupling is proved against a real database
 * end to end. `costing-foundation.test.js` proves the code does not CALL the
 * invoice module; this proves nothing downstream — no handler, no trigger, no
 * chain — quietly opens one anyway.
 *
 * Skipped unless DATABASE_URL points at a migrated+seeded tenant schema with at
 * least one corporate_entity.
 *   DATABASE_URL    postgres connection string (search_path = the tenant schema)
 *   TEST_ENTITY_ID  a corporate_entity id (guarantees the dossier-ref allocation
 *                   + numbering have an entity to work with)
 */
const hasDb = !!process.env.DATABASE_URL && !!process.env.TEST_ENTITY_ID;
const d = hasDb ? describe : describe.skip;

d("orchestration — import-freight lane (real Postgres)", () => {
  let pool;
  let opportunity;
  let costing;
  let dispatcher;

  beforeAll(() => {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    opportunity = require("../../src/modules/sales/opportunity/opportunity.service");
    costing = require("../../src/modules/costing/costing/costing.service");
    dispatcher = require("../../src/orchestration/dispatcher");
  });
  afterAll(async () => {
    if (pool) await pool.end();
  });

  const withClient = async (fn) => {
    const c = await pool.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  };

  let opportunityId;
  let dossierId;

  it("won opportunity → the dispatcher opens & links a dossier (async)", async () => {
    const created = await withClient((c) =>
      opportunity.create(c, {
        data: { name: "IMPORT FREIGHT lane " + Date.now() },
        actor: {},
      }),
    );
    opportunityId = created.opportunity_id;

    // Win WITHOUT the manual createDossier flag — the handoff must be automatic.
    await withClient((c) =>
      opportunity.win(c, { id: opportunityId, actor: {} }),
    );

    // Not linked yet: the handler runs off the outbox, not in-request.
    let row = await withClient((c) =>
      c.query("SELECT dossier_id FROM opportunity WHERE opportunity_id = $1", [
        opportunityId,
      ]),
    );
    expect(row.rows[0].dossier_id).toBeFalsy();

    // Drain the outbox (what the scheduled orchestration-dispatch job does).
    await withClient((c) => dispatcher.dispatchPending(c, {}));

    row = await withClient((c) =>
      c.query("SELECT dossier_id FROM opportunity WHERE opportunity_id = $1", [
        opportunityId,
      ]),
    );
    dossierId = row.rows[0].dossier_id;
    expect(dossierId).toBeTruthy();

    const dj = await withClient((c) =>
      c.query("SELECT status FROM dossier WHERE dossier_id = $1", [dossierId]),
    );
    expect(dj.rows[0].status).toBe("OPEN");
  });

  it("is idempotent — re-dispatch does not create a second dossier", async () => {
    await withClient((c) => dispatcher.dispatchPending(c, {}));
    const row = await withClient((c) =>
      c.query("SELECT dossier_id FROM opportunity WHERE opportunity_id = $1", [
        opportunityId,
      ]),
    );
    expect(row.rows[0].dossier_id).toBe(dossierId);
  });

  it("approving a costing opens NO invoice — not synchronously, not off the outbox", async () => {
    const cst = await withClient((c) =>
      costing.createDraft(c, {
        data: {
          dossier_id: dossierId,
          lines: [{ label: "Ocean freight", qty: 1, unit_cost: 1000 }],
        },
        actor: {},
      }),
    );
    await withClient((c) =>
      costing.setStatus(c, { id: cst.costing_id, to: "APPROVE", actor: {} }),
    );

    const invoiceCount = async () =>
      (await withClient((c) =>
        c.query(
          "SELECT count(*)::int AS n FROM invoice WHERE dossier_id = $1 AND type = 'FINAL'",
          [dossierId],
        ),
      )).rows[0].n;

    // Nothing in-request.
    expect(await invoiceCount()).toBe(0);

    // And nothing off the outbox either. `costing.approved` is still EMITTED —
    // the approval chain and any tenant workflow bind to it — it simply has no
    // handler that reaches into finance. An event with no subscriber is marked
    // done and skipped (dispatcher.js:146), so draining must be a no-op here.
    await withClient((c) => dispatcher.dispatchPending(c, {}));
    expect(await invoiceCount()).toBe(0);
  });

  it("the approval still lands everything that IS the costing's own business", async () => {
    // The decoupling must not have taken the rest of the approval with it.
    const row = await withClient((c) =>
      c.query(
        "SELECT status, doc_number, total_ht, total_ttc, total_ttc_xaf, " +
          "approved_at, locked_at FROM costing WHERE dossier_id = $1",
        [dossierId],
      ),
    );
    const cst = row.rows[0];
    expect(cst.status).toBe("APPROVED_LOCKED");
    // 12766: totals are STORED, not recomputed on read — this is what the
    // registry column and the KPI strip aggregate.
    expect(Number(cst.total_ht)).toBe(1000);
    expect(Number(cst.total_ttc)).toBe(1000);
    expect(Number(cst.total_ttc_xaf)).toBe(1000);
    // 12766: approval is attributed and the lock is stamped.
    expect(cst.approved_at).toBeTruthy();
    expect(cst.locked_at).toBeTruthy();

    // 12766: the line set is frozen, so the next amendment after an unlock can
    // show the approver what moved.
    const snap = await withClient((c) =>
      c.query(
        "SELECT revision, lines, total_ht FROM costing_approval_snapshot " +
          "WHERE costing_id = (SELECT costing_id FROM costing WHERE dossier_id = $1)",
        [dossierId],
      ),
    );
    expect(snap.rows.length).toBe(1);
    expect(snap.rows[0].revision).toBe(1);
    expect(snap.rows[0].lines).toHaveLength(1);
    expect(snap.rows[0].lines[0].label).toBe("Ocean freight");
  });

  it("a second costing on the same file is refused, with the first one named", async () => {
    // 12766's uq_costing_one_live_per_dossier, surfaced as a sentence rather
    // than a raw 23505. The remedy for a wrong figure is the unlock loop, not a
    // second sheet competing with the first.
    await expect(
      withClient((c) =>
        costing.createDraft(c, {
          data: { dossier_id: dossierId, lines: [{ label: "Duplicate", qty: 1, unit_cost: 1 }] },
          actor: {},
        }),
      ),
    ).rejects.toMatchObject({ code: "COSTING_EXISTS", status: 409 });
  });

});
