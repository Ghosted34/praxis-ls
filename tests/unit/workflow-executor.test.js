"use strict";
/** Workflow executor (BUILD_CONVENTIONS §2): pure routing + start/act lifecycle. */
const {
  stepApplies,
  applicableSteps,
  nextStep,
  start,
  act,
} = require("../../src/services/workflow/executor");

const S = (seq, kind, min, max) => ({
  workflow_step_id: "s" + seq,
  step_seq: seq,
  step_kind: kind,
  min_amount_xaf: min,
  max_amount_xaf: max,
  role_id: "r" + seq,
});

describe("pure step routing (amount thresholds + order)", () => {
  const steps = [
    S(1, "VALIDATE", null, null),
    S(2, "APPROVE", 0, 1000000),
    S(3, "APPROVE", 1000001, null),
  ];
  it("stepApplies respects min/max", () => {
    expect(stepApplies(S(1, "APPROVE", 1000001, null), 500000)).toBe(false);
    expect(stepApplies(S(1, "APPROVE", 1000001, null), 2000000)).toBe(true);
    expect(stepApplies(S(1, "VALIDATE", null, null), 0)).toBe(true);
  });
  it("applicableSteps: small amount hits validate + low approver, not high approver", () => {
    const got = applicableSteps(steps, 500000).map((s) => s.step_seq);
    expect(got).toEqual([1, 2]);
  });
  it("applicableSteps: large amount routes to the high approver", () => {
    const got = applicableSteps(steps, 5000000).map((s) => s.step_seq);
    expect(got).toEqual([1, 3]);
  });
  it("nextStep advances by seq within the applicable set", () => {
    expect(nextStep(steps, 1, 500000).step_seq).toBe(2);
    expect(nextStep(steps, 2, 500000)).toBeNull();
    expect(nextStep(steps, 1, 5000000).step_seq).toBe(3);
  });
});

function fakeClient({ workflow, steps }) {
  const created = [];
  return {
    created,
    query: async (sql, params) => {
      if (/FROM workflow w JOIN event_type/.test(sql))
        return { rows: workflow ? [workflow] : [] };
      if (/FROM workflow_step WHERE workflow_id/.test(sql))
        return { rows: steps };
      if (/^INSERT INTO approval_task/.test(sql.trim())) {
        const row = {
          approval_task_id: "t" + (created.length + 1),
          status: "PENDING",
          workflow_step_id: params[1],
          entity_ref: params[2],
          amount_xaf: params[3],
        };
        created.push(row);
        return { rows: [row] };
      }
      if (/JOIN workflow_step ws ON/.test(sql)) {
        // getTask: return the last created task joined to its step_seq
        const t = created.find((x) => x.approval_task_id === params[0]);
        const st = steps.find((s) => s.workflow_step_id === t.workflow_step_id);
        return {
          rows: [
            { ...t, step_seq: st.step_seq, workflow_id: workflow.workflow_id },
          ],
        };
      }
      if (/^UPDATE approval_task/.test(sql.trim())) {
        const t = created.find((x) => x.approval_task_id === params[0]);
        if (t) t.status = params[1];
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

describe("start + act lifecycle", () => {
  const workflow = { workflow_id: "w1" };
  const steps = [S(1, "VALIDATE", null, null), S(2, "APPROVE", null, null)];

  it("auto-approves when no workflow is bound", async () => {
    const c = fakeClient({ workflow: null, steps: [] });
    const r = await start(c, {
      eventTypeKey: "invoice.issued",
      entityRef: "invoice:1",
      amountXaf: 100,
    });
    expect(r.autoApproved).toBe(true);
  });

  it("opens step 1, then advances to step 2, then completes approved", async () => {
    const c = fakeClient({ workflow, steps });
    const s = await start(c, {
      eventTypeKey: "invoice.issued",
      entityRef: "invoice:1",
      amountXaf: 500,
    });
    expect(s.autoApproved).toBe(false);
    expect(s.step_seq).toBe(1);

    const a1 = await act(c, {
      approvalTaskId: "t1",
      action: "validate",
      actor: { user_id: "u1" },
    });
    expect(a1.advanced).toBe(true);
    expect(a1.step_seq).toBe(2);

    const a2 = await act(c, {
      approvalTaskId: "t2",
      action: "approve",
      actor: { user_id: "u2" },
    });
    expect(a2.completed).toBe(true);
    expect(a2.approved).toBe(true);
  });

  it("rejection completes as not-approved", async () => {
    const c = fakeClient({ workflow, steps });
    await start(c, {
      eventTypeKey: "invoice.issued",
      entityRef: "invoice:2",
      amountXaf: 500,
    });
    const r = await act(c, {
      approvalTaskId: "t1",
      action: "reject",
      actor: { user_id: "u1" },
    });
    expect(r.completed).toBe(true);
    expect(r.approved).toBe(false);
  });
});
