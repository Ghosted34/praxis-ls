/**
 * My Workspace — the API layer's ONE job that has broken before: unwrapping.
 *
 * `tenant()` (→ `api()` in lib/api-client.ts) already returns the UNWRAPPED
 * `data` payload. A previous version of this file typed every call as
 * `tenant<{ data: X }>(...)` and then did `.then((r) => r.data)` — unwrapping a
 * SECOND time, which returns `undefined`. React Query surfaces that as
 * "… data is undefined", and it is exactly why the Today and Calendar screens
 * failed to load. These tests pin the contract so that regression cannot come
 * back silently: what `tenant()` resolves is what the reader returns.
 *
 * The one exception is the board, whose payload is an object carrying
 * `{ board, audience, audiences }` — asserted here too so the shape the page
 * reads (`q.data.board`) stays wired to the server's nesting.
 */
import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

import { tenant } from "@/lib/api-client";
import * as api from "./api";

vi.mock("@/lib/api-client", () => ({ tenant: vi.fn() }));

const mockTenant = tenant as unknown as Mock;

beforeEach(() => {
  mockTenant.mockReset();
});

describe("workspace api — reads return the unwrapped payload, not undefined", () => {
  it("getDay returns the DayTimeline as-is (no second unwrap)", async () => {
    const day = { items: [], audience: "mine", audiences: ["mine"], tasks: 0, events: 0 };
    mockTenant.mockResolvedValue(day);

    const out = await api.getDay();

    expect(out).toBe(day);
    expect(out).not.toBeUndefined();
    expect(mockTenant).toHaveBeenCalledWith("/workspace/day");
  });

  it("listEvents returns the array the server sent", async () => {
    const events = [{ calendar_event_id: "e1" }];
    mockTenant.mockResolvedValue(events);

    const out = await api.listEvents({ from: "2026-08-01", to: "2026-10-31" });

    expect(out).toBe(events);
    expect(mockTenant).toHaveBeenCalledWith(
      "/workspace/events?from=2026-08-01&to=2026-10-31",
    );
  });

  it("listTasks returns the array the server sent", async () => {
    const tasks = [{ task_id: "t1" }];
    mockTenant.mockResolvedValue(tasks);

    const out = await api.listTasks({ status: "TO_DO" });

    expect(out).toBe(tasks);
    expect(mockTenant).toHaveBeenCalledWith("/workspace/tasks?status=TO_DO");
  });

  it("getTask / getEvent return the single record, not undefined", async () => {
    const task = { task_id: "t1" };
    mockTenant.mockResolvedValue(task);
    expect(await api.getTask("t1")).toBe(task);

    const event = { calendar_event_id: "e1" };
    mockTenant.mockResolvedValue(event);
    expect(await api.getEvent("e1")).toBe(event);
  });

  it("getBoard keeps the audience metadata that rides beside the columns", async () => {
    const payload = {
      board: { TO_DO: [], IN_PROGRESS: [], IN_REVIEW: [], DONE: [] },
      audience: "team",
      audiences: ["mine", "team"],
    };
    mockTenant.mockResolvedValue(payload);

    const out = await api.getBoard({ audience: "team" });

    // The page reads `q.data.board` / `.audience` / `.audiences` — all must survive.
    expect(out.board).toBe(payload.board);
    expect(out.audience).toBe("team");
    expect(out.audiences).toEqual(["mine", "team"]);
  });
});

describe("workspace api — writes return the created/updated record", () => {
  it("createTask returns the task, not undefined", async () => {
    const task = { task_id: "t9", title: "New" };
    mockTenant.mockResolvedValue(task);

    const out = await api.createTask({ title: "New" });

    expect(out).toBe(task);
    expect(mockTenant).toHaveBeenCalledWith("/workspace/tasks", {
      method: "POST",
      body: { title: "New" },
    });
  });

  it("createEvent returns the event, not undefined", async () => {
    const event = { calendar_event_id: "e9", title: "Kickoff" };
    mockTenant.mockResolvedValue(event);

    const out = await api.createEvent({
      title: "Kickoff",
      start_at: "2026-09-16T10:00",
      end_at: "2026-09-16T11:00",
    });

    expect(out).toBe(event);
  });
});
