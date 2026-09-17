/**
 * recurrence spawn — the sweep's other half (13840).
 *
 * Like the reminder sweep test, this runs against a scripted client rather than
 * a database so the failure modes that only show up in a bad week are
 * deterministic: the insert losing its unique-index race, and a rule reaching
 * the end of its life. Those are the two paths that, if wrong, either double a
 * task or spin a row through the scan every minute.
 *
 * Every expectation's date was computed from the IANA offset for Africa/Douala
 * (UTC+1, no DST) on the anchor, matching the recurrence tests — 17:00 local is
 * 16:00Z.
 */
"use strict";

const { spawnDue } = require("../../src/modules/dashboard/workspace/tasks.service");

const NOW = new Date("2026-09-20T12:00:00Z");

/** A client that answers the spawn scan with fixtures and records statements. */
function mockClient({ spawnTasks = [], spawnEvents = [], insertConflict = false, seriesCount = 1 } = {}) {
  const statements = [];
  return {
    statements,
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      if (/^SELECT value FROM setting/.test(sql)) return { rows: [], rowCount: 0 }; // -> Africa/Douala
      if (/FROM task\b/.test(sql) && /COALESCE\(recurrence_cursor_at, due_at\)/.test(sql)) {
        return { rows: spawnTasks };
      }
      if (/FROM calendar_event\b/.test(sql) && /COALESCE\(recurrence_cursor_at, start_at\)/.test(sql)) {
        return { rows: spawnEvents };
      }
      if (/SELECT count\(\*\)::int AS n FROM task/.test(sql)) return { rows: [{ n: seriesCount }] };
      if (/SELECT count\(\*\)::int AS n FROM calendar_event/.test(sql)) return { rows: [{ n: seriesCount }] };
      if (/INSERT INTO task \(/.test(sql)) {
        // On conflict the unique index turns the insert into a no-op.
        return insertConflict ? { rows: [], rowCount: 0 } : { rows: [{ task_id: "spawned-1" }], rowCount: 1 };
      }
      if (/INSERT INTO calendar_event \(/.test(sql)) {
        return insertConflict
          ? { rows: [], rowCount: 0 }
          : { rows: [{ calendar_event_id: "spawned-e1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const recurring = (over = {}) => ({
  task_id: "t1",
  title: "File the TVA return",
  description: "Monthly",
  priority: "HIGH",
  assigned_to: "u-acc",
  created_by: "u-boss",
  due_at: "2026-09-14T16:00:00.000Z", // 17:00 Douala, the 14th
  parent_task_id: null,
  entity_type: null,
  entity_id: null,
  is_personal: false,
  scope_id: null,
  reminder_minutes: 1440,
  recurrence_rule: "FREQ=MONTHLY;BYMONTHDAY=14",
  recurrence_series_id: "t1",
  ...over,
});

const recurringEvent = (over = {}) => ({
  calendar_event_id: "e1",
  title: "Ops review",
  event_type: "meeting",
  location: "Board room",
  description: null,
  start_at: "2026-09-14T09:00:00.000Z", // 10:00 Douala
  end_at: "2026-09-14T10:00:00.000Z", // one hour
  all_day: false,
  created_by: "u-boss",
  entity_type: null,
  entity_id: null,
  reminder_minutes: 60,
  recurrence_rule: "FREQ=MONTHLY;BYMONTHDAY=14",
  recurrence_series_id: "e1",
  ...over,
});

const writes = (c, re) => c.statements.filter((s) => re.test(s.sql));

describe("spawnDue — tasks", () => {
  it("materialises the next occurrence on the same day of the next month", async () => {
    const c = mockClient({ spawnTasks: [recurring()] });
    await spawnDue(c, { now: NOW });
    const inserts = writes(c, /INSERT INTO task \(/);
    expect(inserts).toHaveLength(1);
    // params[5] is due_at: the 14th of October at the same Douala wall clock.
    expect(inserts[0].params[5]).toBe("2026-10-14T16:00:00.000Z");
    // The spawned row carries the series so it can spawn its own successor.
    expect(inserts[0].params[14]).toBe("t1");
  });

  it("carries the checklist but not its ticks", async () => {
    const c = mockClient({ spawnTasks: [recurring()] });
    await spawnDue(c, { now: NOW });
    // copySubtasks is a plain INSERT..SELECT; the test asserts it was issued.
    expect(writes(c, /INSERT INTO task_subtask[\s\S]*SELECT/)).toHaveLength(1);
  });

  it("advances the cursor even when the insert loses its race", async () => {
    const c = mockClient({ spawnTasks: [recurring()], insertConflict: true });
    await spawnDue(c, { now: NOW });
    // Nothing was copied for a row that did not materialise…
    expect(writes(c, /INSERT INTO task_subtask/)).toHaveLength(0);
    // …but the cursor still moved, so the row leaves the scan instead of
    // computing-and-losing the same conflict every minute.
    const advance = writes(c, /UPDATE task SET recurrence_cursor_at/);
    expect(advance).toHaveLength(1);
    expect(advance[0].params[1]).toBe("2026-10-14T16:00:00.000Z");
  });

  it("clears the rule when the series has run out", async () => {
    const ended = recurring({ recurrence_rule: "FREQ=MONTHLY;BYMONTHDAY=14;UNTIL=20260914T235959Z" });
    const c = mockClient({ spawnTasks: [ended] });
    await spawnDue(c, { now: NOW });
    expect(writes(c, /INSERT INTO task \(/)).toHaveLength(0);
    const end = writes(c, /UPDATE task SET recurrence_rule = NULL/);
    expect(end).toHaveLength(1);
  });

  it("stops at COUNT occurrences", async () => {
    // COUNT=2 and the series already has two rows: the third must not appear.
    const counted = recurring({ recurrence_rule: "FREQ=MONTHLY;BYMONTHDAY=14;COUNT=2" });
    const c = mockClient({ spawnTasks: [counted], seriesCount: 2 });
    await spawnDue(c, { now: NOW });
    expect(writes(c, /INSERT INTO task \(/)).toHaveLength(0);
    expect(writes(c, /UPDATE task SET recurrence_rule = NULL/)).toHaveLength(1);
  });
});

describe("spawnDue — events", () => {
  it("keeps the slot's length while moving the day", async () => {
    const c = mockClient({ spawnEvents: [recurringEvent()] });
    await spawnDue(c, { now: NOW });
    const inserts = writes(c, /INSERT INTO calendar_event \(/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[4]).toBe("2026-10-14T09:00:00.000Z"); // start
    expect(inserts[0].params[5]).toBe("2026-10-14T10:00:00.000Z"); // still one hour
  });

  it("re-invites the same people on the new date", async () => {
    const c = mockClient({ spawnEvents: [recurringEvent()] });
    await spawnDue(c, { now: NOW });
    expect(writes(c, /INSERT INTO calendar_participant[\s\S]*SELECT/)).toHaveLength(1);
  });

  it("clears the rule when the event series is over", async () => {
    const ended = recurringEvent({ recurrence_rule: "FREQ=MONTHLY;BYMONTHDAY=14;UNTIL=20260914" });
    const c = mockClient({ spawnEvents: [ended] });
    await spawnDue(c, { now: NOW });
    expect(writes(c, /INSERT INTO calendar_event \(/)).toHaveLength(0);
    expect(writes(c, /UPDATE calendar_event SET recurrence_rule = NULL/)).toHaveLength(1);
  });
});
