"use strict";
/**
 * F7 (doc/SALES_CRM_FEATURES.md#F7) — the service behaviours that only show up
 * when you put a deal through the board, with the repo stubbed so no database
 * is needed.
 *
 * Each of these is a bug that shipped once already, in this system or the
 * legacy: a deal created with no stage (invisible on the board), a hand-typed
 * probability wiped by the next stage move, a won deal that kept its old stage
 * so the Won column stayed empty, and a settled deal that could still be moved
 * because the legacy accepts any status by POST with no guard.
 */

const repo = require("../../src/modules/sales/opportunity/opportunity.repo");
const service = require("../../src/modules/sales/opportunity/opportunity.service");

/** A pg client that records the transaction verbs and does nothing else. */
function fakeClient() {
  const calls = [];
  return { calls, query: async (sql) => { calls.push(String(sql).trim()); return { rows: [] }; } };
}

const STAGES = [
  { pipeline_stage_id: "s-new", code: "NEW", sort_order: 0, is_won: false, is_lost: false, default_probability: 10 },
  { pipeline_stage_id: "s-qual", code: "QUALIFIED", sort_order: 1, is_won: false, is_lost: false, default_probability: 30 },
  { pipeline_stage_id: "s-price", code: "PRICING_IN_PROGRESS", sort_order: 2, is_won: false, is_lost: false, default_probability: 50 },
  { pipeline_stage_id: "s-won", code: "WON", sort_order: 5, is_won: true, is_lost: false, default_probability: 100 },
  { pipeline_stage_id: "s-lost", code: "LOST", sort_order: 6, is_won: false, is_lost: true, default_probability: 0 },
];
const stageById = (id) => STAGES.find((s) => s.pipeline_stage_id === id) || null;

let stored;

beforeEach(() => {
  stored = null;
  jest.spyOn(repo, "listStages").mockImplementation(async () => STAGES);
  jest.spyOn(repo, "stage").mockImplementation(async (_c, id) => stageById(id));
  jest.spyOn(repo, "firstOpenStage").mockImplementation(async () =>
    STAGES.filter((s) => !s.is_won && !s.is_lost).sort((a, b) => a.sort_order - b.sort_order)[0],
  );
  jest.spyOn(repo, "insert").mockImplementation(async (_c, row) => {
    stored = { opportunity_id: "o1", status: "OPEN", ...row };
    return stored;
  });
  jest.spyOn(repo, "get").mockImplementation(async () => stored);
  jest.spyOn(repo, "update").mockImplementation(async (_c, _id, fields) => {
    stored = { ...stored, ...fields };
    return stored;
  });
});

afterEach(() => jest.restoreAllMocks());

describe("create", () => {
  test("a deal with no stage given lands in the first open stage", async () => {
    // F6's convert-to-opportunity created exactly this row with a NULL stage,
    // which put the deal in the pipeline and in no board column at once.
    const row = await service.create(fakeClient(), { data: { name: "Acme" } });
    expect(row.pipeline_stage_id).toBe("s-new");
  });

  test("and inherits that stage's probability", async () => {
    const row = await service.create(fakeClient(), { data: { name: "Acme" } });
    expect(Number(row.probability)).toBe(10);
    expect(row.probability_is_manual).toBe(false);
  });

  test("a probability given at creation is the human's, and is marked as such", async () => {
    const row = await service.create(fakeClient(), { data: { name: "Acme", probability: 15 } });
    expect(Number(row.probability)).toBe(15);
    expect(row.probability_is_manual).toBe(true);
  });

  test("an unknown stage is refused rather than silently defaulted", async () => {
    await expect(
      service.create(fakeClient(), { data: { name: "Acme", pipeline_stage_id: "nope" } }),
    ).rejects.toThrow(/stage/i);
  });

  test("source defaults to MANUAL and is carried through when given", async () => {
    const row = await service.create(fakeClient(), {
      data: { name: "Acme", source: "QUOTE_REQUEST", source_ref: "SQ-2026-0007", scope_summary: "2x40ft reefer" },
    });
    expect(row.source).toBe("QUOTE_REQUEST");
    expect(row.source_ref).toBe("SQ-2026-0007");
    expect(row.scope_summary).toBe("2x40ft reefer");
    stored = null;
    const plain = await service.create(fakeClient(), { data: { name: "Beta" } });
    expect(plain.source).toBe("MANUAL");
  });

  test("status cannot be forced at creation — the legacy accepts any status by POST", async () => {
    const row = await service.create(fakeClient(), { data: { name: "Acme", status: "WON" } });
    expect(row.status).toBe("OPEN");
  });
});

