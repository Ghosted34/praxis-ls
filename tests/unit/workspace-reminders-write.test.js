/**
 * writeReminders — the several-reminders write path (13890).
 *
 * What must hold, tested against a scripted client rather than a tenant:
 *
 *   - the old set is SOFT-DELETED before the new rows land (a replaced slot
 *     does not stack a duplicate alarm);
 *   - one INSERT per row, ordinals 1..n, relative rows with remind_at NULL
 *     and absolute rows with reminder_minutes NULL (the sweep reads only
 *     remind_at, and the CHECK refuses both-set);
 *   - the 3-row cap is enforced before any statement reaches the client;
 *   - an empty list is the explicit "clear them all";
 *   - the parent's legacy columns are re-projected so an older reader sees
 *     the same promise the first row makes.
 *
 * The transaction probe lands on our recorder harmlessly (it is how
 * atomically() learns the connection is already open).
 */
"use strict";

const service = require("../../src/modules/dashboard/workspace/tasks.service");

function mockClient() {
  const statements = [];
  return {
    statements,
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      // The sync-projection SELECT answers the one row it would compute:
      // the first reminder's values. The UPDATE it feeds is then asserted on.
      if (/SELECT\s+\(SELECT reminder_minutes/.test(sql)) {
        return { rows: [{ reminder_minutes: 60, remind_at: "2026-09-15T16:00:00.000Z" }] };
      }
      if (/INSERT INTO workspace_reminder/.test(sql)) {
        return { rows: [{ workspace_reminder_id: `wr-${statements.length}` }] };
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

const inserts = (c) => c.statements.filter((s) => /INSERT INTO workspace_reminder/.test(s.sql));
const clearers = (c) =>
  c.statements.filter((s) => /UPDATE workspace_reminder\s+SET is_deleted = true/.test(s.sql));
const syncs = (c) =>
  c.statements.filter((s) => /SET reminder_minutes = \$2, remind_at = \$3/.test(s.sql));

describe("writeReminders — replacing, not stacking", () => {
  it("soft-deletes the previous set before writing the new one", async () => {
    const c = mockClient();
    await service.writeReminders(c, {
      ownerType: "task",
      ownerId: "t1",
      input: { reminders: [{ reminder_minutes: 60 }] },
      anchor: "2026-09-15T17:00:00Z",
      timeZone: "UTC",
      actor: { user_id: "u1" },
    });
    expect(clearers(c)).toHaveLength(1);
    expect(inserts(c)).toHaveLength(1);
    // The soft-delete ran FIRST in statement order — a stacked duplicate is
    // what the reordering was there to prevent, so order is the assertion.
    const firstWrite = c.statements.findIndex((s) => /workspace_reminder/.test(s.sql));
    expect(/UPDATE workspace_reminder/.test(c.statements[firstWrite].sql)).toBe(true);
    expect(clearers(c)[0].params).toEqual(["task", "t1"]);
  });

  it("writes relative rows with remind_at NULL and absolute rows with minutes NULL", async () => {
    const c = mockClient();
    await service.writeReminders(c, {
      ownerType: "calendar_event",
      ownerId: "e1",
      input: {
        reminders: [
          { reminder_minutes: 60, email: true, scope: "series" },
          { remind_at: "2026-09-15T09:00:00Z" },
        ],
      },
      anchor: "2026-09-15T14:00:00Z",
      timeZone: "UTC",
      actor: { user_id: "u1" },
    });
    const [first, second] = inserts(c);
    // owner_type, owner_id, reminder_minutes, remind_at, ordinal, label, email, scope, created_by, updated_by
    expect(first.params[0]).toBe("calendar_event");
    expect(first.params[1]).toBe("e1");
    expect(first.params[2]).toBe(60);
    expect(first.params[3]).toBeNull();
    expect(first.params[4]).toBe(1);
    expect(first.params[6]).toBe(true);
    expect(first.params[7]).toBe("series");
    expect(second.params[2]).toBeNull();
    expect(second.params[3]).not.toBeNull();
    expect(second.params[4]).toBe(2);
    expect(second.params[6]).toBe(false);
    expect(second.params[7]).toBe("this");
  });

  it("enforces the cap before a single statement reaches the client", async () => {
    const c = mockClient();
    await expect(
      service.writeReminders(c, {
        ownerType: "task",
        ownerId: "t1",
        input: {
          reminders: [
            { reminder_minutes: 0 },
            { reminder_minutes: 15 },
            { reminder_minutes: 60 },
            { reminder_minutes: 1440 },
          ],
        },
        anchor: "2026-09-15T17:00:00Z",
        timeZone: "UTC",
      }),
    ).rejects.toThrow(/at most three/i);
    expect(c.statements).toHaveLength(0);
  });

  it("an empty list is a real clear — the previous set is soft-deleted, nothing inserted", async () => {
    const c = mockClient();
    const out = await service.writeReminders(c, {
      ownerType: "task",
      ownerId: "t1",
      input: { reminders: [] },
      anchor: null,
      timeZone: "UTC",
    });
    expect(out.cleared).toBe(true);
    expect(clearers(c)).toHaveLength(1);
    expect(inserts(c)).toHaveLength(0);
    // And the parent columns still re-project, so the old reader stops
    // seeing a badge for a reminder that no longer exists.
    expect(syncs(c)).toHaveLength(1);
  });

  it("re-projects the legacy pair from the first row — the older client reads one truth", async () => {
    const c = mockClient();
    await service.writeReminders(c, {
      ownerType: "task",
      ownerId: "t1",
      input: { reminders: [{ reminder_minutes: 60 }] },
      anchor: "2026-09-15T17:00:00Z",
      timeZone: "UTC",
    });
    expect(syncs(c)).toHaveLength(1);
    expect(syncs(c)[0].sql).toMatch(/UPDATE task/);
    expect(syncs(c)[0].params.slice(1, 3)).toEqual([60, "2026-09-15T16:00:00.000Z"]);
  });

  /**
   * The projection UPDATE is the last statement of every dialog save, and it
   * shipped comparing `owner_id` with the placeholder that carried
   * `reminder_minutes` (and `owner_type` with the one carrying the owner id).
   * Postgres refused the statement at parse time — `operator does not exist:
   * text = uuid` — so EVERY create and edit that named its reminders 500'd
   * after the task row was already in. A scripted client accepts any SQL, so
   * position-only assertions could not see it. This one reads what each
   * `$n` in the owner predicates is bound to, which is the thing that broke.
   */
  it("binds the owner predicates of the projection UPDATE to the owner, never to the projected values", async () => {
    for (const ownerType of ["task", "calendar_event"]) {
      const c = mockClient();
      const ownerId = `${ownerType}-owner-1`;
      await service.writeReminders(c, {
        ownerType,
        ownerId,
        input: { reminders: [{ reminder_minutes: 60 }] },
        anchor: "2026-09-15T17:00:00Z",
        timeZone: "UTC",
      });
      const [sync] = syncs(c);
      expect(sync.sql).toMatch(ownerType === "task" ? /UPDATE task\b/ : /UPDATE calendar_event\b/);
      const boundTo = (column) =>
        [...sync.sql.matchAll(new RegExp(`\\b${column} = \\$(\\d+)`, "g"))].map((m) => sync.params[Number(m[1]) - 1]);
      // Every `owner_id = $n` and the row predicate resolve to the owner's id…
      expect(boundTo("owner_id")).toEqual([ownerId]);
      expect(boundTo(ownerType === "task" ? "task_id" : "calendar_event_id")).toEqual([ownerId]);
      // …every `owner_type = $n` to the owner type…
      expect(boundTo("owner_type")).toEqual([ownerType]);
      // …and the projected pair keeps its own placeholders.
      expect(boundTo("reminder_minutes")).toEqual([60]);
      expect(boundTo("remind_at")).toEqual(["2026-09-15T16:00:00.000Z"]);
      // Nothing is bound twice under two meanings.
      expect(sync.params).toHaveLength(4);
    }
  });

  it("the 13810 pair is still honoured as one row, so the older client still arms", async () => {
    const c = mockClient();
    await service.writeReminders(c, {
      ownerType: "task",
      ownerId: "t1",
      input: { reminder_minutes: 1440 },
      anchor: "2026-09-15T17:00:00Z",
      timeZone: "UTC",
    });
    expect(inserts(c)).toHaveLength(1);
    expect(inserts(c)[0].params[2]).toBe(1440);
    expect(inserts(c)[0].params[4]).toBe(1);
  });
});
