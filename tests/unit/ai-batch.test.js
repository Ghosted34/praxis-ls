"use strict";
const orchestrator = require("../../src/services/ai/orchestrator.service");

const user = { user_id: "u1" };
// Fake client: governance gate open; batch has two runs; per-run lookups by id.
function makeClient(runOrder, actionKeyById) {
  return {
    query: async (sql, params = []) => {
      if (/FROM ai_feature_flag/.test(sql)) return { rows: [{ is_enabled: true }] };
      if (/FROM ai_access_grant/.test(sql)) return { rows: [{ revoked_at: null }] };
      if (/FROM ai_budget_period/.test(sql)) return { rows: [] };
      if (/action_run_id FROM ai_action_run WHERE batch_id/.test(sql)) return { rows: runOrder.map((id) => ({ action_run_id: id })) };
      if (/SELECT \* FROM ai_action_run WHERE action_run_id/.test(sql)) {
        const id = params[0];
        return { rows: [{ action_run_id: id, user_id: "u1", action_key: actionKeyById[id], proposed_payload: {}, status: "AWAITING_CONFIRM" }] };
      }
      return { rows: [] }; // UPDATE / INSERT immutable_ledger
    },
  };
}
const registry = {
  ok_action: async () => ({ entity_ref: "thing:1" }),
  bad_action: async () => { throw new Error("boom"); },
};

describe("AI batch confirm (grouped, halt-on-failure)", () => {
  test("all-success executes every action in order", async () => {
    const client = makeClient(["a1", "a2"], { a1: "ok_action", a2: "ok_action" });
    const out = await orchestrator.confirmBatch({ client, user, batchId: "b1", registry });
    expect(out.halted).toBe(false);
    expect(out.executed).toBe(2);
    expect(out.results.every((r) => r.ok)).toBe(true);
  });

  test("halts on first failure; earlier action counted, later not run", async () => {
    const client = makeClient(["a1", "a2", "a3"], { a1: "ok_action", a2: "bad_action", a3: "ok_action" });
    const out = await orchestrator.confirmBatch({ client, user, batchId: "b1", registry });
    expect(out.halted).toBe(true);
    expect(out.executed).toBe(1); // only a1 succeeded before a2 failed
    expect(out.results[out.results.length - 1].ok).toBe(false);
    expect(out.results[out.results.length - 1].error).toMatch(/boom/);
  });

  test("blocked when governance gate closed", async () => {
    const client = { query: async (sql) => (/ai_feature_flag/.test(sql) ? { rows: [{ is_enabled: false }] } : { rows: [] }) };
    await expect(orchestrator.confirmBatch({ client, user, batchId: "b1", registry })).rejects.toThrow(/blocked/i);
  });
});
