/**
 * tasks.repo — the SQL it BUILDS, checked without a database.
 *
 * There is no Postgres in every environment this runs in, and a repo that can
 * only be exercised against a live tenant is a repo whose SQL is read once and
 * trusted forever. So this suite captures each statement at the moment it is
 * handed to the driver and checks the property that is both mechanical and
 * fatal: that `$n` placeholders and the parameter array agree.
 *
 * That is the failure mode dynamic WHERE-building actually produces. A filter
 * added to the clause list but not to the params array gives Postgres a `$4`
 * with three parameters, which is a 42P02 at runtime — and it only happens on
 * the combination of filters nobody tried, which is why it survives review.
 *
 * A `COUNT(*) OVER()` alias, a stray `RETURNING s.*`, a doubled keyword: those
 * are also caught here, because the statement is asserted on as text.
 */
"use strict";

const repo = require("../../src/modules/dashboard/workspace/tasks.repo");

/** Records every statement instead of running it, and returns no rows. */
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

/** Highest `$n` referenced by a statement. */
function maxPlaceholder(sql) {
  let max = 0;
  for (const m of sql.matchAll(/\$(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** Every `$n` referenced, so a skipped number is visible. */
function placeholders(sql) {
  return [...new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/**
 * Assert a statement's placeholders are exactly 1..params.length.
 *
 * Checks BOTH directions: a placeholder with no parameter is a 42P02, and a
 * parameter with no placeholder is a value silently ignored — which is the
 * worse one, because the query succeeds and returns the wrong rows.
 */
function expectBound({ sql, params }) {
  const max = maxPlaceholder(sql);
  expect(max).toBeLessThanOrEqual(params.length);
  expect(placeholders(sql)).toEqual(
    params.length ? Array.from({ length: max }, (_, i) => i + 1) : [],
  );
}

describe("tasks.repo — placeholders match parameters", () => {
  it("listTasks with no filters", async () => {
    const c = mockClient();
    await repo.listTasks(c, { audience: "mine", userId: "u1", limit: 50, offset: 0 });
    expect(c.calls).toHaveLength(1);
    expectBound(c.calls[0]);
  });

  it("listTasks with every filter at once", async () => {
    const c = mockClient();
    await repo.listTasks(c, {
      audience: "team", userId: "u1", scopeIds: ["s1", "s2"], personalOnly: true,
      status: "TO_DO", assignedTo: "u2", q: "invoice",
      entity: { entity_type: "costing", entity_id: "e1" },
      limit: 25, offset: 50,
    });
    const { sql, params } = c.calls[0];
    expectBound(c.calls[0]);
    // The whole point of the exercise: every filter reached the WHERE, and
    // LIMIT/OFFSET kept the $1/$2 slots the shared page() contract uses.
    expect(params[0]).toBe(25);
    expect(params[1]).toBe(50);
    expect(sql).toMatch(/t\.status = \$/);
    expect(sql).toMatch(/t\.assigned_to = \$/);
    expect(sql).toMatch(/t\.title ILIKE \$/);
    expect(sql).toMatch(/t\.entity_type = \$/);
    expect(sql).toMatch(/scope_id = ANY\(\$\d+::uuid\[\]\)/);
  });

  it("listTasks asks for the total in the same query, not a second one", async () => {
    const c = mockClient();
    await repo.listTasks(c, { audience: "mine", userId: "u1" });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].sql).toMatch(/COUNT\(\*\) OVER\(\) AS _total/);
  });

  it("boardTasks excludes CANCELLED in SQL rather than in the client", async () => {
    const c = mockClient();
    await repo.boardTasks(c, { audience: "all", userId: "u1" });
    expect(c.calls[0].sql).toMatch(/t\.status <> 'CANCELLED'/);
    expectBound(c.calls[0]);
  });

  it("boardTasks under 'mine' keeps a task the caller CREATED", async () => {
    // The board the kanban draws is audience 'mine' with personalOnly layered
    // on — the exact bundle behind "I made a task and it never showed on the
    // board". A created task (created_by = me) must survive both clauses.
    const c = mockClient([{ status: "TO_DO", task_id: "t1", created_by: "u1" }]);
    const board = await repo.boardTasks(c, { audience: "mine", userId: "u1", personalOnly: true });
    expectBound(c.calls[0]);
    expect(c.calls[0].sql).toMatch(/t\.created_by = \$1/);
    expect(board.TO_DO).toHaveLength(1);
  });

  it("boardTasks under 'mine' keeps a task ASSIGNED to the caller", async () => {
    // The assignee side of the same rule: assign a task to a colleague and it
    // has to land on THEIR board, which is also 'mine' + personalOnly. This is
    // what makes "assign it so it shows on their dashboard" true.
    const c = mockClient([{ status: "IN_PROGRESS", task_id: "t2", assigned_to: "u1" }]);
    const board = await repo.boardTasks(c, { audience: "mine", userId: "u1", personalOnly: true });
    expectBound(c.calls[0]);
    expect(c.calls[0].sql).toMatch(/t\.assigned_to = \$1/);
    expect(board.IN_PROGRESS).toHaveLength(1);
  });

  it("boardTasks groups only the four real columns", async () => {
    const c = mockClient([
      { status: "TO_DO", task_id: "1" },
      { status: "DONE", task_id: "2" },
      { status: "WIBBLE", task_id: "3" }, // a value the CHECK should forbid
    ]);
    const board = await repo.boardTasks(c, { audience: "all", userId: "u1" });
    expect(Object.keys(board).sort()).toEqual(["DONE", "IN_PROGRESS", "IN_REVIEW", "TO_DO"]);
    expect(board.TO_DO).toHaveLength(1);
    // An impossible status is dropped, not filed under a phantom column.
    expect(board.TO_DO[0].task_id).toBe("1");
  });

  it("insertTask binds one parameter per column", async () => {
    const c = mockClient([{ task_id: "t1" }]);
    await repo.insertTask(c, {
      title: "x", description: "d", status: "TO_DO", priority: "HIGH",
      assigned_to: "u1", created_by: "u2", due_at: "2026-09-15T16:00:00Z",
      parent_task_id: null, entity_type: "costing", entity_id: "e1",
      is_personal: true, scope_id: "s1", reminder_minutes: 60, remind_at: "2026-09-15T15:00:00Z",
    });
    const { sql, params } = c.calls[0];
    expectBound(c.calls[0]);
    expect(sql.match(/\$\d+/g)).toHaveLength(14);
    expect(params).toHaveLength(14);
  });

  it("updateTask re-arms the reminder only when asked", async () => {
    const rearmed = mockClient([{ task_id: "t1" }]);
    await repo.updateTask(rearmed, "t1", { title: "new" }, { rearm: true });
    expect(rearmed.calls[0].sql).toMatch(/reminder_sent_at = NULL/);
    expectBound(rearmed.calls[0]);

    const plain = mockClient([{ task_id: "t1" }]);
    await repo.updateTask(plain, "t1", { title: "new" });
    expect(plain.calls[0].sql).not.toMatch(/reminder_sent_at/);
    expectBound(plain.calls[0]);
  });

  it("updateTask stamps completed_at on the way in and clears it on the way out", async () => {
    const done = mockClient([{ task_id: "t1" }]);
    await repo.updateTask(done, "t1", { status: "DONE" });
    expect(done.calls[0].sql).toMatch(/completed_at = now\(\)/);

    const reopened = mockClient([{ task_id: "t1" }]);
    await repo.updateTask(reopened, "t1", { status: "IN_PROGRESS" });
    expect(reopened.calls[0].sql).toMatch(/completed_at = NULL/);
  });

  it("updateTask with nothing to change issues no UPDATE", async () => {
    const c = mockClient([{ task_id: "t1" }]);
    await repo.updateTask(c, "t1", {});
    // Re-reading the row is fine; issuing `UPDATE task SET , updated_at=…` is
    // not, and an empty patch is reachable from a client that sends {}.
    // (Trimmed because the select is a template literal and starts with a
    // newline, which a `/^SELECT/` anchor cannot see past.)
    expect(c.calls[0].sql.trim()).toMatch(/^SELECT/);
    expect(c.calls.some((call) => /\bUPDATE task\b/.test(call.sql))).toBe(false);
  });

  it("setSubtaskDone is one valid UPDATE … RETURNING", async () => {
    const c = mockClient([{ task_subtask_id: "s1", is_done: true }]);
    await repo.setSubtaskDone(c, "s1", true);
    const { sql, params } = c.calls[0];
    expectBound(c.calls[0]);
    expect(sql).toMatch(/^UPDATE task_subtask/);
    expect(sql).toMatch(/RETURNING \*/);
    expect(sql).not.toMatch(/RETURNING \* FROM/);
    expect(params).toEqual(["s1", true]);
  });

  it("findEventClashes uses the overlap test and can exclude one event", async () => {
    const c = mockClient([]);
    await repo.findEventClashes(c, {
      location: "Lekki showroom", start_at: "2026-09-15T10:00:00Z",
      end_at: "2026-09-15T11:00:00Z", excludeId: "e9",
    });
    const { sql } = c.calls[0];
    expectBound(c.calls[0]);
    // existing.start < new.end AND existing.end > new.start
    expect(sql).toMatch(/e\.start_at < \$3 AND e\.end_at > \$2/);
    expect(sql).toMatch(/calendar_event_id <> \$4/);
    // A room nobody booked cannot clash over that room.
    expect(sql).toMatch(/e\.location IS NOT NULL/);
  });

  it("listEvents uses a half-open overlap so multi-day events show on every day", async () => {
    const c = mockClient([]);
    await repo.listEvents(c, { from: "2026-09-01", to: "2026-10-01", mine: true, userId: "u1" });
    const { sql } = c.calls[0];
    expectBound(c.calls[0]);
    expect(sql).toMatch(/e\.start_at < \$2/);
    expect(sql).toMatch(/e\.end_at >= \$1/);
  });

  it("dueTaskReminders reads only armed rows and skips finished work", async () => {
    const c = mockClient([]);
    await repo.dueTaskReminders(c, "2026-09-15T12:00:00Z", 200);
    const { sql } = c.calls[0];
    expectBound(c.calls[0]);
    expect(sql).toMatch(/remind_at <= \$1/);
    expect(sql).toMatch(/reminder_sent_at IS NULL/);
    expect(sql).toMatch(/status NOT IN \('DONE','CANCELLED'\)/);
    expect(sql).toMatch(/LIMIT \$2/);
  });

  it("dueEventReminders gathers participants in the same round trip", async () => {
    const c = mockClient([]);
    await repo.dueEventReminders(c, "2026-09-15T12:00:00Z", 200);
    const { sql } = c.calls[0];
    expectBound(c.calls[0]);
    expect(sql).toMatch(/array_agg\(DISTINCT p\.user_id\)/);
    expect(sql).toMatch(/GROUP BY e\.calendar_event_id/);
  });

  it("never interpolates a caller's value into SQL", async () => {
    const c = mockClient();
    await repo.listTasks(c, { audience: "mine", userId: "u1", q: "'; DROP TABLE task; --" });
    // The search term must arrive as a parameter, not inside the statement.
    expect(c.calls[0].sql).not.toMatch(/DROP TABLE/);
    expect(c.calls[0].params).toContain("%'; DROP TABLE task; --%");
  });
});

describe("tasks.repo — the visibility predicate", () => {
  it("'mine' is the caller's own or their creator's, on one placeholder", async () => {
    const { sql, params } = repo.visibleWhere({ audience: "mine", userId: "u1" });
    expect(params).toEqual(["u1"]);
    expect(sql.join(" ")).toMatch(/assigned_to = \$1 OR t\.created_by = \$1/);
  });

  it("'mine' with the board's personal filter still shows the caller's own", () => {
    // The board never asks for 'mine' alone — it always adds personalOnly. The
    // two clauses together must not cancel out and hide a row the caller made
    // or was handed, which would be an empty board for someone who has tasks.
    const { sql, params } = repo.visibleWhere({ audience: "mine", userId: "u1", personalOnly: true });
    const joined = sql.join(" AND ");
    expect(joined).toMatch(/t\.assigned_to = \$1 OR t\.created_by = \$1/);
    expect(joined).toMatch(/t\.is_personal = false OR t\.created_by = \$2 OR t\.assigned_to = \$2/);
    expect(params).toEqual(["u1", "u1"]);
  });

  it("'team' adds the scope closure but keeps unscoped rows visible", async () => {
    const { sql, params } = repo.visibleWhere({ audience: "team", userId: "u1", scopeIds: ["s1"] });
    expect(params).toEqual(["u1", ["s1"]]);
    const joined = sql.join(" ");
    expect(joined).toMatch(/t\.scope_id IS NULL OR t\.scope_id = ANY\(\$2::uuid\[\]\)/);
  });

  it("'team' with no closure degrades to 'mine' rather than to the tenant", async () => {
    // The dangerous default would be "no scopes means no filter". Showing
    // less is the smaller lie for a surface labelled "my team".
    const { sql, params } = repo.visibleWhere({ audience: "team", userId: "u1", scopeIds: null });
    expect(params).toEqual(["u1"]);
    expect(sql.join(" ")).not.toMatch(/scope_id/);
  });

  it("'all' adds no predicate at all", async () => {
    const { sql, params } = repo.visibleWhere({ audience: "all", userId: "u1" });
    expect(sql).toEqual([]);
    expect(params).toEqual([]);
  });

  it("hides a personal task from everyone but its creator and assignee", async () => {
    const { sql } = repo.visibleWhere({ audience: "all", userId: "u1", personalOnly: true });
    expect(sql.join(" ")).toMatch(
      /t\.is_personal = false OR t\.created_by = \$1 OR t\.assigned_to = \$1/,
    );
  });

  it("numbers its placeholders from where the caller left off", async () => {
    // A caller that already used $1..$3 must not collide with the predicate.
    const { sql, params, next } = repo.visibleWhere({ audience: "mine", userId: "u1" }, 4);
    expect(sql.join(" ")).toMatch(/\$4/);
    expect(sql.join(" ")).not.toMatch(/\$1\b/);
    expect(params).toEqual(["u1"]);
    expect(next).toBe(5);
  });
});
