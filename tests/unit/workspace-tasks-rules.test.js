/**
 * My Workspace tasks & events — the rules that decide what a caller sees, when
 * a reminder fires, and how a day reads.
 *
 * No database here on purpose. Every function under test is pure, which is the
 * point of having written them that way: an authorisation rule that can only be
 * exercised through a live tenant is a rule nobody tests.
 */
"use strict";

const service = require("../../src/modules/dashboard/workspace/tasks.service");

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const SCOPE = "33333333-3333-3333-3333-333333333333";

/** A caller with no scope rows — the CEO, or anyone before the organigramme. */
const unrestricted = {
  user: { user_id: ME },
  permission_scope: "all",
  scope_ids: null,
};
/** A caller confined to part of the organigramme. */
const scoped = {
  user: { user_id: ME },
  permission_scope: "scoped",
  scope_ids: [SCOPE],
};

describe("audiencesFor — the switch only offers what would work", () => {
  it("offers only 'mine' to a scoped caller with no closure", () => {
    expect(
      service.audiencesFor({
        user: { user_id: ME },
        permission_scope: "scoped",
        scope_ids: null,
      }),
    ).toEqual(["mine"]);
  });

  it("adds 'team' when the caller has a scope closure", () => {
    expect(service.audiencesFor(scoped)).toEqual(["mine", "team"]);
  });

  it("adds 'all' only for a tenant-wide caller", () => {
    expect(service.audiencesFor(unrestricted)).toEqual(["mine", "all"]);
  });
});

describe("resolveAudience — over-reach narrows instead of erroring", () => {
  it("narrows 'all' to 'mine' for a scoped caller", () => {
    // A bookmarked ?audience=all must show their own work, not an error page.
    expect(service.resolveAudience(scoped, "all")).toBe("mine");
  });

  it("narrows 'team' to 'mine' for a caller with no closure", () => {
    expect(service.resolveAudience(unrestricted, "team")).toBe("mine");
  });

  it("honours 'all' for a tenant-wide caller", () => {
    expect(service.resolveAudience(unrestricted, "all")).toBe("all");
  });

  it("honours 'team' for a caller with a closure", () => {
    expect(service.resolveAudience(scoped, "team")).toBe("team");
  });

  it("defaults an absent audience to 'mine'", () => {
    expect(service.resolveAudience(unrestricted, undefined)).toBe("mine");
  });

  it("refuses a value that is not an audience at all", () => {
    expect(service.resolveAudience(unrestricted, "everybody")).toBe("mine");
  });
});

describe("canSeeTask — the get-by-id rule matches the list rule", () => {
  const task = (over = {}) => ({
    task_id: "t1",
    assigned_to: null,
    created_by: OTHER,
    is_personal: false,
    scope_id: null,
    ...over,
  });

  it("always shows a task you wrote", () => {
    expect(service.canSeeTask(task({ created_by: ME }), scoped, "mine")).toBe(
      true,
    );
  });

  it("always shows a task assigned to you", () => {
    expect(service.canSeeTask(task({ assigned_to: ME }), scoped, "mine")).toBe(
      true,
    );
  });

  it("hides someone else's task under 'mine'", () => {
    expect(service.canSeeTask(task(), scoped, "mine")).toBe(false);
  });

  it("shows an unscoped task to a scoped caller under 'team'", () => {
    // NULL scope means "not assigned to a part of the company", and hiding
    // those would empty a team list for every record written before the
    // organigramme existed.
    expect(service.canSeeTask(task(), scoped, "team")).toBe(true);
  });

  it("shows a task in the caller's scope under 'team'", () => {
    expect(service.canSeeTask(task({ scope_id: SCOPE }), scoped, "team")).toBe(
      true,
    );
  });

  it("hides a task in ANOTHER scope under 'team'", () => {
    expect(
      service.canSeeTask(
        task({ scope_id: "99999999-9999-9999-9999-999999999999" }),
        scoped,
        "team",
      ),
    ).toBe(false);
  });

  it("shows everything under 'all'", () => {
    expect(service.canSeeTask(task(), unrestricted, "all")).toBe(true);
  });

  it("hides a personal task from everyone but its creator and assignee", () => {
    expect(
      service.canSeeTask(task({ is_personal: true }), unrestricted, "all"),
    ).toBe(false);
    expect(
      service.canSeeTask(
        task({ is_personal: true, created_by: ME }),
        unrestricted,
        "all",
      ),
    ).toBe(true);
    // Handed to you personally, so the flag does not hide it from you.
    expect(
      service.canSeeTask(
        task({ is_personal: true, assigned_to: ME }),
        unrestricted,
        "all",
      ),
    ).toBe(true);
  });

  it("returns false for a task that does not exist", () => {
    expect(service.canSeeTask(null, unrestricted, "all")).toBe(false);
  });
});

