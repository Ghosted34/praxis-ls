/**
 * workspace-reminder — the sweep.
 *
 * The behaviour under test is the one that would be invisible in normal use
 * and catastrophic in a bad week: a reminder that cannot be delivered must
 * still be disarmed — and a fan-out of one event row must reach every
 * invited person, not just the first to claim the dedupe slot.
 *
 * Run against a scripted client rather than a database, so the sweep's
 * contract with the repo is exercised without a tenant — and so a delivery
 * failure can be provoked deterministically, which a real notifier makes
 * very hard to do.
 */
"use strict";

const { sweep, fmtWhen } = require("../../src/jobs/handlers/workspace-reminder");

const NOW = new Date("2026-09-15T12:00:00Z");

/**
 * A client that answers the sweep's two reads with fixtures and records
 * every statement, so the test can assert on what was written as well as
 * what was read. The reads are now against workspace_reminder (13890): the
 * sweep no longer reads task.task or calendar_event.calendar_event directly,
 * so a fixture without a reminder row fires nothing — which is the point.
 */
function mockClient({ dueTasks = [], dueEvents = [] } = {}) {
  const statements = [];
  return {
    statements,
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      if (/FROM workspace_reminder\b/.test(sql) && /owner_type = 'task'/.test(sql) && /reminder_sent_at IS NULL/.test(sql)) {
        return { rows: dueTasks };
      }
      if (/FROM workspace_reminder\b/.test(sql) && /owner_type = 'calendar_event'/.test(sql) && /reminder_sent_at IS NULL/.test(sql)) {
        return { rows: dueEvents };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

/** Records notifications; optionally fails for a given recipient. */
function mockNotify({ failFor = null } = {}) {
  const sent = [];
  const fn = async (_client, n) => {
    if (failFor && n.userId === failFor) throw new Error("push backend down");
    sent.push(n);
    return n;
  }
  return { sent, fn };
}

const task = (over = {}) => ({
  workspace_reminder_id: "wr-task-1",
  task_id: "t1", title: "Chase the BL", due_at: "2026-09-15T16:00:00Z",
  assigned_to: "u-assignee", created_by: "u-creator", priority: "NORMAL",
  entity_type: null, entity_id: null, email: false, ordinal: 1, ...over,
});

const event = (over = {}) => ({
  workspace_reminder_id: "wr-event-1",
  calendar_event_id: "e1", title: "Client fitting", start_at: "2026-09-15T14:00:00Z",
  location: "Lekki showroom", created_by: "u-organiser",
  participant_user_ids: ["u-guest"], entity_type: null, entity_id: null,
  email: false, ordinal: 1, ...over,
});

describe("workspace-reminder sweep — who is told", () => {
  it("tells the assignee, not the creator, when a task has both", async () => {
    const c = mockClient({ dueTasks: [task()] });
    const { sent, fn } = mockNotify();
    await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent).toHaveLength(1);
    expect(sent[0].userId).toBe("u-assignee");
  });

  it("falls back to the creator for a task nobody was handed", async () => {
    const c = mockClient({ dueTasks: [task({ assigned_to: null })] });
    const { sent, fn } = mockNotify();
    await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent[0].userId).toBe("u-creator");
  });

  it("escalates an urgent task to HIGH priority", async () => {
    const c = mockClient({ dueTasks: [task({ priority: "URGENT" })] });
    const { sent, fn } = mockNotify();
    await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent[0].priority).toBe("HIGH");
  });

  it("tells the organiser and every participant, once each, with per-recipient dedupe", async () => {
    const c = mockClient({ dueEvents: [event()] });
    const { sent, fn } = mockNotify();
    await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent.map((n) => n.userId).sort()).toEqual(["u-guest", "u-organiser"]);
    // The dedupe is the fixable bug: a shared key (`event-reminder:<id>`)
    // claimed by the first recipient silenced the rest of the fan-out. Each
    // recipient must claim their own slot so a retried job cannot double-send
    // THIS person, while the other guests still hear it.
    expect(sent.find((n) => n.userId === "u-organiser").dedupeKey).toBe("event-reminder:wr-event-1:u-organiser");
    expect(sent.find((n) => n.userId === "u-guest").dedupeKey).toBe("event-reminder:wr-event-1:u-guest");
  });

  it("does not tell the organiser twice when they are also a participant", async () => {
    const c = mockClient({ dueEvents: [event({ participant_user_ids: ["u-organiser", "u-guest"] })] });
    const { sent, fn } = mockNotify();
    await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent).toHaveLength(2);
    expect(new Set(sent.map((n) => n.userId)).size).toBe(2);
  });

  it("names the room in the body, because that is the part you forget", async () => {
    const c = mockClient({ dueEvents: [event()] });
    const { sent, fn } = mockNotify();
    await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent[0].body).toContain("Lekki showroom");
  });

  it("gives every notification a dedupe key, so a retried job cannot double-send", async () => {
    const c = mockClient({ dueTasks: [task()], dueEvents: [event()] });
    const { sent, fn } = mockNotify();
    await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent[0].dedupeKey).toBe("task-reminder:wr-task-1:u-assignee");
    expect(sent[1].dedupeKey).toBe("event-reminder:wr-event-1:u-organiser");
  });

  it("forces email only when the row asks for it, and only for that row", async () => {
    // The author's checkbox is per-row: one of two reminders on a task says
    // "email me about THIS one". The sweep must not generalise it across a
    // task's other reminders, and must not invent it for a row that never
    // asked.
    const c = mockClient({
      dueEvents: [event({ email: true, ordinal: 1 }), event({ workspace_reminder_id: "wr-event-2", email: false, ordinal: 2 })],
    });
    const { sent, fn } = mockNotify();
    await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    const first = sent.filter((n) => n.dedupeKey.startsWith("event-reminder:wr-event-1:"));
    const second = sent.filter((n) => n.dedupeKey.startsWith("event-reminder:wr-event-2:"));
    expect(first.every((n) => n.forceEmail === true)).toBe(true);
    expect(second.every((n) => n.forceEmail === false)).toBe(true);
  });

  it("stamps an entity link so the reminder opens the record", async () => {
    const id = "44444444-4444-4444-4444-444444444444";
    const c = mockClient({ dueTasks: [task({ entity_type: "costing", entity_id: id })] });
    const { sent, fn } = mockNotify();
    await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent[0].url).toBe(`/costing/costing/${id}`);
  });

  it("sends no notification at all for a task with nobody on it, but still disarms it", async () => {
    const c = mockClient({ dueTasks: [task({ assigned_to: null, created_by: null })] });
    const { sent, fn } = mockNotify();
    const out = await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent).toHaveLength(0);
    expect(c.statements.some((s) => /UPDATE workspace_reminder SET reminder_sent_at/.test(s.sql))).toBe(true);
    expect(out).toMatchObject({ tasks: 0, failures: 0 });
  });
});

