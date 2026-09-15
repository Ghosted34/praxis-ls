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
const unrestricted = { user: { user_id: ME }, permission_scope: "all", scope_ids: null };
/** A caller confined to part of the organigramme. */
const scoped = { user: { user_id: ME }, permission_scope: "scoped", scope_ids: [SCOPE] };

describe("audiencesFor — the switch only offers what would work", () => {
  it("offers only 'mine' to a scoped caller with no closure", () => {
    expect(service.audiencesFor({ user: { user_id: ME }, permission_scope: "scoped", scope_ids: null }))
      .toEqual(["mine"]);
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
    task_id: "t1", assigned_to: null, created_by: OTHER,
    is_personal: false, scope_id: null, ...over,
  });

  it("always shows a task you wrote", () => {
    expect(service.canSeeTask(task({ created_by: ME }), scoped, "mine")).toBe(true);
  });

  it("always shows a task assigned to you", () => {
    expect(service.canSeeTask(task({ assigned_to: ME }), scoped, "mine")).toBe(true);
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
    expect(service.canSeeTask(task({ scope_id: SCOPE }), scoped, "team")).toBe(true);
  });

  it("hides a task in ANOTHER scope under 'team'", () => {
    expect(service.canSeeTask(task({ scope_id: "99999999-9999-9999-9999-999999999999" }), scoped, "team"))
      .toBe(false);
  });

  it("shows everything under 'all'", () => {
    expect(service.canSeeTask(task(), unrestricted, "all")).toBe(true);
  });

  it("hides a personal task from everyone but its creator and assignee", () => {
    expect(service.canSeeTask(task({ is_personal: true }), unrestricted, "all")).toBe(false);
    expect(service.canSeeTask(task({ is_personal: true, created_by: ME }), unrestricted, "all")).toBe(true);
    // Handed to you personally, so the flag does not hide it from you.
    expect(service.canSeeTask(task({ is_personal: true, assigned_to: ME }), unrestricted, "all")).toBe(true);
  });

  it("returns false for a task that does not exist", () => {
    expect(service.canSeeTask(null, unrestricted, "all")).toBe(false);
  });
});

describe("resolveRemindAt — when the reminder fires", () => {
  const tz = "UTC";

  it("lets an explicit instant win over the relative minutes", () => {
    expect(service.resolveRemindAt({
      remind_at: "2026-09-15T09:00:00Z", reminder_minutes: 60,
      anchor: "2026-09-15T17:00:00Z", timeZone: tz,
    })).toBe("2026-09-15T09:00:00.000Z");
  });

  it("derives from the anchor when only minutes are given", () => {
    expect(service.resolveRemindAt({
      reminder_minutes: 60, anchor: "2026-09-15T17:00:00Z", timeZone: tz,
    })).toBe("2026-09-15T16:00:00.000Z");
  });

  it("derives a day-ahead reminder across midnight", () => {
    expect(service.resolveRemindAt({
      reminder_minutes: 1440, anchor: "2026-09-15T09:00:00Z", timeZone: tz,
    })).toBe("2026-09-14T09:00:00.000Z");
  });

  it("returns null for 'no reminder', which is a real outcome", () => {
    expect(service.resolveRemindAt({ reminder_minutes: null, anchor: "2026-09-15T17:00:00Z", timeZone: tz }))
      .toBeNull();
  });

  it("returns null when there is nothing to be relative to", () => {
    // Minutes with no due date cannot resolve; storing a wrong instant would be
    // worse than storing none, because it would fire.
    expect(service.resolveRemindAt({ reminder_minutes: 60, anchor: null, timeZone: tz })).toBeNull();
  });

  it("resolves a zoneless explicit time on the tenant's clock", () => {
    expect(service.resolveRemindAt({
      remind_at: "2026-09-15T09:00", reminder_minutes: null, anchor: null, timeZone: "Africa/Douala",
    })).toBe("2026-09-15T08:00:00.000Z");
  });
});

describe("deriveLink — a task points at the record, not at a memo", () => {
  it("resolves a mapped entity type to its screen", () => {
    const id = "44444444-4444-4444-4444-444444444444";
    expect(service.deriveLink({ entity_type: "costing", entity_id: id }))
      .toBe(`/costing/costing/${id}`);
  });

  it("returns null for an unmapped type rather than throwing", () => {
    // The map grows; a task written today must still render before its type is
    // added. A task that errors is worse than a task with no link.
    expect(service.deriveLink({ entity_type: "not_a_thing_yet", entity_id: ME })).toBeNull();
  });

  it("returns null when there is nothing to point at", () => {
    expect(service.deriveLink({ entity_type: null, entity_id: null })).toBeNull();
    expect(service.deriveLink({ entity_type: "costing", entity_id: null })).toBeNull();
    expect(service.deriveLink(null)).toBeNull();
  });
});

describe("withLink — every read carries the affordance", () => {
  it("stamps link_url, a label and has_link", () => {
    const id = "44444444-4444-4444-4444-444444444444";
    const out = service.withLink({ task_id: "t1", entity_type: "cash_request", entity_id: id });
    expect(out.has_link).toBe(true);
    expect(out.entity_label).toBe("Cash Request");
    expect(out.link_url).toBe(`/costing/cash-requests/${id}`);
  });

  it("says plainly when there is no link", () => {
    const out = service.withLink({ task_id: "t1", entity_type: null, entity_id: null });
    expect(out.has_link).toBe(false);
    expect(out.link_url).toBeNull();
  });
});

describe("mergeTimeline — one day, in time order", () => {
  const task = (over = {}) => ({
    task_id: "t", title: "task", status: "TO_DO", priority: "NORMAL",
    due_at: null, entity_type: null, entity_id: null, ...over,
  });
  const event = (over = {}) => ({
    calendar_event_id: "e", title: "event", event_type: "meeting",
    start_at: null, all_day: false, participant_count: 0, ...over,
  });

  it("interleaves by time rather than listing tasks then events", () => {
    const items = service.mergeTimeline(
      [task({ task_id: "late", due_at: "2026-09-15T17:00:00Z" }),
        task({ task_id: "early", due_at: "2026-09-15T08:00:00Z" })],
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
      [task({ task_id: "undated", due_at: null }),
        task({ task_id: "dated", due_at: "2026-09-15T17:00:00Z" })],
      [],
    );
    expect(items.map((i) => i.id)).toEqual(["dated", "undated"]);
  });

  it("flags an open past task as overdue, and a finished one as not", () => {
    const past = "2020-01-01T00:00:00Z";
    const [open, done] = service.mergeTimeline(
      [task({ task_id: "open", due_at: past, status: "IN_PROGRESS" }),
        task({ task_id: "done", due_at: past, status: "DONE" })],
      [],
    );
    expect(open.is_overdue).toBe(true);
    expect(done.is_overdue).toBe(false);
  });

  it("does not call an undated task overdue", () => {
    const [item] = service.mergeTimeline([task({ due_at: null, status: "TO_DO" })], []);
    expect(item.is_overdue).toBe(false);
  });

  it("tolerates both lists being empty", () => {
    expect(service.mergeTimeline([], [])).toEqual([]);
  });
});