describe("calendar event visibility — list and detail agree", () => {
  const event = (over = {}) => ({
    calendar_event_id: "e1",
    created_by: OTHER,
    scope_id: null,
    ...over,
  });

  it("shows the organiser and an invited internal user in mine", () => {
    expect(service.canSeeEvent(event({ created_by: ME }), scoped, "mine")).toBe(
      true,
    );
    expect(
      service.canSeeEvent(event(), scoped, "mine", [{ user_id: ME }]),
    ).toBe(true);
  });

  it("does not expose an unrelated event to a scoped caller", () => {
    expect(service.canSeeEvent(event(), scoped, "mine")).toBe(false);
    expect(
      service.canSeeEvent(event({ scope_id: SCOPE }), scoped, "team"),
    ).toBe(true);
    expect(
      service.canSeeEvent(
        event({ scope_id: "99999999-9999-9999-9999-999999999999" }),
        scoped,
        "team",
      ),
    ).toBe(false);
  });

  it("requires the explicit all audience even for a tenant-wide caller", () => {
    expect(service.canSeeEvent(event(), unrestricted, "mine")).toBe(false);
    expect(service.canSeeEvent(event(), unrestricted, "all")).toBe(true);
  });

  it("lets only the organiser or an explicit tenant-wide manager mutate", () => {
    expect(service.canManageEvent(event({ created_by: ME }), scoped)).toBe(
      true,
    );
    expect(
      service.canManageEvent(event(), scoped, [
        { user_id: ME, is_organiser: true },
      ]),
    ).toBe(true);
    expect(
      service.canManageEvent(event(), scoped, [
        { user_id: ME, is_organiser: false },
      ]),
    ).toBe(false);
    expect(service.canManageEvent(event(), unrestricted)).toBe(true);
  });
});

describe("resolveReminderRows — the several reminders a record carries", () => {
  const tz = "UTC";

  it("resolves a relative row from the anchor, one hour earlier", () => {
    const rows = service.resolveReminderRows({
      reminders: [{ reminder_minutes: 60 }],
      anchor: "2026-09-15T17:00:00Z",
      timeZone: tz,
    });
    expect(rows).toEqual([
      { reminderMinutes: 60, remindAt: null, ordinal: 1, label: null, email: false, scope: "this" },
    ]);
  });

  it("resolves an explicit instant and keeps both kinds in one set", () => {
    const rows = service.resolveReminderRows({
      reminders: [
        { reminder_minutes: 1440, email: true, label: "the day before", scope: "series" },
        { remind_at: "2026-09-15T09:00:00Z" },
      ],
      anchor: "2026-09-15T17:00:00Z",
      timeZone: tz,
    });
    expect(rows[0]).toMatchObject({ reminderMinutes: 1440, remindAt: null, ordinal: 1, email: true, scope: "series", label: "the day before" });
    expect(rows[1]).toMatchObject({ reminderMinutes: null, remindAt: "2026-09-15T09:00:00.000Z", ordinal: 2, email: false, scope: "this" });
  });

  it("refuses a fourth reminder — the cap is a rule of the record, not its form", () => {
    expect(() =>
      service.resolveReminderRows({
        reminders: [
          { reminder_minutes: 5 }, { reminder_minutes: 30 }, { reminder_minutes: 60 }, { reminder_minutes: 1440 },
        ],
        anchor: "2026-09-15T17:00:00Z",
        timeZone: tz,
      }),
    ).toThrow(/at most three/i);
  });

  it("refuses a row that is both relative and absolute — the two are one alarm", () => {
    expect(() =>
      service.resolveReminderRows({
        reminders: [{ reminder_minutes: 60, remind_at: "2026-09-15T09:00:00Z" }],
        anchor: "2026-09-15T17:00:00Z",
        timeZone: tz,
      }),
    ).toThrow(/relative or at a time/i);
  });

  it("refuses an empty row, because it is not armed", () => {
    expect(() =>
      service.resolveReminderRows({ reminders: [{}], anchor: "2026-09-15T17:00:00Z", timeZone: tz }),
    ).toThrow(/minutes-before or a time/i);
  });

  it("refuses a relative row with no anchor — a reminder for no date is not one", () => {
    expect(() =>
      service.resolveReminderRows({ reminders: [{ reminder_minutes: 60 }], anchor: null, timeZone: tz }),
    ).toThrow(/needs a date/i);
  });

  it("keeps scope, email and label opt-in per row, never inherited", () => {
    const rows = service.resolveReminderRows({
      reminders: [
        { reminder_minutes: 60 },
        { reminder_minutes: 60, email: true, scope: "series", label: "  board morning  " },
      ],
      anchor: "2026-09-15T17:00:00Z",
      timeZone: tz,
    });
    expect(rows[0].email).toBe(false);
    expect(rows[1]).toMatchObject({ email: true, scope: "series", label: "board morning" });
  });
});

