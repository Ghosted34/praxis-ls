"use strict";
/**
 * F8 (doc/SALES_CRM_FEATURES.md#F8) — marketing campaign lifecycle, field locks
 * and KPI arithmetic. DB-free: the rules module is pure, and the service is
 * exercised with the repo, event emitter and job queue mocked, so what is under
 * test is the orchestration rather than Postgres.
 *
 * The four things worth breaking a build over:
 *   1. A campaign cannot reach ACTIVE without passing through approval.
 *   2. Approving and resuming are different acts even though they share a
 *      target state.
 *   3. A plan cannot be edited once submitted, and figures cannot be recorded
 *      before the campaign runs.
 *   4. A rejection without a reason is refused by the API, not just by the form.
 */
const rules = require("../../src/modules/sales/marketing_campaign/marketing_campaign.rules");

describe("F8 campaign lifecycle", () => {
  test("a draft can only be submitted — never activated directly", () => {
    expect(rules.assertTransition("DRAFT", "PENDING_APPROVAL")).toBe(true);
    // The whole control F8 adds. If this ever passes, approval is optional.
    expect(() => rules.assertTransition("DRAFT", "ACTIVE")).toThrow(/DRAFT -> ACTIVE/);
  });

  test("a pending campaign has no ordinary exit at all", () => {
    for (const to of ["ACTIVE", "PAUSED", "ENDED", "DRAFT"]) {
      expect(() => rules.assertTransition("PENDING_APPROVAL", to)).toThrow(/approved or rejected/);
    }
  });

  test("approve and reject are the only exits, and only from PENDING_APPROVAL", () => {
    expect(rules.assertDecision("PENDING_APPROVAL", "APPROVE")).toBe("ACTIVE");
    expect(rules.assertDecision("PENDING_APPROVAL", "REJECT")).toBe("DRAFT");
    expect(() => rules.assertDecision("ACTIVE", "APPROVE")).toThrow(/is ACTIVE/);
    expect(() => rules.assertDecision("DRAFT", "APPROVE")).toThrow(/is DRAFT/);
    expect(() => rules.assertDecision("PENDING_APPROVAL", "MAYBE")).toThrow(/Unknown decision/);
  });

  test("a running campaign pauses, resumes and ends; an ended one is terminal", () => {
    expect(rules.assertTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(rules.assertTransition("PAUSED", "ACTIVE")).toBe(true);
    expect(rules.assertTransition("ACTIVE", "ENDED")).toBe(true);
    expect(() => rules.assertTransition("ENDED", "ACTIVE")).toThrow();
  });

  /**
   * Resume and approve both land on ACTIVE. The rules layer is what keeps them
   * apart — a resume goes through assertTransition, an approval cannot — and
   * the routes hang two different permissions off that split. If both were
   * reachable through the transition endpoint, `TRANSITION_ACTION.ACTIVE =
   * "edit"` would be a route to self-approval.
   */
  test("resuming and approving share a target state but not a path", () => {
    expect(rules.assertTransition("PAUSED", "ACTIVE")).toBe(true);
    expect(() => rules.assertTransition("PENDING_APPROVAL", "ACTIVE")).toThrow();
    expect(rules.assertDecision("PENDING_APPROVAL", "APPROVE")).toBe("ACTIVE");
    expect(() => rules.assertDecision("PAUSED", "APPROVE")).toThrow();
  });
});

describe("F8 field locks", () => {
  test("a draft accepts the plan and refuses figures it cannot have produced", () => {
    expect(rules.assertEditable("DRAFT", { budget_amount: 500000, target_leads: 60 })).toBe(true);
    expect(() => rules.assertEditable("DRAFT", { actual_leads: 10 })).toThrow(/has not run yet/);
  });

  test("the plan closes the moment the campaign runs — an approved budget stays approved", () => {
    for (const status of ["ACTIVE", "PAUSED", "ENDED"]) {
      expect(() => rules.assertEditable(status, { budget_amount: 1 })).toThrow(/plan is fixed/);
      expect(() => rules.assertEditable(status, { target_leads: 1 })).toThrow(/plan is fixed/);
      expect(rules.assertEditable(status, { actual_leads: 43, actual_won: 4 })).toBe(true);
    }
  });

  test("a pending campaign's plan is editable — the ROUTE is what restricts it to an approver", () => {
    expect(rules.assertEditable("PENDING_APPROVAL", { budget_amount: 400000 })).toBe(true);
    expect(() => rules.assertEditable("PENDING_APPROVAL", { actual_won: 1 })).toThrow(/has not run yet/);
  });

  test("the error names the offending fields, so the drawer can point at them", () => {
    try {
      rules.assertEditable("ACTIVE", { budget_amount: 1, target_won: 2, actual_leads: 3 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e.code).toBe("PLAN_LOCKED");
      expect(e.details.fields.sort()).toEqual(["budget_amount", "target_won"]);
    }
  });

  test("touchesActuals is what makes the hand-entered stamp honest", () => {
    expect(rules.touchesActuals({ actual_leads: 0 })).toBe(true);
    expect(rules.touchesActuals({ budget_amount: 10 })).toBe(false);
    expect(rules.touchesActuals({})).toBe(false);
  });
});

describe("F8 KPI arithmetic", () => {
  test("conversion comes from the totals, not from averaging per-campaign rates", () => {
    // 1/1 and 90/900. Averaging the two rates gives 55%; the truth is 10.1%.
    const kpi = rules.kpiFrom({ total_budget: "2000000", total_leads: 901, total_won: 91, campaigns: 2 });
    expect(kpi.TOTAL_BUDGET).toBe(2000000);
    expect(kpi.LEADS).toBe(901);
    expect(kpi.WON).toBe(91);
    expect(kpi.AVG_CONVERSION).toBe(10.1);
  });

  test("an empty register reads zero, not NaN and not a division by zero", () => {
    const kpi = rules.kpiFrom({});
    expect(kpi).toEqual({ TOTAL_BUDGET: 0, LEADS: 0, WON: 0, AVG_CONVERSION: 0, CAMPAIGNS: 0 });
    expect(rules.emptyKpi()).toEqual(kpi);
  });

  test("the tiles match a hand calculation", () => {
    // Three campaigns: 1.2M / 40 leads / 4 won, 800k / 60 / 6, 0 / 0 / 0.
    const kpi = rules.kpiFrom({ total_budget: 2000000, total_leads: 100, total_won: 10, campaigns: 3 });
    expect(kpi.TOTAL_BUDGET).toBe(1200000 + 800000);
    expect(kpi.LEADS).toBe(40 + 60);
    expect(kpi.WON).toBe(4 + 6);
    expect(kpi.AVG_CONVERSION).toBe(10);
  });

  test("cost per lead is null, not zero, when nothing has been produced", () => {
    expect(rules.costPerLead({ budget_amount: 1000000, actual_leads: 40 })).toBe(25000);
    expect(rules.costPerLead({ budget_amount: 1000000, actual_leads: 0 })).toBeNull();
    expect(rules.targetCostPerLead({ budget_amount: 900000, target_leads: 60 })).toBe(15000);
    expect(rules.targetCostPerLead({ budget_amount: 900000 })).toBeNull();
  });
});

/* ─── service orchestration ────────────────────────────────────────────────── */

jest.mock("../../src/modules/sales/marketing_campaign/marketing_campaign.repo");
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (c, id) => id || null,
  emitEvent: jest.fn(),
  audit: jest.fn(),
}));
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn().mockResolvedValue({}) }));

