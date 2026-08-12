"use strict";
/**
 * DB-backed proof of the orchestration outbox (Plan A) on the import-freight lane
 * (A7 #1). Walks: won opportunity → (dispatcher) opens & links a dossier →
 * approve a costing → a DRAFT final invoice appears for the dossier — and proves
 * the whole thing is idempotent (re-dispatch creates nothing new).
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

  it("costing approval synchronously drafts one final invoice; the backstop no-ops", async () => {
    const cst = await withClient((c) =>
      costing.createDraft(c, {
        data: {
          dossier_id: dossierId,
          margin_percent: 10,
          lines: [{ label: "Ocean freight", qty: 1, unit_cost: 1000 }],
        },
        actor: {},
      }),
    );
    await withClient((c) =>
      costing.setStatus(c, { id: cst.costing_id, to: "APPROVE", actor: {} }),
    );

    // Synchronous handoff already produced the DRAFT.
    const inv = await withClient((c) =>
      c.query(
        "SELECT status FROM invoice WHERE dossier_id = $1 AND type = 'FINAL'",
        [dossierId],
      ),
    );
    expect(inv.rows.length).toBe(1);
    expect(inv.rows[0].status).toBe("DRAFT");

    // Async backstop (costing.approved handler) must be a no-op — still one invoice.
    await withClient((c) => dispatcher.dispatchPending(c, {}));
    const n = await withClient((c) =>
      c.query(
        "SELECT count(*)::int AS n FROM invoice WHERE dossier_id = $1 AND type = 'FINAL'",
        [dossierId],
      ),
    );
    expect(n.rows[0].n).toBe(1);
  });
});
