"use strict";
/**
 * 13900 — a task can name the operations file it is work on.
 *
 * ── WHAT IS WORTH A TEST HERE, AND WHAT IS NOT ─────────────────────────────
 *
 * The column pair is enforced in three places and only one of them is a unit
 * this suite can reach. The table's CHECK (a stage with no file) needs a
 * database; the picker's dependent list is a React concern. What is left is
 * the part that is pure logic and is also the part that silently corrupts
 * data when it is wrong: which columns a write ends up with.
 *
 * Two rules, both of which produce a row the UI cannot render if they break:
 *
 *   · a stage must belong to the file it is filed under — otherwise the file's
 *     Tasks tab shows a stage from another shipment;
 *   · clearing the file clears the stage — otherwise the task keeps a stage
 *     pointing at a file it is no longer on, and the Analytics rollup counts
 *     it under "no file" while the panel plainly shows one.
 *
 * The SQL side is asserted the way the rest of tasks.repo is: the statement is
 * captured and its placeholders checked against its parameters, because a
 * filter added to the WHERE list and not to the array is a 42P02 that only
 * fires on the filter combination nobody tried.
 */

const repo = require("../../src/modules/dashboard/workspace/tasks.repo");

function mockClient(rows = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      return { rows, rowCount: rows.length };
    },
  };
}