const repo = require("../../src/modules/sales/marketing_campaign/marketing_campaign.repo");
const { emitEvent, audit } = require("../../src/shared/events/emit");
const service = require("../../src/modules/sales/marketing_campaign/marketing_campaign.service");

const client = {}; // unused — the repo is mocked

describe("F8 campaign service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repo.WRITABLE = jest.requireActual(
      "../../src/modules/sales/marketing_campaign/marketing_campaign.repo",
    ).WRITABLE;
    repo.update.mockImplementation(async (_c, id, fields) => ({ campaign_id: id, ...fields }));
  });

  test("submitting stamps who and when, and clears a previous verdict", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", status: "DRAFT", rejection_reason: "too dear" });
    const row = await service.transition(client, { id: "c1", to: "PENDING_APPROVAL", actor: { user_id: "u1" } });
    expect(row.status).toBe("PENDING_APPROVAL");
    expect(row.submitted_by_user_id).toBe("u1");
    expect(row.submitted_at).toBeInstanceOf(Date);
    // A resubmitted campaign showing the reason it was sent back the FIRST time
    // is how a corrected budget still looks rejected.
    expect(row.rejection_reason).toBeNull();
    expect(emitEvent).toHaveBeenCalledWith(client, expect.objectContaining({ eventTypeKey: "campaign.submitted" }));
  });

  test("approval records the approver — the whole point of the state", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", status: "PENDING_APPROVAL" });
    const row = await service.approve(client, { id: "c1", actor: { user_id: "boss" } });
    expect(row.status).toBe("ACTIVE");
    expect(row.approved_by_user_id).toBe("boss");
    expect(row.approved_at).toBeInstanceOf(Date);
    expect(emitEvent).toHaveBeenCalledWith(client, expect.objectContaining({ eventTypeKey: "campaign.approved" }));
    expect(audit).toHaveBeenCalled();
  });

  test("a rejection without a reason is refused by the API, not just by the form", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", status: "PENDING_APPROVAL" });
    await expect(service.reject(client, { id: "c1", reason: "   " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(service.reject(client, { id: "c1" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  test("a rejection returns it to draft with the reason attached", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", status: "PENDING_APPROVAL" });
    const row = await service.reject(client, { id: "c1", reason: "  reduce by 20%  ", actor: { user_id: "boss" } });
    expect(row.status).toBe("DRAFT");
    expect(row.rejection_reason).toBe("reduce by 20%");
    expect(row.rejected_by_user_id).toBe("boss");
  });

  test("recording figures stamps who typed them and when", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", status: "ACTIVE" });
    const row = await service.update(client, {
      id: "c1",
      patch: { actual_leads: 43, actual_won: 4 },
      actor: { user_id: "u2" },
    });
    expect(row.actual_leads).toBe(43);
    expect(row.actuals_updated_by_user_id).toBe("u2");
    expect(row.actuals_updated_at).toBeInstanceOf(Date);
    expect(emitEvent).toHaveBeenCalledWith(client, expect.objectContaining({ eventTypeKey: "campaign.actuals_recorded" }));
  });

  test("an ordinary plan edit does not pretend figures were updated", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", status: "DRAFT" });
    const row = await service.update(client, { id: "c1", patch: { budget_amount: 250000 }, actor: {} });
    expect(row.budget_amount).toBe(250000);
    expect(row.actuals_updated_at).toBeUndefined();
  });

  test("the budget of a running campaign cannot be edited through the patch path", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", status: "ACTIVE" });
    await expect(service.update(client, { id: "c1", patch: { budget_amount: 1 }, actor: {} }))
      .rejects.toMatchObject({ code: "PLAN_LOCKED" });
    expect(repo.update).not.toHaveBeenCalled();
  });

  test("status cannot be smuggled in through a patch — it is not writable", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", status: "DRAFT" });
    const row = await service.update(client, { id: "c1", patch: { status: "ACTIVE", name: "Q3" }, actor: {} });
    expect(row.name).toBe("Q3");
    expect(row.status).toBeUndefined();
  });
});
