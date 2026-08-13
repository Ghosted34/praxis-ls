"use strict";
/**
 * Approval-decision guards — audit findings W2 (eligibility), W5 (maker-checker),
 * W9 (step_kind) and W10 (unknown amount), plus A4 (scope cycle).
 *
 * Before these, executor.act checked only that a task was still PENDING: any
 * caller past the route's permission could clear any task at any step of any
 * document, including one they had raised themselves, with either verb.
 *
 * The existing workflow-executor.test.js covers the happy path and deliberately
 * builds tasks with no step role/scope — that is the "unrestricted step" case,
 * which must keep working, so it is left alone.
 */
const {
  stepApplies,
  applicableSteps,
  act,
  assertEligible,
  KIND_ACTIONS,
} = require("../../src/services/workflow/executor");
const scopeService = require("../../src/modules/security/scope/scope.service");

const step = (over = {}) => ({
  workflow_step_id: "s1",
  step_seq: 1,
  step_kind: "APPROVE",
  min_amount_xaf: null,
  max_amount_xaf: null,
  role_id: null,
  scope_id: null,
  ...over,
});

/* ── W10: an unknown amount must mean "most scrutiny", not "none" ─────────── */

describe("unknown amount routing (W10)", () => {
  const banded = [
    step({
      workflow_step_id: "s1",
      step_seq: 1,
      min_amount_xaf: 1,
      max_amount_xaf: 1000000,
    }),
    step({
      workflow_step_id: "s2",
      step_seq: 2,
      min_amount_xaf: 1000001,
      max_amount_xaf: null,
    }),
  ];

  it("null amount applies to every step, so the full chain runs", () => {
    expect(stepApplies(banded[0], null)).toBe(true);
    expect(stepApplies(banded[1], null)).toBe(true);
    expect(applicableSteps(banded, null).map((s) => s.step_seq)).toEqual([
      1, 2,
    ]);
  });

  it("undefined is treated the same as null", () => {
    expect(stepApplies(banded[1], undefined)).toBe(true);
  });

  it("a real zero is still a zero and matches only bands that include it", () => {
    // The regression this guards: `num(amount) || 0` collapsed null onto 0, so a
    // record with no total matched no min-bounded step and skipped approval.
    expect(stepApplies(banded[0], 0)).toBe(false);
    expect(
      stepApplies(step({ min_amount_xaf: 0, max_amount_xaf: 100 }), 0),
    ).toBe(true);
    expect(applicableSteps(banded, 0)).toHaveLength(0);
  });

  it("a known amount still routes by band", () => {
    expect(applicableSteps(banded, 500).map((s) => s.step_seq)).toEqual([1]);
    expect(applicableSteps(banded, 5000000).map((s) => s.step_seq)).toEqual([
      2,
    ]);
  });
});

/* ── W9: the affirmative verb must match the step kind ────────────────────── */

describe("action must match step_kind (W9)", () => {
  it("each kind accepts its own verb plus reject/skip", () => {
    expect(KIND_ACTIONS.VALIDATE).toEqual(["validate", "reject", "skip"]);
    expect(KIND_ACTIONS.APPROVE).toEqual(["approve", "reject", "skip"]);
  });

  it("a VALIDATE step cannot be cleared with approve", async () => {
    const c = taskClient({ step_kind: "VALIDATE" });
    await expect(
      act(c, {
        approvalTaskId: "t1",
        action: "approve",
        actor: { user_id: "u1" },
      }),
    ).rejects.toMatchObject({ code: "WRONG_ACTION_FOR_STEP" });
  });

  it("an APPROVE step cannot be cleared with validate", async () => {
    const c = taskClient({ step_kind: "APPROVE" });
    await expect(
      act(c, {
        approvalTaskId: "t1",
        action: "validate",
        actor: { user_id: "u1" },
      }),
    ).rejects.toMatchObject({ code: "WRONG_ACTION_FOR_STEP" });
  });

  it("reject is allowed on either kind", async () => {
    const r = await act(taskClient({ step_kind: "VALIDATE" }), {
      approvalTaskId: "t1",
      action: "reject",
      actor: { user_id: "u1" },
    });
    expect(r).toMatchObject({ completed: true, approved: false });
  });
});

/* ── W2/W6: role and scope eligibility ────────────────────────────────────── */

describe("eligibility (W2/W6)", () => {
  const holder = {
    user_id: "u1",
    role_ids: ["role-fin"],
    scope_ids: ["sc-dla"],
  };

  it("an unrestricted step is open to anyone — the UI-built case today", () => {
    expect(() =>
      assertEligible({ step_role_id: null, step_scope_id: null }, holder),
    ).not.toThrow();
  });

  it("a role-bound step admits a holder of that role", () => {
    expect(() =>
      assertEligible({ step_role_id: "role-fin", step_scope_id: null }, holder),
    ).not.toThrow();
  });

  it("a role-bound step refuses someone who does not hold it", () => {
    expect(() =>
      assertEligible({ step_role_id: "role-hr", step_scope_id: null }, holder),
    ).toThrow(/role you do not hold/);
  });

  it("a scoped step admits someone whose closure contains that node", () => {
    // The closure is resolved downward from the actor's assignments, so a node
    // they sit above is inside it — authority flows down the organigramme.
    expect(() =>
      assertEligible({ step_role_id: null, step_scope_id: "sc-dla" }, holder),
    ).not.toThrow();
  });

  it("a scoped step refuses someone outside that part of the organisation", () => {
    expect(() =>
      assertEligible({ step_role_id: null, step_scope_id: "sc-ydé" }, holder),
    ).toThrow(/not responsible for/);
  });

  it("no scope assignment satisfies unscoped steps only — absence is not omnipresence", () => {
    const unassigned = { user_id: "u9", role_ids: ["role-fin"], scope_ids: [] };
    expect(() =>
      assertEligible({ step_role_id: null, step_scope_id: null }, unassigned),
    ).not.toThrow();
    expect(() =>
      assertEligible(
        { step_role_id: null, step_scope_id: "sc-dla" },
        unassigned,
      ),
    ).toThrow();
  });

  it("both gates must pass, not either", () => {
    expect(() =>
      assertEligible(
        { step_role_id: "role-hr", step_scope_id: "sc-dla" },
        holder,
      ),
    ).toThrow();
    expect(() =>
      assertEligible(
        { step_role_id: "role-fin", step_scope_id: "sc-ydé" },
        holder,
      ),
    ).toThrow();
    expect(() =>
      assertEligible(
        { step_role_id: "role-fin", step_scope_id: "sc-dla" },
        holder,
      ),
    ).not.toThrow();
  });

  it("the CEO bypasses both, as with requirePermission", () => {
    const ceo = { user_id: "u0", role_ids: [], scope_ids: [], is_ceo: true };
    expect(() =>
      assertEligible({ step_role_id: "role-hr", step_scope_id: "sc-ydé" }, ceo),
    ).not.toThrow();
  });

  it("a missing role_ids/scope_ids array is treated as empty, not as a bypass", () => {
    expect(() =>
      assertEligible(
        { step_role_id: "role-fin", step_scope_id: null },
        { user_id: "u2" },
      ),
    ).toThrow(/role you do not hold/);
  });
});

