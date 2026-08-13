"use strict";
const orchestrator = require("../../src/services/ai/orchestrator.service");
const governance = require("../../src/modules/ai/governance/governance.service");

// Fake tenant client that answers the governance gate queries by SQL shape.
// Tenant enablement is driven by the console-projected `feature_state` (what the
// UI gate uses); `ai_feature_flag` has no explicit preference row here so it
// defaults ON when entitled.
function fakeClient({ enabled, grant = null, period = null, spent = 0 }) {
  return {
    query: async (sql) => {
      if (/FROM feature_state/.test(sql))
        return { rows: [{ state: enabled ? "on" : "off" }] };
      if (/FROM ai_feature_flag/.test(sql)) return { rows: [] };
      if (/FROM ai_access_grant/.test(sql))
        return { rows: grant ? [grant] : [] };
      if (/FROM ai_budget_period/.test(sql))
        return { rows: period ? [period] : [] };
      if (/SUM\(cost_xaf\)/.test(sql)) return { rows: [{ spent }] };
      return { rows: [] };
    },
  };
}
const user = { user_id: "11111111-1111-1111-1111-111111111111" };

describe("assistant governance gate", () => {
  test("feature disabled (console off) → blocked, no model call, no actions", async () => {
    const res = await orchestrator.ask({
      client: fakeClient({ enabled: false }),
      user,
      message: "raise an invoice",
    });
    expect(res.blocked).toBe(true);
    expect(res.actions).toEqual([]);
    expect(res.answer).toMatch(/unavailable/i);
  });

  test("enabled + no explicit grant → allowed (a grant is opt-out, not required)", async () => {
    const v = await governance.canUseFeature(fakeClient({ enabled: true }), {
      userId: user.user_id,
      featureKey: "assistant",
    });
    expect(v.allowed).toBe(true);
  });

  test("enabled but the user's grant is revoked → blocked", async () => {
    const v = await governance.canUseFeature(
      fakeClient({ enabled: true, grant: { revoked_at: "2026-01-01" } }),
      { userId: user.user_id, featureKey: "assistant" },
    );
    expect(v.allowed).toBe(false);
  });

  test("enabled + budget hard-capped → blocked", async () => {
    const client = fakeClient({
      enabled: true,
      period: { period_id: "p1", soft_cap_xaf: 100, hard_cap_xaf: 200 },
      spent: 250,
    });
    const res = await orchestrator.ask({ client, user, message: "hi" });
    expect(res.blocked).toBe(true);
    expect(res.answer).toMatch(/budget/i);
  });
});
