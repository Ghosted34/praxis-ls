/**
 * Task hierarchy, dependencies and the blocked rule (PR 2, migration 13870).
 *
 * ── WHY THIS SUITE IS PURE ─────────────────────────────────────────────────
 *
 * Every rule under test here is an authorisation or a semantic decision, and
 * both are the kind of thing that is written once, read never, and wrong in
 * the case nobody tried. They live in pure functions and in SQL this asserts
 * on as text, so they can be exercised without a tenant database — which is
 * the difference between a rule that is tested and a rule that is hoped for.
 *
 * The two properties that matter most, and are easiest to break silently:
 *
 *   · a CANCELLED prerequisite must keep blocking. The tempting simplification
 *     ("cancelled means it will never happen, so stop waiting") silently marks
 *     unresolved work complete, which the guide explicitly forbids.
 *   · an unauthorised prerequisite must be REDACTED, not omitted. A blocked
 *     indicator may be shown; a title, an owner and an id may not.
 */
"use strict";

const service = require("../../src/modules/dashboard/workspace/tasks.service");
const repo = require("../../src/modules/dashboard/workspace/tasks.repo");
const { AppError } = require("../../src/utils/errors");

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const SCOPE = "33333333-3333-3333-3333-333333333333";
const OTHER_SCOPE = "44444444-4444-4444-4444-444444444444";

const scoped = { user: { user_id: ME }, permission_scope: "scoped", scope_ids: [SCOPE] };

/** Records every statement instead of running it. */
function mockClient(rowsFor = () => []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      const rows = rowsFor(sql, params) || [];
      return { rows, rowCount: rows.length };
    },
  };
}

/** One row as `listDependencies` returns it. */
const edge = (over = {}) => ({
  task_dependency_id: "d1",
  task_id: "t1",
  depends_on_task_id: "t2",
  overridden_at: null,
  overridden_by: null,
  override_reason: null,
  overridden_by_name: null,
  created_at: "2026-09-01T08:00:00.000Z",
  depends_on_title: "Release the bill of lading",
  depends_on_status: "IN_PROGRESS",
  depends_on_due_at: "2026-09-20T16:00:00.000Z",
  depends_on_assigned_to: OTHER,
  depends_on_created_by: OTHER,
  depends_on_is_personal: false,
  depends_on_scope_id: SCOPE,
  ...over,
});

describe("dependencyBlocks — what actually holds work up", () => {
  it("a finished prerequisite stops blocking", () => {
    expect(service.dependencyBlocks(edge({ depends_on_status: "DONE" }))).toBe(false);
  });

  it("an unfinished prerequisite blocks", () => {
    expect(service.dependencyBlocks(edge({ depends_on_status: "IN_PROGRESS" }))).toBe(true);
  });

  it("a CANCELLED prerequisite KEEPS blocking until somebody overrides it", () => {
    // The recorded product decision, and the whole reason `overridden_at`
    // exists. Treating cancelled as satisfied is the silent unblocking the
    // guide forbids: the precondition did not happen, it was abandoned.
    expect(service.dependencyBlocks(edge({ depends_on_status: "CANCELLED" }))).toBe(true);
  });

  it("an override releases the edge whatever the prerequisite's status", () => {
    expect(
      service.dependencyBlocks(
        edge({ depends_on_status: "CANCELLED", overridden_at: "2026-09-02T09:00:00.000Z" }),
      ),
    ).toBe(false);
    expect(
      service.dependencyBlocks(
        edge({ depends_on_status: "TO_DO", overridden_at: "2026-09-02T09:00:00.000Z" }),
      ),
    ).toBe(false);
  });

  it("counts every unresolved edge, resolved ones aside", () => {
    expect(
      service.blockingCount([
        edge({ depends_on_status: "DONE" }),
        edge({ depends_on_status: "CANCELLED" }),
        edge({ depends_on_status: "TO_DO" }),
        edge({ depends_on_status: "TO_DO", overridden_at: "2026-09-02T09:00:00.000Z" }),
      ]),
    ).toBe(2);
  });
});

