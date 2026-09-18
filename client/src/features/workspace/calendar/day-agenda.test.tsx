/**
 * The day agenda — the sheet that made a mobile tap on a busy day stop
 * meaning "create something".
 *
 * What is pinned here, in the order a bad Tuesday would find them:
 *
 *   1. the rows are the tenant's version of the day — an all-day delivery that
 *      starts UTC-late but Douala-early IS that day, not the server's;
 *   2. an existing event opens instead of a new one being offered above it;
 *   3. quick capture lands as an ALL-DAY event on this day and nothing more
 *      (the recorded scope: light, title only, no guessed slot);
 *   4. the sheet is axe-clean.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import { axe } from "jest-axe";

const tenant = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    tenant: (...a: unknown[]) => tenant(...a),
  };
});

import type { CalendarEvent, Deadline } from "../api";
import { DayAgenda } from "./day-agenda";

const TZ = "Africa/Douala";

function eventFixture(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    calendar_event_id: "e1",
    title: "Client fitting",
    event_type: "meeting",
    location: "Lekki showroom",
    description: null,
    // 22:30 UTC on Monday is 23:30 in Douala — the tenant's Tuesday, which is
    // the day this fixture must land on, whatever the server's clock says.
    start_at: "2026-09-14T22:30:00.000Z",
    end_at: "2026-09-14T23:30:00.000Z",
    all_day: false,
    recurrence_rule: null,
    recurrence_series_id: null,
    reminder_minutes: 60,
    remind_at: "2026-09-14T21:30:00.000Z",
    created_by: "u1",
    created_by_name: "Creator",
    entity_type: null,
    entity_id: null,
    scope_id: null,
    link_url: null,
    entity_label: null,
    has_link: false,
    participant_count: 2,
    created_at: "2026-09-10T08:00:00.000Z",
    updated_at: "2026-09-10T08:00:00.000Z",
    ...over,
  };
}

function deadlineFixture(over: Partial<Deadline> = {}): Deadline {
  return {
    kind: "task",
    task_id: "t1",
    subtask_id: null,
    title: "File the TVA return",
    task_title: null,
    at: "2026-09-15T17:00:00.000Z",
    status: "TO_DO",
    priority: "HIGH",
    is_done: false,
    is_overdue: false,
    ...over,
  };
}

function view(over: Partial<Parameters<typeof DayAgenda>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenEvent = vi.fn();
  const onOpenDeadline = vi.fn();
  const onNewEvent = vi.fn();
  const onClose = vi.fn();
  const rendered = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DayAgenda
          day="2026-09-15"
          onClose={onClose}
          events={[eventFixture()]}
          deadlines={[deadlineFixture()]}
          timeZone={TZ}
          onOpenEvent={onOpenEvent}
          onOpenDeadline={onOpenDeadline}
          onNewEvent={onNewEvent}
          {...over}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, onOpenEvent, onOpenDeadline, onNewEvent, onClose };
}

beforeEach(() => {
  tenant.mockReset();
});

describe("DayAgenda — the tenant's day, not the server's", () => {
  it("files a UTC-late event on the tenant-local day it belongs to", () => {
    view();
    // 2026-09-14T22:30Z is 23:30 Douala — rendered among Tuesday 15 September.
    expect(screen.getByText("Client fitting")).toBeTruthy();
    expect(screen.getByText("File the TVA return")).toBeTruthy();
    expect(screen.getByText(/Tuesday 15 September/)).toBeTruthy();
  });

  it("shows a multi-day event on a middle day, exactly as the grid does", () => {
    const multi = eventFixture({
      calendar_event_id: "e2",
      title: "Three-day delivery",
      start_at: "2026-09-13T08:00:00.000Z",
      end_at: "2026-09-17T18:00:00.000Z",
    });
    view({ events: [multi] });
    expect(screen.getByText("Three-day delivery")).toBeTruthy();
  });

  it("opens the existing event rather than offering creation first", () => {
    const { onOpenEvent } = view();
    fireEvent.click(screen.getByText("Client fitting"));
    expect(onOpenEvent).toHaveBeenCalledTimes(1);
    expect(onOpenEvent.mock.calls[0][0].calendar_event_id).toBe("e1");
  });

  it("opens the deadline's task, not an event dialog over it", () => {
    const { onOpenDeadline } = view();
    fireEvent.click(screen.getByText("File the TVA return"));
    expect(onOpenDeadline).toHaveBeenCalledTimes(1);
    expect(onOpenDeadline.mock.calls[0][0].task_id).toBe("t1");
  });

  it("quick capture posts only an all-day event on this day", async () => {
    tenant.mockResolvedValue({});
    view();
    const input = screen.getByLabelText("Quick add — an all-day event");
    fireEvent.change(input, { target: { value: "Site visit, Acadia" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(tenant).toHaveBeenCalledTimes(1));
    const [url, init] = tenant.mock.calls[0];
    expect(url).toBe("/workspace/events");
    const body = init.body as Record<string, unknown>;
    expect(body.title).toBe("Site visit, Acadia");
    expect(body.start_at).toBe("2026-09-15T00:00");
    expect(body.end_at).toBe("2026-09-15T23:59");
    expect(body.all_day).toBe(true);
    // No guessed slot, no location, no clash check triggered: the whole point
    // of quick capture is a title that cannot collide with anything.
    expect(body.location ?? null).toBeNull();
  });

  it("answers an empty day with its two honest options", () => {
    view({ events: [], deadlines: [] });
    expect(screen.getByText("Nothing on this day yet")).toBeTruthy();
    expect(screen.getByLabelText("Quick add — an all-day event")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New event on this day" })).toBeTruthy();
  });

  it("the New-event path is explicitly named and carries the day", () => {
    const { onNewEvent } = view();
    fireEvent.click(screen.getByRole("button", { name: "New event on this day" }));
    expect(onNewEvent).toHaveBeenCalledWith("2026-09-15");
  });

  it("is axe-clean", async () => {
    const { container } = view();
    expect(await axe(container)).toHaveNoViolations();
  });
});