describe("deriveLink — a task points at the record, not at a memo", () => {
  it("resolves a mapped entity type to its screen", () => {
    const id = "44444444-4444-4444-4444-444444444444";
    expect(service.deriveLink({ entity_type: "costing", entity_id: id })).toBe(
      `/costing/costing/${id}`,
    );
  });

  it("returns null for an unmapped type rather than throwing", () => {
    // The map grows; a task written today must still render before its type is
    // added. A task that errors is worse than a task with no link.
    expect(
      service.deriveLink({ entity_type: "not_a_thing_yet", entity_id: ME }),
    ).toBeNull();
  });

  it("returns null when there is nothing to point at", () => {
    expect(
      service.deriveLink({ entity_type: null, entity_id: null }),
    ).toBeNull();
    expect(
      service.deriveLink({ entity_type: "costing", entity_id: null }),
    ).toBeNull();
    expect(service.deriveLink(null)).toBeNull();
  });
});

describe("withLink — every read carries the affordance", () => {
  it("stamps link_url, a label and has_link", () => {
    const id = "44444444-4444-4444-4444-444444444444";
    const out = service.withLink({
      task_id: "t1",
      entity_type: "cash_request",
      entity_id: id,
    });
    expect(out.has_link).toBe(true);
    expect(out.entity_label).toBe("Cash Request");
    expect(out.link_url).toBe(`/costing/cash-requests/${id}`);
  });

  it("says plainly when there is no link", () => {
    const out = service.withLink({
      task_id: "t1",
      entity_type: null,
      entity_id: null,
    });
    expect(out.has_link).toBe(false);
    expect(out.link_url).toBeNull();
  });
});

describe("mergeTimeline — one day, in time order", () => {
  const task = (over = {}) => ({
    task_id: "t",
    title: "task",
    status: "TO_DO",
    priority: "NORMAL",
    due_at: null,
    entity_type: null,
    entity_id: null,
    ...over,
  });
  const event = (over = {}) => ({
    calendar_event_id: "e",
    title: "event",
    event_type: "meeting",
    start_at: null,
    all_day: false,
    participant_count: 0,
    ...over,
  });

  it("interleaves by time rather than listing tasks then events", () => {
    const items = service.mergeTimeline(
      [
        task({ task_id: "late", due_at: "2026-09-15T17:00:00Z" }),
        task({ task_id: "early", due_at: "2026-09-15T08:00:00Z" }),
      ],
      [event({ calendar_event_id: "mid", start_at: "2026-09-15T10:00:00Z" })],
    );
    expect(items.map((i) => i.id)).toEqual(["early", "mid", "late"]);
  });

  it("puts an appointment before a task at the same instant", () => {
    const at = "2026-09-15T10:00:00Z";
    const items = service.mergeTimeline(
      [task({ task_id: "t", due_at: at })],
      [event({ calendar_event_id: "e", start_at: at })],
    );
    expect(items.map((i) => i.kind)).toEqual(["event", "task"]);
  });

  it("sorts undated work last, not first", () => {
    const items = service.mergeTimeline(
      [
        task({ task_id: "undated", due_at: null }),
        task({ task_id: "dated", due_at: "2026-09-15T17:00:00Z" }),
      ],
      [],
    );
    expect(items.map((i) => i.id)).toEqual(["dated", "undated"]);
  });

  it("flags an open past task as overdue, and a finished one as not", () => {
    const past = "2020-01-01T00:00:00Z";
    const [open, done] = service.mergeTimeline(
      [
        task({ task_id: "open", due_at: past, status: "IN_PROGRESS" }),
        task({ task_id: "done", due_at: past, status: "DONE" }),
      ],
      [],
    );
    expect(open.is_overdue).toBe(true);
    expect(done.is_overdue).toBe(false);
  });

  it("does not call an undated task overdue", () => {
    const [item] = service.mergeTimeline(
      [task({ due_at: null, status: "TO_DO" })],
      [],
    );
    expect(item.is_overdue).toBe(false);
  });

  it("includes an actionable subtask deadline and opens its parent", () => {
    const [item] = service.mergeTimeline(
      [],
      [],
      [
        {
          task_subtask_id: "s1",
          task_id: "t1",
          title: "Attach the receipt",
          task_title: "Close the advance",
          task_status: "IN_PROGRESS",
          task_priority: "HIGH",
          due_at: "2020-01-01T00:00:00Z",
          entity_type: null,
          entity_id: null,
        },
      ],
    );
    expect(item).toMatchObject({
      kind: "subtask",
      id: "s1",
      task_id: "t1",
      is_overdue: true,
    });
  });

  it("tolerates all three lists being empty", () => {
    expect(service.mergeTimeline([], [], [])).toEqual([]);
  });
});