function placeholders(sql) {
  return [...new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/** Exactly 1..params.length — a gap is 42P02, a spare is 42P18. */
function expectBound({ sql, params }) {
  expect(placeholders(sql)).toEqual(params.map((_, i) => i + 1));
}

const VIS = { audience: "mine", userId: "u1" };
const WINDOW = { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" };

describe("tasks.repo — the file link in SQL", () => {
  it("listTasks binds the file and the stage alongside every other filter", async () => {
    const c = mockClient();
    await repo.listTasks(c, {
      ...VIS,
      status: "TO_DO",
      priority: "HIGH",
      assignedTo: "u2",
      dossierId: "d1",
      milestoneInstanceId: "m1",
      q: "bl",
      limit: 50,
      offset: 0,
    });
    const call = c.calls[0];
    expectBound(call);
    expect(call.sql).toContain("t.dossier_id = $");
    expect(call.sql).toContain("t.milestone_instance_id = $");
    expect(call.params).toContain("d1");
    expect(call.params).toContain("m1");
  });

  it("the board honours the file filter, so Board↔List does not widen it", async () => {
    const c = mockClient();
    await repo.boardTasks(c, { ...VIS, dossierId: "d1" });
    const call = c.calls[0];
    expectBound(call);
    expect(call.sql).toContain("t.dossier_id = $");
  });

  it("every task read joins the file through dossier_visible, never the base table", async () => {
    // A DRAFT is half-typed wizard state, not a file. The base table would let
    // one surface on a task row; `dossier-draft-isolation.test.js` guards the
    // module list, this guards the statement.
    const c = mockClient();
    await repo.listTasks(c, { ...VIS, limit: 10, offset: 0 });
    expect(c.calls[0].sql).toContain("dossier_visible");
    expect(c.calls[0].sql).not.toMatch(/JOIN\s+dossier\b(?!_)/);
  });

  it("the file filter rides the SHARED analytics scope, so it narrows every panel", async () => {
    // Not the by-file panel's own WHERE: a filter honoured by one chart and
    // ignored by the other seven is the disagreement the dashboard's header
    // refuses to ship.
    const scope = repo.analyticsScope(VIS, { ...WINDOW, dossierId: "d1" }, 1);
    expect(scope.where.join(" ")).toContain("t.dossier_id = $");
    expect(scope.params).toContain("d1");
  });

  it("analyticsByFile binds its parameters and counts linked work only", async () => {
    const c = mockClient();
    await repo.analyticsByFile(c, {
      visibility: VIS,
      filters: { ...WINDOW, dossierId: null },
      nowIso: "2026-01-15T00:00:00Z",
    });
    const call = c.calls[0];
    expectBound(call);
    // The NULL group would be every personal reminder in the tenant, dwarfing
    // every real file and answering nothing.
    expect(call.sql).toContain("t.dossier_id IS NOT NULL");
    expect(call.sql).toContain("GROUP BY t.dossier_id");
    // Overdue first: the panel answers "which file is in trouble", not "which
    // file is busiest".
    expect(call.sql).toContain("ORDER BY overdue_tasks DESC");
  });

  it("analyticsByMilestone binds its parameters", async () => {
    const c = mockClient();
    await repo.analyticsByMilestone(c, {
      visibility: VIS,
      filters: { ...WINDOW, dossierId: "d1" },
      nowIso: "2026-01-15T00:00:00Z",
    });
    expectBound(c.calls[0]);
    expect(c.calls[0].sql).toContain("GROUP BY t.milestone_instance_id");
  });

  it("updateTask can write the link, and still refuses the derived columns", async () => {
    const c = mockClient([{ task_id: "t1" }]);
    await repo.updateTask(c, "t1", {
      dossier_id: "d1",
      milestone_instance_id: "m1",
      // Derived, and written only by the reminder sweep — a caller setting it
      // directly would desynchronise it from reminder_minutes.
      remind_at: "2026-01-01T00:00:00Z",
    });
    const { sql } = c.calls[0];
    expect(sql).toContain("dossier_id = $");
    expect(sql).toContain("milestone_instance_id = $");
    expect(sql).not.toContain("remind_at = $");
  });

  it("clearing the file writes NULL rather than omitting the column", async () => {
    // `?? null` in the repo, not `if (patch[key])`: an omitted column leaves
    // the old file on the row, which is the difference between unlinking a
    // task and appearing to.
    const c = mockClient([{ task_id: "t1" }]);
    await repo.updateTask(c, "t1", { dossier_id: null, milestone_instance_id: null });
    const { sql, params } = c.calls[0];
    expect(sql).toContain("dossier_id = $");
    expect(params.slice(0, 2)).toEqual([null, null]);
  });
});

/**
 * The two rules that decide what a write ends up with. Enforced in the service
 * rather than only in the table because the stronger one — the stage belongs to
 * THAT file — reads a second table and cannot be a CHECK, and because a
 * mismatch deserves a sentence naming both records rather than a 23514.
 */
describe("tasks.service.resolveFileLink — the rules a write is settled by", () => {
  const service = require("../../src/modules/dashboard/workspace/tasks.service");

  /** A client whose only job is to answer the milestone→file lookup. */
  const stageOn = (dossierId, label = "Customs cleared") => ({
    query: async () => ({
      rows: [{ milestone_instance_id: "m1", dossier_id: dossierId, label }],
      rowCount: 1,
    }),
  });
  const noStage = { query: async () => ({ rows: [], rowCount: 0 }) };

  it("leaves a write that names neither column alone", async () => {
    // An edit to a title must not touch the link, and must not cost the
    // milestone lookup either.
    expect(await service.resolveFileLink(noStage, { title: "x" })).toEqual({});
  });

  it("accepts a stage that belongs to the file it is filed under", async () => {
    const patch = await service.resolveFileLink(stageOn("d1"), {
      dossier_id: "d1",
      milestone_instance_id: "m1",
    });
    expect(patch).toEqual({ dossier_id: "d1", milestone_instance_id: "m1" });
  });

  it("refuses a stage of ANOTHER file, and names it", async () => {
    await expect(
      service.resolveFileLink(stageOn("d2", "Vessel departed"), {
        dossier_id: "d1",
        milestone_instance_id: "m1",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a stage with no file at all", async () => {
    // The table's CHECK is the floor; this is the sentence the user can act on.
    await expect(
      service.resolveFileLink(noStage, { milestone_instance_id: "m1" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("404s a stage that no longer exists", async () => {
    await expect(
      service.resolveFileLink(noStage, { dossier_id: "d1", milestone_instance_id: "m1" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("clearing the file clears the stage, even when the caller only sent the file", async () => {
    // The rule lives here and not in the dialog because the API has other
    // callers — a rule that lives in one form is a rule the next caller breaks.
    const patch = await service.resolveFileLink(
      stageOn("d1"),
      { dossier_id: null },
      { dossier_id: "d1", milestone_instance_id: "m1" },
    );
    expect(patch).toEqual({ dossier_id: null, milestone_instance_id: null });
  });

  it("a PATCH naming only the stage is checked against the file the task already has", async () => {
    const patch = await service.resolveFileLink(
      stageOn("d1"),
      { milestone_instance_id: "m1" },
      { dossier_id: "d1", milestone_instance_id: null },
    );
    expect(patch).toEqual({ milestone_instance_id: "m1" });
  });

  it("a PATCH naming only a stage on a task with no file is refused", async () => {
    await expect(
      service.resolveFileLink(
        stageOn("d1"),
        { milestone_instance_id: "m1" },
        { dossier_id: null, milestone_instance_id: null },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("moving the task to ANOTHER file drops the old file's stage", async () => {
    // The caller said "put this on d2" and said nothing about the stage. The
    // stage they did not mention belongs to d1, so carrying it forward would
    // store another shipment's stage — and letting the check below refuse it
    // would turn a legitimate move into a 400 about a field nobody named.
    const patch = await service.resolveFileLink(
      stageOn("d1"),
      { dossier_id: "d2" },
      { dossier_id: "d1", milestone_instance_id: "m1" },
    );
    expect(patch).toEqual({ dossier_id: "d2", milestone_instance_id: null });
  });

  it("moving the task and naming a stage of the NEW file keeps it", async () => {
    const patch = await service.resolveFileLink(
      stageOn("d2"),
      { dossier_id: "d2", milestone_instance_id: "m1" },
      { dossier_id: "d1", milestone_instance_id: "m9" },
    );
    expect(patch).toEqual({ dossier_id: "d2", milestone_instance_id: "m1" });
  });

  it("moving the task and naming a stage of the OLD file is still refused by name", async () => {
    // Clearing is for a stage the caller never mentioned. One they DID name is
    // a statement, and a wrong statement deserves a sentence, not a silent drop.
    await expect(
      service.resolveFileLink(
        stageOn("d1", "Vessel departed"),
        { dossier_id: "d2", milestone_instance_id: "m1" },
        { dossier_id: "d1", milestone_instance_id: null },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("re-sending the SAME file leaves an untouched stage alone", async () => {
    // A form that posts every field on every save must not lose the stage just
    // because the file rode along unchanged.
    const patch = await service.resolveFileLink(
      stageOn("d1"),
      { dossier_id: "d1" },
      { dossier_id: "d1", milestone_instance_id: "m1" },
    );
    expect(patch).toEqual({ dossier_id: "d1" });
  });

  it("dropping the stage alone leaves the file in place", async () => {
    const patch = await service.resolveFileLink(
      stageOn("d1"),
      { milestone_instance_id: null },
      { dossier_id: "d1", milestone_instance_id: "m1" },
    );
    expect(patch).toEqual({ milestone_instance_id: null });
  });
});
