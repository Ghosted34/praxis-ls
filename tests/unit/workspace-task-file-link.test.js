"use strict";
/**
 * 13920 — a task can name the operations file it is work on.
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

/*
 * 13930 widened the stage to a SET (`task_milestone`), with 13920's column kept
 * as the projection of its first member. The rules above hold for every member,
 * and two more join them: the set is ordered as the chain is, and the column
 * and the set are written together or not at all.
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
    // Against the SET, not the projection column: a task filed under two
    // stages must be found from the second stage's view too (13930).
    expect(call.sql).toMatch(/EXISTS \(SELECT 1 FROM task_milestone tm WHERE tm\.task_id = t\.task_id AND tm\.milestone_instance_id = \$\d+\)/);
    expect(call.sql).not.toContain("t.milestone_instance_id = $");
    expect(call.params).toContain("d1");
    expect(call.params).toContain("m1");
  });

  it("every task read carries the whole stage set, in chain order, as an array", async () => {
    const c = mockClient();
    await repo.findTask(c, "t1");
    const { sql } = c.calls[0];
    expect(sql).toContain("FROM task_milestone tm");
    expect(sql).toContain("AS milestones");
    // An aggregate, not a join: a join would multiply the row by its stage
    // count and break COUNT(*) OVER() and every LIMIT in the file.
    expect(sql).not.toMatch(/LEFT JOIN task_milestone/);
    expect(sql).toContain("ORDER BY tmi.stage_seq");
    expect(sql).toContain("'[]'::json");
  });

  it("replaceTaskMilestones makes the set exactly the ids, and clears it for none", async () => {
    const c = mockClient([{ milestone_instance_id: "m1" }, { milestone_instance_id: "m2" }]);
    await repo.replaceTaskMilestones(c, "t1", ["m1", "m2", "m1"]);
    expect(c.calls).toHaveLength(2);
    const [del, ins] = c.calls;
    expectBound(del);
    expect(del.sql).toMatch(/DELETE FROM task_milestone WHERE task_id = \$1 AND NOT \(milestone_instance_id = ANY\(\$2::uuid\[\]\)\)/);
    expect(del.params).toEqual(["t1", ["m1", "m2"]]); // deduplicated
    expectBound(ins);
    expect(ins.sql).toContain("INSERT INTO task_milestone");
    expect(ins.sql).toContain("ON CONFLICT DO NOTHING");
    expect(ins.params).toEqual(["t1", ["m1", "m2"]]);

    const none = mockClient();
    await repo.replaceTaskMilestones(none, "t1", []);
    // Nothing wanted: one DELETE against an empty list, and no INSERT.
    expect(none.calls).toHaveLength(1);
    expect(none.calls[0].params).toEqual(["t1", []]);
  });

  it("milestoneFilesOf reads the whole set in one query, with the chain position", async () => {
    const c = mockClient();
    await repo.milestoneFilesOf(c, ["m1", "m2"]);
    expect(c.calls).toHaveLength(1);
    expectBound(c.calls[0]);
    expect(c.calls[0].sql).toContain("= ANY($1::uuid[])");
    expect(c.calls[0].sql).toContain("stage_seq");
    expect(c.calls[0].params).toEqual([["m1", "m2"]]);
    // An empty set costs no round trip.
    const none = mockClient();
    expect(await repo.milestoneFilesOf(none, [])).toEqual([]);
    expect(none.calls).toHaveLength(0);
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
    // Through the set: a task on two stages is work on both, and is counted
    // under both; a task on none keeps its "No milestone" row (LEFT JOIN).
    expect(c.calls[0].sql).toContain("LEFT JOIN task_milestone tm ON tm.task_id = t.task_id");
    expect(c.calls[0].sql).toContain("GROUP BY tm.milestone_instance_id");
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

  /**
   * A client whose only job is to answer the milestone→file lookup. Answers
   * for whichever ids were asked, so a set lookup gets a row per member.
   */
  const stageOn = (dossierId, label = "Customs cleared") => ({
    query: async (_sql, params = []) => {
      const ids = Array.isArray(params[0]) ? params[0] : [params[0]];
      const rows = ids.map((id, i) => ({
        milestone_instance_id: id, dossier_id: dossierId, label, stage_seq: String(i + 1),
      }));
      return { rows, rowCount: rows.length };
    },
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
    expect(patch).toEqual({ dossier_id: "d1", milestone_instance_id: "m1", milestone_instance_ids: ["m1"] });
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
    expect(patch).toEqual({ dossier_id: null, milestone_instance_id: null, milestone_instance_ids: [] });
  });

  it("a PATCH naming only the stage is checked against the file the task already has", async () => {
    const patch = await service.resolveFileLink(
      stageOn("d1"),
      { milestone_instance_id: "m1" },
      { dossier_id: "d1", milestone_instance_id: null },
    );
    expect(patch).toEqual({ milestone_instance_id: "m1", milestone_instance_ids: ["m1"] });
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
    expect(patch).toEqual({ dossier_id: "d2", milestone_instance_id: null, milestone_instance_ids: [] });
  });

  it("moving the task and naming a stage of the NEW file keeps it", async () => {
    const patch = await service.resolveFileLink(
      stageOn("d2"),
      { dossier_id: "d2", milestone_instance_id: "m1" },
      { dossier_id: "d1", milestone_instance_id: "m9" },
    );
    expect(patch).toEqual({ dossier_id: "d2", milestone_instance_id: "m1", milestone_instance_ids: ["m1"] });
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
    expect(patch).toEqual({ milestone_instance_id: null, milestone_instance_ids: [] });
  });

  /* ── several stages (13930) ─────────────────────────────────────────────── */

  it("accepts several stages of the file, and projects the FIRST in chain order onto the column", async () => {
    // The chain answers m2 as stage 1 and m1 as stage 2 (see stageOn: the
    // position follows the order asked), so the projection is m2 whatever
    // order the form sent.
    const patch = await service.resolveFileLink(stageOn("d1"), {
      dossier_id: "d1",
      milestone_instance_ids: ["m2", "m1"],
    });
    expect(patch).toEqual({
      dossier_id: "d1",
      milestone_instance_id: "m2",
      milestone_instance_ids: ["m2", "m1"],
    });
  });

  it("orders the set as the chain does, not as the form sent it", async () => {
    const chain = {
      query: async () => ({
        rows: [
          { milestone_instance_id: "late", dossier_id: "d1", label: "Delivery", stage_seq: "12.0000" },
          { milestone_instance_id: "early", dossier_id: "d1", label: "Pre-alert", stage_seq: "1.0000" },
        ],
        rowCount: 2,
      }),
    };
    const patch = await service.resolveFileLink(chain, {
      dossier_id: "d1",
      milestone_instance_ids: ["late", "early"],
    });
    expect(patch.milestone_instance_ids).toEqual(["early", "late"]);
    expect(patch.milestone_instance_id).toBe("early");
  });

  it("deduplicates a set that names a stage twice, and reads it in ONE lookup", async () => {
    let lookups = 0;
    const counting = {
      query: async (sql, params) => {
        lookups += 1;
        return stageOn("d1").query(sql, params);
      },
    };
    const patch = await service.resolveFileLink(counting, {
      dossier_id: "d1",
      milestone_instance_ids: ["m1", "m1", "m2"],
    });
    expect(patch.milestone_instance_ids).toEqual(["m1", "m2"]);
    expect(lookups).toBe(1);
  });

  it("refuses the whole set when ANY member is another file's, naming it", async () => {
    const mixed = {
      query: async () => ({
        rows: [
          { milestone_instance_id: "m1", dossier_id: "d1", label: "Customs cleared", stage_seq: "3" },
          { milestone_instance_id: "m2", dossier_id: "d9", label: "Vessel departed", stage_seq: "2" },
        ],
        rowCount: 2,
      }),
    };
    await expect(
      service.resolveFileLink(mixed, { dossier_id: "d1", milestone_instance_ids: ["m1", "m2"] }),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Vessel departed") });
  });

  it("404s when a member of the set no longer exists", async () => {
    const partial = {
      query: async () => ({
        rows: [{ milestone_instance_id: "m1", dossier_id: "d1", label: "Customs cleared", stage_seq: "3" }],
        rowCount: 1,
      }),
    };
    await expect(
      service.resolveFileLink(partial, { dossier_id: "d1", milestone_instance_ids: ["m1", "gone"] }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("the set wins over the single column when a caller sends both", async () => {
    const patch = await service.resolveFileLink(stageOn("d1"), {
      dossier_id: "d1",
      milestone_instance_id: "m9",
      milestone_instance_ids: ["m1", "m2"],
    });
    expect(patch.milestone_instance_ids).toEqual(["m1", "m2"]);
    expect(patch.milestone_instance_id).toBe("m1");
  });

  it("an empty set is a statement — it clears every stage and the projection", async () => {
    const patch = await service.resolveFileLink(
      stageOn("d1"),
      { milestone_instance_ids: [] },
      { dossier_id: "d1", milestone_instance_id: "m1", milestone_instance_ids: ["m1", "m2"] },
    );
    expect(patch).toEqual({ milestone_instance_id: null, milestone_instance_ids: [] });
  });

  it("re-sending the SAME file leaves a set of several alone", async () => {
    const patch = await service.resolveFileLink(
      stageOn("d1"),
      { dossier_id: "d1" },
      { dossier_id: "d1", milestone_instance_id: "m1", milestone_instance_ids: ["m1", "m2"] },
    );
    expect(patch).toEqual({ dossier_id: "d1" });
  });

  it("moving the task to ANOTHER file drops the whole old set", async () => {
    const patch = await service.resolveFileLink(
      stageOn("d1"),
      { dossier_id: "d2" },
      { dossier_id: "d1", milestone_instance_id: "m1", milestone_instance_ids: ["m1", "m2"] },
    );
    expect(patch).toEqual({ dossier_id: "d2", milestone_instance_id: null, milestone_instance_ids: [] });
  });

  it("a set with no file is refused like a single stage with no file", async () => {
    await expect(
      service.resolveFileLink(noStage, { milestone_instance_ids: ["m1"] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("withLink derives milestone_instance_ids from the aggregate a read carries", () => {
    const shaped = service.withLink({
      task_id: "t1",
      entity_type: null,
      entity_id: null,
      milestones: [
        { milestone_instance_id: "m1", label: "Pre-alert", stage_seq: 1, status: "DONE" },
        { milestone_instance_id: "m2", label: "Customs", stage_seq: 7, status: "PENDING" },
      ],
    });
    expect(shaped.milestone_instance_ids).toEqual(["m1", "m2"]);
    // An event carries no set and gains no field.
    expect(service.withLink({ calendar_event_id: "e1", entity_type: null })).not.toHaveProperty("milestone_instance_ids");
  });
});