/* ── input schemas vs the payloads the dialogs actually send ──────────────── */
/*
 * These two classes of bug were both live in production: the list pages 422'd
 * on first load because `from`/`to` were required while the client sends no
 * window, and event creation 422'd because the dialog sends an explicit null
 * for an empty field and the schema said `.optional()` but not `.nullable()`.
 * The schemas and the client payloads were written against different
 * assumptions and nothing compared them — so the payloads below are pinned to
 * exactly what `event-dialog.tsx` and `task-dialog.tsx` build, and this file
 * is the comparison.
 */
describe("input schemas — what the client sends must be what the server accepts", () => {
  const v =
    require("../../src/modules/dashboard/workspace/tasks.validator").schemas;

  it("dayQuery accepts no window (the controller defaults it to today)", () => {
    expect(v.dayQuery.safeParse({}).success).toBe(true);
  });

  it("eventListQuery accepts no window (the controller defaults it to the month)", () => {
    expect(v.eventListQuery.safeParse({}).success).toBe(true);
  });

  it("taskCreate accepts the dialog's payload with an empty Notes field", () => {
    // task-dialog.tsx sends description: null, not description: omitted.
    const r = v.taskCreate.safeParse({
      title: "Chase the BOL",
      description: null,
      due_at: null,
      reminder_minutes: null,
      is_personal: false,
    });
    expect(r.success).toBe(true);
  });

  it("eventCreate and eventUpdate accept a nullable organisational scope", () => {
    const create = v.eventCreate.safeParse({
      title: "Standup",
      start_at: "2026-09-16T09:00",
      end_at: "2026-09-16T09:30",
      scope_id: null,
    });
    const update = v.eventUpdate.safeParse({ scope_id: null });
    expect(create.success).toBe(true);
    expect(update.success).toBe(true);
  });

  it("eventCreate accepts the dialog's payload with empty Where and Notes", () => {
    // event-dialog.tsx sends location: null and description: null, not omitted.
    const r = v.eventCreate.safeParse({
      title: "Standup",
      event_type: "meeting",
      location: null,
      description: null,
      start_at: "2026-09-16T09:00",
      end_at: "2026-09-16T09:30",
      all_day: false,
      reminder_minutes: null,
    });
    expect(r.success).toBe(true);
  });

  it("taskCreate and eventCreate accept recurrence_rule: null for non-recurring items", () => {
    // When "Does not repeat" is selected, the dialogs pass recurrence_rule: null
    const task = v.taskCreate.safeParse({
      title: "Follow up on FMA export file",
      recurrence_rule: null,
    });
    const event = v.eventCreate.safeParse({
      title: "One-off meeting",
      start_at: "2026-09-19T09:00",
      end_at: "2026-09-19T10:00",
      recurrence_rule: null,
    });
    expect(task.success).toBe(true);
    expect(event.success).toBe(true);
  });
});