describe("workspace-reminder sweep — a failure must not wedge the queue", () => {
  it("disarms a task whose delivery threw", async () => {
    // THE assertion. Leaving this row armed means the next tick selects it
    // again, and the one after that, forever — and since the sweep takes the
    // oldest rows first, a few poison rows occupy the whole batch and no
    // reminder in the tenant ever fires again.
    const c = mockClient({ dueTasks: [task()] });
    const { fn } = mockNotify({ failFor: "u-assignee" });
    const out = await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    const disarm = c.statements.find((s) => /UPDATE workspace_reminder SET reminder_sent_at/.test(s.sql));
    expect(disarm).toBeDefined();
    expect(disarm.params[0]).toBe("wr-task-1");
    expect(out.failures).toBe(1);
  });

  it("disarms an event when one recipient fails and still tells the others", async () => {
    const c = mockClient({ dueEvents: [event({ participant_user_ids: ["u-guest", "u-guest2"] })] });
    const { sent, fn } = mockNotify({ failFor: "u-guest" });
    const out = await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    // The organiser and the second guest still heard about it.
    expect(sent.map((n) => n.userId).sort()).toEqual(["u-guest2", "u-organiser"]);
    expect(out.failures).toBe(1);
    expect(c.statements.some((s) => /UPDATE workspace_reminder SET reminder_sent_at/.test(s.sql))).toBe(true);
  });

  it("does not let one bad row stop the rows behind it", async () => {
    const c = mockClient({
      dueTasks: [task({ task_id: "poison", workspace_reminder_id: "wr-poison" }), task({ task_id: "fine", workspace_reminder_id: "wr-fine", assigned_to: "u-other" })],
    });
    const { sent, fn } = mockNotify({ failFor: "u-assignee" });
    const out = await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent.map((n) => n.entityRef)).toContain("task:fine");
    expect(out.failures).toBe(1);
    expect(out.tasks).toBe(1);
  });
});

describe("workspace-reminder sweep — the reads it makes", () => {
  it("passes the sweep instant and a bound to both reads", async () => {
    const c = mockClient();
    await sweep(c, { notify: mockNotify().fn, timeZone: "UTC", now: NOW, limit: 25 });
    const reads = c.statements.filter((s) => /reminder_sent_at IS NULL/.test(s.sql));
    expect(reads).toHaveLength(2);
    for (const r of reads) {
      expect(r.params[0]).toBe(NOW.toISOString());
      expect(r.params[1]).toBe(25);
    }
  });

  it("does nothing at all when nothing is due", async () => {
    const c = mockClient();
    const { sent, fn } = mockNotify();
    const out = await sweep(c, { notify: fn, timeZone: "UTC", now: NOW });
    expect(sent).toHaveLength(0);
    expect(out).toEqual({ tasks: 0, events: 0, failures: 0 });
    expect(c.statements.filter((s) => /^\s*UPDATE\b/.test(s.sql))).toHaveLength(0);
  });
});

describe("fmtWhen — the date a person reads", () => {
  it("renders day-first in the tenant's zone, not the container's", async () => {
    // The worker has no LANG. A formatter with no locale is month-first on a US
    // host and undefined in a bare container, which is how a reminder came to
    // say "09/15" for the 15th of September.
    const out = fmtWhen("2026-09-15T16:00:00Z", "Africa/Douala");
    expect(out).toContain("Tue");
    expect(out).toContain("15 Sept");
    expect(out).toMatch(/17:00/); // 16:00Z is 17:00 in Douala
  });

  it("returns null for an absent or unreadable instant rather than 'Invalid Date'", async () => {
    expect(fmtWhen(null, "UTC")).toBeNull();
    expect(fmtWhen("nonsense", "UTC")).toBeNull();
  });
});
