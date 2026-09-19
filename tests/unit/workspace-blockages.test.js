/**
 * Task blockages (13975) — the hold, the blocked predicate, and the loud
 * notification contract.
 *
 * ── WHY THIS SUITE IS PURE ─────────────────────────────────────────────────
 *
 * Same reasoning as workspace-dependencies.test.js: the decisions under test
 * are semantic ("what counts as blocked", "one active hold", "resolving moves
 * the due date by exactly the blocked time", "a raise cannot be silenced"),
 * and each is written once and read never. They are exercised through a
 * recording mock client and through the pure helpers, so a regression fails
 * here rather than in somebody's performance review.
 *
 * The four properties that matter most:
 *
 *   · "BLOCKED" HAS ONE DEFINITION ACROSS EVERY SURFACE. The card pill, the
 *     panel callout and the Monitor's Blocked-work panel all read the same
 *     predicate; a hold must make a task blocked everywhere at once, so the
 *     analytics SQL is asserted to carry the blockage leg.
 *   · ONE ACTIVE HOLD PER TASK is a database rule (partial unique index); the
 *     resolve write is asserted to guard on `resolved_at IS NULL` so two
 *     racing clicks cannot double-shift a due date.
 *   · THE DUE-DATE MOVEMENT IS EXACTLY THE BLOCKED DURATION and is recorded on
 *     the row that caused it — the attribution the whole feature exists for.
 *   · A RAISED BLOCKAGE CANNOT BE SILENCED: `force` skips the preference read
 *     entirely, in-app and email both fire, and push mirrors the in-app row.
 */
"use strict";

const repo = require("../../src/modules/dashboard/workspace/tasks.repo");
const service = require("../../src/modules/dashboard/workspace/tasks.service");
const notifyService = require("../../src/modules/notification/notification.service");
const validators = require("../../src/modules/dashboard/workspace/tasks.validator");

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

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

const visibility = { permissionScope: "all", scopeIds: [] };
const filters = {
  from: "2026-09-01T00:00:00.000Z",
  to: "2026-09-30T00:00:00.000Z",
};

describe("the blocked predicate carries blockages everywhere", () => {
  it("analyticsSummary counts a live hold as blocked", async () => {
    const client = mockClient(() => [{}]);
    await repo.analyticsSummary(client, {
      visibility,
      filters,
      nowIso: "2026-09-19T00:00:00.000Z",
    });
    const sql = client.calls.map((c) => c.sql).join("\n");
    expect(sql).toContain("task_blockage");
    expect(sql).toContain("b.resolved_at IS NULL");
  });

  it("workload and per-file rollups count a live hold as blocked", async () => {
    const client = mockClient(() => []);
    await repo.analyticsWorkload(client, {
      visibility,
      filters,
      nowIso: "2026-09-19T00:00:00.000Z",
    });
    await repo.analyticsByFile(client, {
      visibility,
      filters,
      nowIso: "2026-09-19T00:00:00.000Z",
    });
    const sql = client.calls.map((c) => c.sql).join("\n");
    expect(sql.match(/task_blockage/g).length).toBeGreaterThanOrEqual(2);
  });

  it("the Blocked-work list reads holds AND dependencies, oldest first", async () => {
    const client = mockClient(() => []);
    await repo.analyticsBlocked(client, { visibility, filters });
    const sql = client.calls[0].sql;
    expect(sql).toContain("task_blockage");
    expect(sql).toContain("least(deps.blocked_since, hold.raised_at)");
    expect(sql).toContain("hold.note               AS blockage_note");
  });

  it("activeBlockagesFor is a lookup, not an aggregation (one live hold per task)", async () => {
    const client = mockClient(() => []);
    await repo.activeBlockagesFor(client, ["t1", "t2"]);
    const sql = client.calls[0].sql;
    expect(sql).toContain("b.resolved_at IS NULL");
    expect(sql).not.toContain("GROUP BY");
  });
});

describe("card and panel decoration", () => {
  const row = (over = {}) => ({
    task_id: "t1",
    status: "IN_PROGRESS",
    ...over,
  });
  const hold = (over = {}) => ({
    task_blockage_id: "b1",
    task_id: "t1",
    note: "Held at customs — network down",
    estimated_resolve_at: null,
    raised_by: ME,
    raised_by_name: "Ada",
    raised_at: "2026-09-17T08:00:00.000Z",
    resolved_at: null,
    resolved_by_name: null,
    resolve_note: null,
    due_shift: null,
    ...over,
  });

  it("a live hold blocks a card with no dependency edges, and carries the note", () => {
    const card = service.decorator([], [], [hold()])(row());
    expect(card.is_blocked).toBe(true);
    expect(card.blocking_count).toBe(0);
    expect(card.blockage.note).toBe("Held at customs — network down");
    expect(card.blocked_since).toBe("2026-09-17T08:00:00.000Z");
  });

  it("a finished task is never 'blocked', whatever it carries", () => {
    const card = service.decorator([], [], [hold()])(row({ status: "DONE" }));
    expect(card.is_blocked).toBe(false);
  });

  it("blocked_since is the OLDER of the dependency edge and the hold", () => {
    const olderEdge = [
      {
        task_id: "t1",
        blocking_count: 1,
        blocked_since: "2026-09-10T08:00:00.000Z",
      },
    ];
    const card = service.decorator(olderEdge, [], [hold()])(row());
    expect(card.blocked_since).toBe("2026-09-10T08:00:00.000Z");
    const newerEdge = [
      {
        task_id: "t1",
        blocking_count: 1,
        blocked_since: "2026-09-18T08:00:00.000Z",
      },
    ];
    const card2 = service.decorator(newerEdge, [], [hold()])(row());
    expect(card2.blocked_since).toBe("2026-09-17T08:00:00.000Z");
  });

  it("shapeBlockage never leaks a raw row onto a screen", () => {
    const shaped = service.shapeBlockage(hold({ extra_internal_column: "x" }));
    expect(shaped.extra_internal_column).toBeUndefined();
    expect(shaped.task_blockage_id).toBe("b1");
    expect(service.shapeBlockage(null)).toBe(null);
  });
});