/* ── W5: maker-checker, enforced for everyone including the CEO ───────────── */

describe("maker-checker (W5)", () => {
  it("blocks the person who raised the record", async () => {
    const c = taskClient({}, { maker: "u1" });
    await expect(
      act(c, {
        approvalTaskId: "t1",
        action: "approve",
        actor: { user_id: "u1" },
      }),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
  });

  it("allows a different person", async () => {
    const c = taskClient({}, { maker: "u1" });
    const r = await act(c, {
      approvalTaskId: "t1",
      action: "approve",
      actor: { user_id: "u2" },
    });
    expect(r.completed).toBe(true);
  });

  it("is NOT waived for the CEO — segregation of duties has no bypass", async () => {
    const c = taskClient({}, { maker: "u1" });
    await expect(
      act(c, {
        approvalTaskId: "t1",
        action: "approve",
        actor: { user_id: "u1", is_ceo: true },
      }),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL" });
  });

  it("an unattributable maker is an absence, not a bypass — the decision proceeds", async () => {
    // e.g. a system-generated record, or TEST mode where actor attribution is
    // dropped to survive the cross-schema FK. Nothing to check against.
    const c = taskClient({}, { maker: null });
    const r = await act(c, {
      approvalTaskId: "t1",
      action: "approve",
      actor: { user_id: "u1" },
    });
    expect(r.completed).toBe(true);
  });
});

/* ── A4: the organigramme may not loop ────────────────────────────────────── */

describe("scope cycle guard (A4)", () => {
  /** Ancestor walk over a { child: parent } map. */
  const treeClient = (parents) => ({
    query: async (sql, params) => {
      if (!/RECURSIVE up/.test(sql)) return { rows: [] };
      const [from, target] = params;
      const seen = new Set();
      let cur = from;
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        if (cur === target) return { rows: [{ "?column?": 1 }] };
        cur = parents[cur] || null;
      }
      return { rows: [] };
    },
  });

  it("rejects a scope parented to itself", async () => {
    await expect(
      scopeService.assertNoCycle(treeClient({}), "a", "a"),
    ).rejects.toMatchObject({ code: "SCOPE_CYCLE" });
  });

  it("rejects an indirect loop the FE dropdown cannot catch (A→B→A)", async () => {
    // The form only excludes the node being edited from its own parent list, so
    // this shape was reachable through the UI.
    await expect(
      scopeService.assertNoCycle(treeClient({ b: "a" }), "a", "b"),
    ).rejects.toMatchObject({ code: "SCOPE_CYCLE" });
  });

  it("rejects a deeper loop (A→B→C→A)", async () => {
    await expect(
      scopeService.assertNoCycle(treeClient({ c: "b", b: "a" }), "a", "c"),
    ).rejects.toMatchObject({ code: "SCOPE_CYCLE" });
  });

  it("allows a legitimate re-parent", async () => {
    await expect(
      scopeService.assertNoCycle(treeClient({ hq: null }), "dla", "hq"),
    ).resolves.toBeUndefined();
  });

  it("no-ops for a root and for a create with no id yet", async () => {
    await expect(
      scopeService.assertNoCycle(treeClient({}), "a", null),
    ).resolves.toBeUndefined();
    await expect(
      scopeService.assertNoCycle(treeClient({}), null, "hq"),
    ).resolves.toBeUndefined();
  });
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

/**
 * A client holding one PENDING task on one step. `stepOver` patches the step
 * columns the join returns; `maker` is what event_log attributes the entity to.
 */
function taskClient(stepOver = {}, { maker = null } = {}) {
  const task = {
    approval_task_id: "t1",
    status: "PENDING",
    entity_ref: "invoice:1",
    amount_xaf: 500,
    step_seq: 1,
    workflow_id: "w1",
    step_kind: "APPROVE",
    step_role_id: null,
    step_scope_id: null,
    step_capability_code: null,
    ...stepOver,
  };
  return {
    task,
    query: async (sql) => {
      if (/JOIN workflow_step ws ON/.test(sql)) return { rows: [task] };
      if (/FROM event_log/.test(sql))
        return { rows: maker ? [{ actor_user_id: maker }] : [] };
      if (/^UPDATE approval_task/.test(sql.trim())) return { rows: [] };
      if (/FROM workflow_step WHERE workflow_id/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
}
