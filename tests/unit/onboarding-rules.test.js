"use strict";
/**
 * Onboarding rules (0703).
 *
 * ── THE TEST THAT MATTERS MOST ─────────────────────────────────────────────
 *
 * `completionBlockers`. The mandatory items are the statutory ones — the CNPS
 * registration, the signed contract, the safety briefing — and they are exactly
 * the ones a busy first week loses. A checklist that can be marked complete with
 * those outstanding does not record that onboarding finished; it records that
 * somebody wanted the row to go away. It returns the ITEMS, not a count, because
 * a refusal that does not name what to do next gets worked around.
 *
 * ── THE SECOND ONE ─────────────────────────────────────────────────────────
 *
 * Negative `due_days`. A contract signed and a laptop ordered BEFORE somebody
 * walks in is most of what good onboarding is, and the arithmetic has to cross
 * a month and a year boundary backwards to be trusted with it.
 */

const rules = require("../../src/modules/hr/onboarding/onboarding.rules");

/* ── Due dates ──────────────────────────────────────────────────────────── */

describe("due dates from an offset", () => {
  it("counts forward from the start date", () => {
    expect(rules.dueDateFor("2026-09-01", 5)).toBe("2026-09-06");
  });

  it("counts BACKWARDS for a pre-arrival task", () => {
    // "Signed contract on file, day -7."
    expect(rules.dueDateFor("2026-09-01", -7)).toBe("2026-08-25");
  });

  it("crosses a year boundary backwards", () => {
    expect(rules.dueDateFor("2027-01-04", -7)).toBe("2026-12-28");
  });

  it("crosses February correctly in a leap year", () => {
    expect(rules.dueDateFor("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("returns null when there is no start date to offset from", () => {
    // Inventing today as the base would quietly date the whole checklist to
    // whenever somebody pressed the button.
    expect(rules.dueDateFor(null, 5)).toBeNull();
    expect(rules.dueDateFor("", 5)).toBeNull();
  });

  it("treats a missing offset as the start date itself, not as an error", () => {
    expect(rules.dueDateFor("2026-09-01", null)).toBe("2026-09-01");
  });

  it("does not let the hour of the day shift a due date", () => {
    expect(rules.dueDateFor("2026-09-01T23:30:00Z", 1)).toBe("2026-09-02");
    expect(rules.dueDateFor("2026-09-01T00:30:00Z", 1)).toBe("2026-09-02");
  });
});

/* ── Item state ─────────────────────────────────────────────────────────── */

describe("the state of one item", () => {
  const today = "2026-08-17";

  it("reports a done item as done regardless of its date", () => {
    expect(rules.itemState({ is_done: true, due_on: "2020-01-01" }, { today }).state).toBe("DONE");
  });

  it("reports an overdue item with how late it is", () => {
    const r = rules.itemState({ due_on: "2026-08-10" }, { today });
    expect(r.state).toBe("OVERDUE");
    expect(r.days_remaining).toBe(-7);
  });

  it("separates DUE_SOON from PENDING", () => {
    // The only state where doing something now still prevents lateness.
    expect(rules.itemState({ due_on: "2026-08-19" }, { today }).state).toBe("DUE_SOON");
    expect(rules.itemState({ due_on: "2026-09-19" }, { today }).state).toBe("PENDING");
  });

  it("counts something due today as due soon, not overdue", () => {
    const r = rules.itemState({ due_on: today }, { today });
    expect(r.state).toBe("DUE_SOON");
    expect(r.days_remaining).toBe(0);
  });

  it("calls an undated item UNDATED rather than filing it under fine", () => {
    // An item nobody dated will never appear in a chase list, so it has to be
    // visible AS undated.
    expect(rules.itemState({ due_on: null }, { today }).state).toBe("UNDATED");
  });

  it("respects a caller's own soon window", () => {
    expect(rules.itemState({ due_on: "2026-08-24" }, { today, soonDays: 10 }).state).toBe("DUE_SOON");
    expect(rules.itemState({ due_on: "2026-08-24" }, { today, soonDays: 3 }).state).toBe("PENDING");
  });
});

/* ── Progress ───────────────────────────────────────────────────────────── */

describe("checklist progress", () => {
  const today = "2026-08-17";
  const items = [
    { is_done: true, due_on: "2026-08-01" },
    { is_done: true, due_on: "2026-08-10" },
    { is_done: false, due_on: "2026-08-10" },   // overdue
    { is_done: false, due_on: "2026-08-18" },   // due soon
    { is_done: false, due_on: "2026-12-01" },   // pending
    { is_done: false, due_on: null },           // undated
  ];

  it("counts each state separately", () => {
    expect(rules.progress(items, { today })).toMatchObject({
      total: 6, done: 2, outstanding: 4, overdue: 1, due_soon: 1, undated: 1,
    });
  });

  it("computes the percentage over ALL items, not over dated ones", () => {
    // Normalising over a subset would make the number RISE when somebody
    // deletes a date.
    expect(rules.progress(items, { today }).percent).toBe(33);
  });

  it("reports an empty checklist as 0%, not as complete", () => {
    // A checklist with nothing on it has not been done.
    expect(rules.progress([], { today })).toMatchObject({ total: 0, percent: 0 });
  });
});

/* ── Completion ─────────────────────────────────────────────────────────── */

describe("what stops a checklist being completed", () => {
  it("names the outstanding mandatory items rather than counting them", () => {
    const blockers = rules.completionBlockers([
      { label: "Register with CNPS", is_mandatory: true, is_done: false },
      { label: "Order a laptop", is_mandatory: false, is_done: false },
      { label: "Signed contract", is_mandatory: true, is_done: true },
    ]);
    expect(blockers).toHaveLength(1);
    // The message a person needs is "the CNPS registration is still open".
    expect(blockers[0].label).toBe("Register with CNPS");
  });

  it("lets a checklist complete with optional items outstanding", () => {
    expect(rules.completionBlockers([
      { label: "Order a laptop", is_mandatory: false, is_done: false },
      { label: "Register with CNPS", is_mandatory: true, is_done: true },
    ])).toEqual([]);
  });

  it("does not block an empty checklist", () => {
    expect(rules.completionBlockers([])).toEqual([]);
  });
});

/* ── Template selection ─────────────────────────────────────────────────── */

describe("which template applies", () => {
  const generic = { name: "Standard new starter", is_active: true };
  const dept = { name: "Warehouse", department: "Warehouse", is_active: true };
  const exact = { name: "Forklift operator", department: "Warehouse", job_title: "Forklift operator", is_active: true };
  const emp = { department: "Warehouse", job_title: "Forklift operator" };

  it("prefers the MORE SPECIFIC template", () => {
    // Otherwise the catch-all shadows the one somebody wrote specifically for
    // warehouse operatives, which is the whole reason they wrote it.
    expect(rules.pickTemplate([generic, dept, exact], emp).name).toBe("Forklift operator");
    expect(rules.pickTemplate([generic, dept], emp).name).toBe("Warehouse");
    expect(rules.pickTemplate([generic], emp).name).toBe("Standard new starter");
  });

  it("does not apply a template for a different department", () => {
    expect(rules.pickTemplate([dept], { department: "Finance" })).toBeNull();
  });

  it("ignores inactive templates", () => {
    expect(rules.pickTemplate([{ ...exact, is_active: false }, generic], emp).name).toBe("Standard new starter");
  });

  it("breaks a specificity tie on priority, then stably on name", () => {
    // Without the final tie-break the winner is whatever order the planner
    // returned, which changes between runs.
    const a = { name: "Alpha", department: "Warehouse", is_active: true, priority: 0 };
    const b = { name: "Beta", department: "Warehouse", is_active: true, priority: 5 };
    expect(rules.pickTemplate([a, b], emp).name).toBe("Beta");
    expect(rules.pickTemplate([{ ...b, priority: 0 }, a], emp).name).toBe("Alpha");
  });

  it("matches a department typed with different case and stray space", () => {
    expect(rules.templateApplies({ department: " warehouse " }, emp)).toBe(true);
  });

  it("returns null rather than a default when nothing matches", () => {
    expect(rules.pickTemplate([], emp)).toBeNull();
  });
});

/* ── Raising items ──────────────────────────────────────────────────────── */

describe("turning a template into a checklist", () => {
  const tpl = [
    { label: "Welcome tour", due_days: 0, sort_order: 30 },
    { label: "Signed contract", due_days: -7, sort_order: 10, is_mandatory: true },
    { label: "CNPS", due_days: -3, sort_order: 20, owner_role: "HR", sop_document_id: "sop-1" },
  ];

  it("orders by the template's sort order and renumbers densely", () => {
    const out = rules.itemsFromTemplate(tpl, { startsOn: "2026-09-01" });
    expect(out.map((i) => i.label)).toEqual(["Signed contract", "CNPS", "Welcome tour"]);
    expect(out.map((i) => i.sort_order)).toEqual([10, 20, 30]);
  });

  it("resolves each offset against the start date", () => {
    const out = rules.itemsFromTemplate(tpl, { startsOn: "2026-09-01" });
    expect(out.map((i) => i.due_on)).toEqual(["2026-08-25", "2026-08-29", "2026-09-01"]);
  });

  it("keeps the SOP a reference and the text a copy", () => {
    // Editing a template must not rewrite the checklist of somebody who started
    // three weeks ago — but an item should point at the CURRENT procedure.
    const out = rules.itemsFromTemplate(tpl, { startsOn: "2026-09-01" });
    expect(out[1]).toMatchObject({ label: "CNPS", owner_role: "HR", sop_document_id: "sop-1" });
  });

  it("raises undated items when the hire has no start date", () => {
    // Better than dating them from today, which would be wrong for every one.
    const out = rules.itemsFromTemplate(tpl, {});
    expect(out.every((i) => i.due_on === null)).toBe(true);
  });

  it("defaults is_mandatory to false rather than carrying undefined through", () => {
    const out = rules.itemsFromTemplate([{ label: "x", due_days: 0 }], { startsOn: "2026-09-01" });
    expect(out[0].is_mandatory).toBe(false);
  });
});

/* ── Carrying a candidate forward ───────────────────────────────────────── */

describe("what a candidate carries onto a new vacancy", () => {
  const past = {
    applicant_id: "old-1",
    full_name: "Marie Ngo",
    email: "marie@example.com",
    phone: "+237600000000",
    cv_vault_id: "doc-9",
    skills: ["customs", "french"],
    experience_years: 6,
    expected_salary: 750000,
    portfolio_url: "https://example.com/marie",
    status: "TALENT_POOL",
    ai_score: 84,
    ai_summary: "Strong on customs clearance.",
    ai_breakdown: { skills: 90 },
    rating: 4.5,
  };

  it("carries the CV, the skills and the contact details", () => {
    expect(rules.carryForward(past)).toMatchObject({
      full_name: "Marie Ngo",
      email: "marie@example.com",
      cv_vault_id: "doc-9",
      skills: ["customs", "french"],
      experience_years: 6,
    });
  });

  it("does NOT carry the score", () => {
    // A score is against a JOB DESCRIPTION. Last year's Customs Officer number
    // on a Finance Manager vacancy means nothing — and it would sort.
    const out = rules.carryForward(past);
    expect(out.ai_score).toBeUndefined();
    expect(out.ai_summary).toBeUndefined();
    expect(out.ai_breakdown).toBeUndefined();
  });

  it("does not carry the interviewer's rating or the old status", () => {
    const out = rules.carryForward(past);
    expect(out.rating).toBeUndefined();
    expect(out.status).toBeUndefined();
  });

  it("omits skills entirely rather than sending an empty array over a default", () => {
    // job_applicant.skills is NOT NULL DEFAULT '{}'; writing [] where the bench
    // row had none is the same value with an extra write, but sending
    // `undefined` through as a column would be a null violation.
    const out = rules.carryForward({ full_name: "Bench Person" });
    expect("skills" in out).toBe(false);
    expect(out.full_name).toBe("Bench Person");
  });

  it("normalises a hand-entered bench row's missing fields to null, not undefined", () => {
    const out = rules.carryForward({ full_name: "Bench Person" });
    expect(out.email).toBeNull();
    expect(out.cv_vault_id).toBeNull();
  });
});