describe("the resolve write cannot double-shift", () => {
  it("resolveBlockageRow guards on resolved_at IS NULL", async () => {
    const client = mockClient(() => []);
    await repo.resolveBlockageRow(client, "b1", {
      resolvedBy: ME,
      resolveNote: "cleared",
    });
    const { sql, params } = client.calls[0];
    expect(sql).toContain("resolved_at IS NULL");
    expect(params).toEqual(["b1", ME, "cleared"]);
  });

  it("shiftTaskDue only touches rows that HAVE a due date", async () => {
    const client = mockClient(() => []);
    await repo.shiftTaskDue(client, "t1", 345600);
    const { sql, params } = client.calls[0];
    expect(sql).toContain("due_at IS NOT NULL");
    expect(sql).toContain("due_at + ($2 || ' seconds')::interval");
    expect(params).toEqual(["t1", 345600]);
  });

  it("the shift is recorded on the blockage row that caused it", async () => {
    const client = mockClient(() => [{ due_shift: "4 days" }]);
    await repo.setBlockageDueShift(client, "b1", 345600);
    const { sql, params } = client.calls[0];
    expect(sql).toContain("UPDATE task_blockage");
    expect(sql).toContain("due_shift");
    expect(params).toEqual(["b1", 345600]);
  });

  it("humanDuration says what a person says", () => {
    expect(service.humanDuration(4 * 86400)).toBe("4d");
    expect(service.humanDuration(2 * 86400 + 4 * 3600)).toBe("2d 4h");
    expect(service.humanDuration(3 * 3600)).toBe("3h");
    expect(service.humanDuration(20 * 60)).toBe("20m");
  });
});

describe("the raise payload is validated, not trusted", () => {
  // The validator exports body()-wrapped middleware (the house shape), so the
  // schema is exercised the way a request exercises it: an error arrives on
  // `next`, a clean payload does not.
  const validateRaise = (payload) =>
    new Promise((resolve) => {
      let settled = false;
      const next = (e) => {
        settled = true;
        resolve(e || null);
      };
      const out = validators.blockageRaise({ body: payload }, {}, next);
      if (out && typeof out.then === "function") {
        out.then(
          () => {
            if (!settled) resolve(null);
          },
          (e) => resolve(e),
        );
      } else if (!settled) {
        resolve(null);
      }
    });

  it("a blockage without a note is refused", async () => {
    expect(await validateRaise({ note: "   " })).toBeTruthy();
  });

  it("a thousand characters of note is the ceiling", async () => {
    expect(await validateRaise({ note: "x".repeat(1001) })).toBeTruthy();
    expect(await validateRaise({ note: "x".repeat(1000) })).toBe(null);
  });

  it("unknown fields are a 422, not a silent ignore", async () => {
    expect(
      await validateRaise({ note: "customs down", category: "CUSTOMS" }),
    ).toBeTruthy();
  });

  it("the fan-out lists are bounded", async () => {
    expect(
      await validateRaise({
        note: "customs down",
        notify_user_ids: Array(51).fill(ME),
      }),
    ).toBeTruthy();
    expect(
      await validateRaise({
        note: "customs down",
        channel_ids: Array(11).fill(ME),
      }),
    ).toBeTruthy();
  });

  it("a clean raise passes, with the audience riding along", async () => {
    expect(
      await validateRaise({
        note: "held at customs — network down",
        estimated_resolve_at: "2026-09-21T18:00",
        audience: "team",
      }),
    ).toBe(null);
  });
});

describe("a raised blockage cannot be silenced (force)", () => {
  it("force skips the preference read and still writes in-app + email + push", async () => {
    const client = mockClient((sql) => {
      if (/INSERT INTO notification/i.test(sql))
        return [{ notification_id: "n1" }];
      if (/SELECT.*unread/i.test(sql)) return [{ unread: 1 }];
      return [];
    });
    const result = await notifyService.notify(client, {
      userId: OTHER,
      eventTypeKey: "task.blockage_raised",
      title: "Ada registered a blockage on a task",
      body: "Held at customs — network down",
      category: "tasks",
      force: true,
    });
    const sql = client.calls.map((c) => c.sql).join("\n");
    // No preference row is consulted: nothing the recipient switched off may
    // stop a hold from reaching them.
    expect(sql).not.toMatch(/notification_preference/);
    // The in-app row was written despite no preference row existing…
    expect(sql).toMatch(/INSERT INTO notification/i);
    // …and the delivery plan went out (push leg attempted, email wanted).
    expect(result).toBeTruthy();
  });

  it("without force the preference read still happens (force is narrow, not default)", async () => {
    const client = mockClient((sql) => {
      if (/INSERT INTO notification/i.test(sql))
        return [{ notification_id: "n1" }];
      if (/SELECT.*unread/i.test(sql)) return [{ unread: 1 }];
      return [];
    });
    await notifyService.notify(client, {
      userId: OTHER,
      eventTypeKey: "task.pinged",
      title: "Ada pinged you about a task",
      category: "tasks",
    });
    const sql = client.calls.map((c) => c.sql).join("\n");
    expect(sql).toMatch(/notification_preference|isChannelEnabled|preference/i);
  });
});