describe("redactDependency — a blocked indicator without a disclosure", () => {
  it("shows the prerequisite in full when the caller may see it", () => {
    const out = service.redactDependency(edge(), true);
    expect(out.is_visible).toBe(true);
    expect(out.depends_on_task_id).toBe("t2");
    expect(out.depends_on_title).toBe("Release the bill of lading");
    expect(out.depends_on_status).toBe("IN_PROGRESS");
  });

  it("replaces every identifying field when the caller may not", () => {
    const out = service.redactDependency(edge(), false);
    expect(out.is_visible).toBe(false);
    // The id is withheld too: it is the one field that would let a caller
    // confirm a task exists by trying to open it.
    expect(out.depends_on_task_id).toBeNull();
    expect(out.depends_on_title).toBe("A task you cannot view");
    expect(out.depends_on_status).toBeNull();
    expect(out.depends_on_due_at).toBeNull();
    expect(out.depends_on_assigned_to_name).toBeNull();
    expect(out.link_url).toBeNull();
    expect(out.override_reason).toBeNull();
    expect(out.overridden_by_name).toBeNull();
  });

  it("still answers whether the hidden prerequisite is resolved", () => {
    // Whether the thing you are waiting for has finished is exactly what
    // "am I blocked" MEANS, and it discloses nothing about what that thing is.
    const done = service.redactDependency(edge({ depends_on_status: "DONE" }), false);
    expect(done.is_resolved).toBe(true);
    const cancelled = service.redactDependency(edge({ depends_on_status: "CANCELLED" }), false);
    expect(cancelled.is_resolved).toBe(false);
    expect(cancelled.is_cancelled).toBe(true);
  });

  it("keeps the edge present rather than dropping it", () => {
    // A task marked Blocked above an empty list reads as a bug and provokes a
    // support ticket. The row survives; only its identity goes.
    const out = service.redactDependency(edge(), false);
    expect(out.task_dependency_id).toBe("d1");
    expect(out.created_at).toBe("2026-09-01T08:00:00.000Z");
  });
});

describe("dependency visibility is the INTERSECTION of two task rules", () => {
  it("hides a prerequisite outside the caller's scope even on a task they hold", async () => {
    const client = mockClient(() => [
      edge({ depends_on_scope_id: OTHER_SCOPE, depends_on_assigned_to: OTHER, depends_on_created_by: OTHER }),
    ]);
    const [out] = await service.dependenciesFor(client, scoped, "t1", "team");
    expect(out.is_visible).toBe(false);
    expect(out.depends_on_task_id).toBeNull();
  });

  it("shows a prerequisite inside the caller's scope", async () => {
    const client = mockClient(() => [edge({ depends_on_scope_id: SCOPE })]);
    const [out] = await service.dependenciesFor(client, scoped, "t1", "team");
    expect(out.is_visible).toBe(true);
    expect(out.depends_on_title).toBe("Release the bill of lading");
  });

  it("shows a prerequisite assigned to the caller regardless of scope", async () => {
    const client = mockClient(() => [
      edge({ depends_on_scope_id: OTHER_SCOPE, depends_on_assigned_to: ME }),
    ]);
    const [out] = await service.dependenciesFor(client, scoped, "t1", "mine");
    expect(out.is_visible).toBe(true);
  });
});

describe("dependencyWouldCycle — the rule the database deliberately does not hold", () => {
  it("walks the blocked-by graph forward from the proposed prerequisite", async () => {
    const client = mockClient(() => []);
    await repo.dependencyWouldCycle(client, "t1", "t2");
    const { sql, params } = client.calls[0];
    expect(sql).toMatch(/WITH RECURSIVE reach/);
    expect(sql).toMatch(/JOIN reach r ON r\.task_id = d\.task_id/);
    // The blocked task is what we look FOR; the prerequisite is where we start.
    expect(params).toEqual(["t1", "t2"]);
  });

  it("dedupes the frontier so an existing cycle terminates instead of spinning", () => {
    const client = mockClient(() => []);
    return repo.dependencyWouldCycle(client, "t1", "t2").then(() => {
      const { sql } = client.calls[0];
      expect(sql).toMatch(/UNION\s+SELECT/);
      expect(sql).not.toMatch(/UNION ALL/);
    });
  });

  it("bounds the walk, so a pathological graph refuses rather than hangs", async () => {
    const client = mockClient(() => []);
    await repo.dependencyWouldCycle(client, "t1", "t2");
    expect(client.calls[0].sql).toMatch(/r\.depth < 64/);
  });

  it("reports a cycle when the blocked task is reachable", async () => {
    const client = mockClient(() => [{ "?column?": 1 }]);
    await expect(repo.dependencyWouldCycle(client, "t1", "t2")).resolves.toBe(true);
  });
});

describe("blockedCountsFor — CANCELLED is not resolved, in SQL as well", () => {
  it("counts edges whose prerequisite is not DONE and not overridden", async () => {
    const client = mockClient(() => []);
    await repo.blockedCountsFor(client, ["t1", "t2"]);
    const { sql, params } = client.calls[0];
    expect(sql).toMatch(/d\.overridden_at IS NULL/);
    expect(sql).toMatch(/p\.status <> 'DONE'/);
    // NOT `p.status NOT IN ('DONE','CANCELLED')` — that would silently unblock.
    expect(sql).not.toMatch(/CANCELLED/);
    expect(params).toEqual([["t1", "t2"]]);
  });

  it("asks nothing at all for an empty set", async () => {
    const client = mockClient(() => []);
    await expect(repo.blockedCountsFor(client, [])).resolves.toEqual([]);
    expect(client.calls).toHaveLength(0);
  });
});

