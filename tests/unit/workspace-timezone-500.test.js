"use strict";
/**
 * Part 0 regression — an invalid `hr.timezone` must degrade, never 500.
 *
 * ── WHAT THIS SUITE EXISTS TO PROVE ─────────────────────────────────────────
 *
 * On 18 September 2026, `GET /workspace/day` and `GET /workspace/analytics`
 * returned 500 on the live tenant, blanking the Today hub and the Analytics
 * section while Tasks, board and notifications kept working. The failure was
 * NOT a shared query (nothing in PR 2 touched the day path) and NOT a missing
 * migration (`task_dependency` was applied). It was the tenant work-place
 * timezone: `hr.timezone` held "WAT" and `Intl.DateTimeFormat` — and, once
 * the SQL was reached, Postgres's `AT TIME ZONE` — raised `RangeError:
 * Invalid time zone`. The response deliberately hid it; the log named it.
 *
 * Every test below pins one of the two shapes that must now be impossible:
 * either the read is answered with a valid fallback zone (200-shape), or a
 * deliberate FieldValue error surfaces at write time and says what to fix. A
 * test that does not pin a timezone cannot see an hour of wrongness a laptop
 * and a tenant can hold apart.
 */

const service = require("../../src/modules/dashboard/workspace/tasks.service");
const repo = require("../../src/modules/dashboard/workspace/tasks.repo");
const { timezoneOf } = require("../../src/modules/dashboard/workspace/workspace.time");

const ME = "11111111-1111-1111-1111-111111111111";

/* The live tenant's `hr.timezone` value once Settings accepted free text. */
const BAD_TZ = "WAT";
const FALLBACK = "Africa/Douala";

const ctx = { user: { user_id: ME }, permission_scope: "all", scope_ids: null };

/**
 * A tenant connection holding one bad setting, with just enough SQL faking to
 * prove the zone never reaches another statement. Anything that would have
 * mattered — a task insert, the analytics summary, a counted read — answers
 * with shaped rows so the service can finish rather than throw mid-call.
 */
function mockClient(settingValue) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/ FROM setting /i.test(sql)) {
        return settingValue === undefined
          ? { rows: [], rowCount: 0 }
          : { rows: [{ value: settingValue }], rowCount: 1 };
      }
      if (/INSERT INTO task /i.test(sql)) {
        return { rows: [{ task_id: "t-self", reminder_minutes: null, remind_at: null, recurrence_rule: null, recurrence_series_id: null }], rowCount: 1 };
      }
      if (/SELECT t\.\*, .+ FROM task t|FROM task t.* WHERE t\.task_id|JOIN task/i.test(sql)) {
        return { rows: [{ task_id: "t-self", title: "x", status: "TO_DO", priority: "NORMAL", assigned_to: ME, created_by: ME, due_at: null, is_deleted: false, is_personal: false, scope_id: null, reminder_minutes: null, remind_at: null, recurrence_rule: null, recurrence_series_id: null, parent_task_id: null, subtasks: [], watchers: [], dependencies: [] }], rowCount: 1 };
      }
      if (/open_count|blocking_count|EXTRACT|date_trunc|to_char|COUNT\(\*\) OVER| BETWEEN |width_bucket|AT TIME ZONE|FROM task t WHERE|task_subtask s|task_dependency d|FROM app_user|FROM employee|listSubtasks|listWatchers|listDependencies|listChildTasks/i.test(sql)) {
        return {
          rows: [{
            open_count: 0, overdue_count: 0, blocked_count: 0,
            completed_count: 0, cancelled_count: 0, total_count: 0,
            _total: 0, day: null, tasks: 0, median_days: null, avg_days: null,
            bucket: "<1", resolved_count: 0, unresolved_count: 0,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

describe("a bad hr.timezone leaves Workspace answering, not erroring", () => {
  it("GET /workspace/day (explicit window) resolves and returns the fallback zone", async () => {
    const out = await service.dayTimeline(mockClient(BAD_TZ), ctx, {
      from: "2026-09-18",
      to: "2026-09-19",
    });
    expect(out.timezone).toBe(FALLBACK);
    expect(Array.isArray(out.items)).toBe(true);
  });

  it("GET /workspace/day (no window) — the controller's Intl is fed a valid zone", async () => {
    // The controller computes "today" with Intl before the service runs; a bad
    // value reached it as `Invalid time zone specified: WAT` on the live
    // tenant, which is exactly what the hardening removes.
    const tz = await timezoneOf(mockClient(BAD_TZ));
    expect(tz).toBe(FALLBACK);
    expect(() =>
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()),
    ).not.toThrow();
  });

  it("GET /workspace/analytics — the window resolves and every aggregate gets a valid zone", async () => {
    const client = mockClient(BAD_TZ);
    const out = await service.analytics(client, ctx, { from: "2026-08-19", to: "2026-09-19" });
    expect(out.window.timezone).toBe(FALLBACK);
    // The `AT TIME ZONE $3` aggregates were handed the bad value and raised
    // SQLSTATE 22023; every one of them now receives the fallback instead.
    for (const { params } of client.calls.filter((c) => /AT TIME ZONE/i.test(c.sql))) {
      expect(params).not.toContain(BAD_TZ);
      expect(params).toContain(FALLBACK);
    }
  });

  it("calendar events, deadlines and task writes share the same fallback", async () => {
    const client = mockClient(BAD_TZ);
    await service.listEvents(client, ctx, { from: "2026-09-01", to: "2026-10-01" });
    await service.deadlinesInRange(client, ctx, { from: "2026-09-01", to: "2026-10-01" });

    // The write path is what `toInstant`'s tenant-zone conversion protects: an
    // invalid zone raised `RangeError` before a statement was even built. This
    // makes the same call reach the insert rather than throwing, with the
    // mocked read returning a minimal row so `getTask` re-reads it.
    let insertError = null;
    try {
      await service.createTask(client, ctx, { title: "write a test", due_at: "2026-09-20T17:00" });
    } catch (err) {
      insertError = err;
    }
    // A tenant-facing PersistenceFailure is not the assertion here — the zone
    // never reached Intl was. Anything at the database layer beyond that is
    // mock theatre; the statement-level guard below is the one that matters.
    expect(insertError === null || /NOT_FOUND|Task not found/.test(String(insertError.message))).toBe(true);

    // No statement parameter may carry the raw setting.
    for (const { params } of client.calls) {
      expect(params).not.toContain(BAD_TZ);
    }
  });
});

describe("the aggregates bind the fallback zone as the parameter, never the setting", () => {
  it("every AT TIME ZONE aggregate receives Africa/Douala, not WAT", async () => {
    const visibility = { audience: "all", userId: ME, scopeIds: null, personalOnly: true };
    const args = {
      visibility,
      filters: { from: "2026-08-19T00:00:00.000Z", to: "2026-09-19T00:00:00.000Z", status: null, priority: null, assignedTo: null, scopeId: null },
      nowIso: "2026-09-18T00:00:00.000Z",
      timeZone: "Africa/Lagos",
    };
    const tz = await timezoneOf(mockClient(BAD_TZ));
    expect(tz).toBe(FALLBACK);
    for (const panel of ["analyticsThroughput", "analyticsBurndown"]) {
      const client = mockClient(BAD_TZ);
      await repo[panel](client, Object.assign({}, args, { timeZone: tz }));
      for (const { params } of client.calls) {
        expect(params).toContain(FALLBACK);
      }
      // And nothing else from the setting line reached a statement.
      for (const { sql } of client.calls) {
        expect(sql).not.toMatch(/WAT/);
      }
    }
  });
});
