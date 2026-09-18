import { describe, expect, it } from "vitest";
import type { CalendarEvent, Deadline } from "../api";
import { indexDeadlinesByDay, indexEventsByDay } from "./dates";

describe("Calendar tenant-day indexing", () => {
  const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
    calendar_event_id: "e1",
    title: "Night handover",
    event_type: "meeting",
    location: null,
    description: null,
    start_at: "2026-09-18T22:30:00.000Z",
    end_at: "2026-09-19T00:30:00.000Z",
    all_day: false,
    recurrence_rule: null,
    reminder_minutes: null,
    remind_at: null,
    created_by: "u1",
    created_by_name: "A User",
    entity_type: null,
    entity_id: null,
    scope_id: null,
    link_url: null,
    entity_label: null,
    has_link: false,
    participant_count: 0,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...over,
  });

  it("files a spanning event by the tenant day, not the browser day", () => {
    const byDay = indexEventsByDay([event()], "Africa/Douala");
    expect([...byDay.keys()]).toEqual(["2026-09-18", "2026-09-19"]);
    expect(
      indexEventsByDay([event()], "America/New_York").has("2026-09-18"),
    ).toBe(true);
  });

  it("files deadline instants by the same tenant clock", () => {
    const deadline = {
      kind: "task",
      task_id: "t1",
      subtask_id: null,
      title: "Close the advance",
      task_title: null,
      at: "2026-09-18T22:30:00.000Z",
      status: "IN_PROGRESS",
      priority: "HIGH",
      is_done: false,
      is_overdue: false,
    } as Deadline;
    expect(
      indexDeadlinesByDay([deadline], "Asia/Tokyo").has("2026-09-19"),
    ).toBe(true);
  });
});