describe("childRollup — two units of work, never averaged into one", () => {
  it("reports children and steps separately", () => {
    const out = service.childRollup(
      [{ status: "DONE" }, { status: "TO_DO" }, { status: "IN_PROGRESS" }],
      [{ is_done: true }, { is_done: false }],
    );
    expect(out.child_count).toBe(3);
    expect(out.child_done_count).toBe(1);
    expect(out.step_count).toBe(2);
    expect(out.step_done_count).toBe(1);
  });

  it("takes a cancelled child out of the denominator without calling it done", () => {
    // Leaving it in means a parent whose last child was cancelled can never
    // read as complete; counting it as done overstates what happened.
    const out = service.childRollup([{ status: "DONE" }, { status: "CANCELLED" }], []);
    expect(out.child_cancelled_count).toBe(1);
    expect(out.progress_done).toBe(1);
    expect(out.progress_total).toBe(1);
    expect(out.progress_ratio).toBe(1);
  });

  it("reports no progress rather than zero progress when there is nothing to do", () => {
    // "0%" reads as "nothing done"; the truth is "nothing to do yet".
    expect(service.childRollup([], []).progress_ratio).toBeNull();
  });

  it("combines children and steps into one honest fraction", () => {
    const out = service.childRollup(
      [{ status: "DONE" }, { status: "TO_DO" }],
      [{ is_done: true }, { is_done: false }, { is_done: false }],
    );
    expect(out.progress_done).toBe(2);
    expect(out.progress_total).toBe(5);
  });
});

describe("assertParentable — the schema's one level of nesting, enforced", () => {
  it("accepts a top-level task as a parent", () => {
    expect(() => service.assertParentable({ task_id: "t1", parent_task_id: null })).not.toThrow();
  });

  it("refuses to make a child into a parent", () => {
    // 13810's comment says a tree deeper than two is a project, which is a
    // different product. This is where that sentence becomes enforceable.
    expect(() => service.assertParentable({ task_id: "t2", parent_task_id: "t1" })).toThrow(AppError);
  });
});

describe("assertRecurrenceAnchored — a repeat needs something to repeat from", () => {
  it("accepts a rule with a due date", () => {
    expect(() =>
      service.assertRecurrenceAnchored("FREQ=WEEKLY", "2026-09-15T17:00:00.000Z"),
    ).not.toThrow();
  });

  it("accepts no rule at all", () => {
    expect(() => service.assertRecurrenceAnchored(null, null)).not.toThrow();
  });

  it("refuses a rule with no anchor, naming the field", () => {
    // Without this the sweep has no cursor to advance: the task says "Repeats
    // weekly" on its face and has never once repeated, and the failure is
    // discovered weeks later by its absence.
    try {
      service.assertRecurrenceAnchored("FREQ=WEEKLY", null);
      throw new Error("should have refused");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.status).toBe(422);
      expect(err.details.due_at).toBeDefined();
    }
  });
});

describe("recipientsOf — who hears about a task", () => {
  const task = { created_by: ME, assigned_to: OTHER };

  it("is the creator, the assignee and the watchers, deduplicated", () => {
    const out = service.recipientsOf(task, [{ user_id: OTHER }, { user_id: SCOPE }]);
    expect(out.sort()).toEqual([ME, OTHER, SCOPE].sort());
  });

  it("never includes the person who did the thing", () => {
    // A notification that arrives because you clicked something teaches people
    // to ignore the bell.
    expect(service.recipientsOf(task, [], { exclude: ME })).toEqual([OTHER]);
  });

  it("copes with an unassigned task", () => {
    expect(service.recipientsOf({ created_by: ME, assigned_to: null }, [])).toEqual([ME]);
  });
});

describe("listChildTasks / childCountsFor", () => {
  it("reads only live children of one parent", async () => {
    const client = mockClient(() => []);
    await repo.listChildTasks(client, "p1");
    const { sql, params } = client.calls[0];
    expect(sql).toMatch(/t\.parent_task_id = \$1/);
    expect(sql).toMatch(/t\.is_deleted = false/);
    expect(params).toEqual(["p1"]);
  });

  it("batches child counts over a set rather than one query per card", async () => {
    const client = mockClient(() => []);
    await repo.childCountsFor(client, ["p1", "p2"]);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].sql).toMatch(/parent_task_id = ANY\(\$1::uuid\[\]\)/);
  });
});