describe("moveStage", () => {
  const seed = async (over = {}) => {
    await service.create(fakeClient(), { data: { name: "Acme" } });
    stored = { ...stored, ...over };
  };

  test("the deal inherits the destination stage's probability", async () => {
    await seed();
    const row = await service.moveStage(fakeClient(), { id: "o1", pipelineStageId: "s-price" });
    expect(row.pipeline_stage_id).toBe("s-price");
    expect(Number(row.probability)).toBe(50);
  });

  test("a hand-typed probability SURVIVES the move", async () => {
    await seed({ probability: 15, probability_is_manual: true });
    const row = await service.moveStage(fakeClient(), { id: "o1", pipelineStageId: "s-price" });
    expect(row.pipeline_stage_id).toBe("s-price");
    expect(Number(row.probability)).toBe(15);
  });

  test("…except into a won or lost stage, which is 100 or 0 by definition", async () => {
    await seed({ probability: 15, probability_is_manual: true });
    const row = await service.moveStage(fakeClient(), { id: "o1", pipelineStageId: "s-won" });
    expect(row.status).toBe("WON");
    expect(Number(row.probability)).toBe(100);
    expect(row.probability_is_manual).toBe(false);
  });

  test("moving to a lost stage settles the deal as LOST", async () => {
    await seed();
    const row = await service.moveStage(fakeClient(), { id: "o1", pipelineStageId: "s-lost" });
    expect(row.status).toBe("LOST");
    expect(Number(row.probability)).toBe(0);
  });

  test("a settled deal refuses to move", async () => {
    await seed({ status: "WON" });
    await expect(
      service.moveStage(fakeClient(), { id: "o1", pipelineStageId: "s-qual" }),
    ).rejects.toThrow(/settled/i);
  });

  test("an unknown stage is refused", async () => {
    await seed();
    await expect(
      service.moveStage(fakeClient(), { id: "o1", pipelineStageId: "ghost" }),
    ).rejects.toThrow(/stage/i);
  });
});

describe("win / lose land the deal in the matching column", () => {
  test("win moves the deal into the won stage, not just the won status", async () => {
    await service.create(fakeClient(), { data: { name: "Acme" } });
    const out = await service.win(fakeClient(), { id: "o1" });
    expect(out.opportunity.status).toBe("WON");
    expect(out.opportunity.pipeline_stage_id).toBe("s-won");
    expect(Number(out.opportunity.probability)).toBe(100);
  });

  test("lose moves the deal into the lost stage", async () => {
    await service.create(fakeClient(), { data: { name: "Acme" } });
    const row = await service.lose(fakeClient(), { id: "o1" });
    expect(row.status).toBe("LOST");
    expect(row.pipeline_stage_id).toBe("s-lost");
  });

  test("a settled deal cannot be won or lost twice", async () => {
    await service.create(fakeClient(), { data: { name: "Acme" } });
    await service.lose(fakeClient(), { id: "o1" });
    await expect(service.win(fakeClient(), { id: "o1" })).rejects.toThrow(/settled/i);
    await expect(service.lose(fakeClient(), { id: "o1" })).rejects.toThrow(/settled/i);
  });
});

describe("update", () => {
  test("typing a probability claims it from the stage", async () => {
    await service.create(fakeClient(), { data: { name: "Acme" } });
    const row = await service.update(fakeClient(), { id: "o1", patch: { probability: 25 } });
    expect(Number(row.probability)).toBe(25);
    expect(row.probability_is_manual).toBe(true);
  });

  test("clearing it hands the number back to the stage", async () => {
    await service.create(fakeClient(), { data: { name: "Acme", probability: 25 } });
    const row = await service.update(fakeClient(), { id: "o1", patch: { probability: null } });
    expect(Number(row.probability)).toBe(10); // NEW's default
    expect(row.probability_is_manual).toBe(false);
  });

  test("a settled deal cannot be edited", async () => {
    await service.create(fakeClient(), { data: { name: "Acme" } });
    stored.status = "WON";
    await expect(
      service.update(fakeClient(), { id: "o1", patch: { name: "x" } }),
    ).rejects.toThrow(/settled/i);
  });
});

describe("metrics", () => {
  test("both win rates come back named, off one aggregate query", async () => {
    jest.spyOn(repo, "metrics").mockResolvedValue({
      open_count: 10, won_count: 6, lost_count: 4,
      pipeline_value: 50000000, weighted_value: 21000000, won_value: 30000000,
    });
    const m = await service.metrics(fakeClient(), {});
    expect(m.win_rate_settled).toBe(60);
    expect(m.win_rate_all_deals).toBe(30);
    expect(m.total_count).toBe(20);
    expect(m.settled_count).toBe(10);
    expect(m.pipeline_value).toBe(50000000);
  });

  test("no settled deals yet reads as null, not 0%", async () => {
    jest.spyOn(repo, "metrics").mockResolvedValue({
      open_count: 3, won_count: 0, lost_count: 0,
      pipeline_value: 1, weighted_value: 0, won_value: 0,
    });
    const m = await service.metrics(fakeClient(), {});
    expect(m.win_rate_settled).toBeNull();
    expect(m.win_rate_all_deals).toBe(0);
  });
});
