/**
 * Calendar — the day tap.
 *
 * Before PR 3, a tap on a busy cell opened the write form for a NEW event on
 * that day: on a phone (dots, no chips) that made opening an existing meeting
 * impossible without risking creating over it, and on the desktop the same
 * design was the keyboard trap — a role="button" cell swallowing the chip
 * buttons inside it. Both are the "accidental creation" failure the acceptance
 * criterion names, and this file is the pin:
 *
 *   1. a day tap opens the day's AGENDA, never the create dialog — even when
 *      the day is empty (creation stays one named step away, no exceptions);
 *   2. the grid's day affordance is a single button with the day's census in
 *      its label, not a nested interaction;
 *   3. the filter narrows the visible set client-side, without a request;
 *   4. the grid is axe-clean with events and deadlines in its cells.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

// Identity is not what these tests pin — the participants section reads it to
// decide which controls the organiser sees, and the dialog mounts the section
// the moment an event opens. A real AuthProvider would pull in the login
// bootstrap; the hook is the honest seam.
vi.mock("@/app/auth/auth-context", async () => {
  const actual = await vi.importActual<typeof import("@/app/auth/auth-context")>(
    "@/app/auth/auth-context",
  );
  return {
    ...actual,
    useAuth: () => ({
      user: { user_id: "viewer-1", full_name: "Viewer One" },
      status: "authed",
    }),
  };
});

import type { CalendarEvent, Deadline } from "../api";
import { CalendarPage } from "./calendar-page";

const TZ = "Africa/Douala";

function eventFixture(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    calendar_event_id: "e1",
    title: "Client fitting",
    event_type: "meeting",
    location: "Lekki showroom",
    description: null,
    start_at: "2026-09-15T13:00:00.000Z", // 14:00 Douala, Tuesday the 15th
    end_at: "2026-09-15T14:00:00.000Z",
    all_day: false,
    recurrence_rule: null,
    recurrence_series_id: null,
    reminder_minutes: 60,
    remind_at: "2026-09-15T12:00:00.000Z",
    created_by: "someone-else", // so the dialog stays read-only-safe if opened
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

/**
 * The workspace's own contract: `/workspace/context` answers the tenant
 * clock, the two reads answer the window. Any other URL is a failure loud
 * enough to read in the output.
 */
function answerWorkspace() {
  tenant.mockImplementation((url: string, opts?: { method?: string }) => {
    if (url.startsWith("/workspace/context")) return Promise.resolve({ timeZone: TZ });
    if (url.startsWith("/workspace/events") && !opts?.method) {
      return Promise.resolve([eventFixture()]);
    }
    if (url.startsWith("/workspace/deadlines")) {
      return Promise.resolve({ items: [deadlineFixture()], audience: "mine", audiences: ["mine"] });
    }
    return Promise.resolve({});
  });
}

function view() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/workspace/calendar?date=2026-09-15"]}>
          <CalendarPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  tenant.mockReset();
  answerWorkspace();
});

describe("Calendar — the day tap is an agenda, never an accident", () => {
  it("opens the day's agenda for a busy cell", async () => {
    view();
    // The grid cell for the 15th — the day-number button with the census.
    const day = await screen.findByRole(
      "button",
      { name: /15 September 2026 — 1 event, 1 deadline/ },
      { timeout: 4000 },
    );
    fireEvent.click(day);
    // The agenda opened: its title IS the day, and the row names the meeting.
    await screen.findByRole("button", { name: "New event on this day" }, { timeout: 4000 });
    // What must NOT have happened: the write form.
    expect(screen.queryByRole("button", { name: "Add event" })).toBeNull();
  });

  it("opens the agenda even for an empty day — creation stays exactly one step away", async () => {
    view();
    const day = await screen.findByRole(
      "button",
      { name: /16 September 2026 — 0 events/ },
      { timeout: 4000 },
    );
    fireEvent.click(day);
    await screen.findByText("Nothing on this day yet", undefined, { timeout: 4000 });
    expect(screen.queryByRole("button", { name: "Add event" })).toBeNull();
    // …and the one named step is right there.
    expect(screen.getByRole("button", { name: "New event on this day" })).toBeTruthy();
  });

  it("opens the event itself from the agenda, not a second new-event dialog", async () => {
    view();
    const day = await screen.findByRole(
      "button",
      { name: /15 September 2026 — 1 event, 1 deadline/ },
      { timeout: 4000 },
    );
    fireEvent.click(day);
    const row = await screen.findByRole("button", { name: /Client fitting/ }, { timeout: 4000 });
    fireEvent.click(row);
    // The event dialog, in edit mode for THAT row.
    await screen.findByDisplayValue("Client fitting", undefined, { timeout: 4000 });
  });

  it("filters the visible set in the client, with no request", async () => {
    tenant.mockClear();
    view();
    await screen.findByRole("button", { name: /15 September 2026 — 1 event, 1 deadline/ }, { timeout: 4000 });
    const baseLine = tenant.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Filter by title, notes, file or client"), {
      target: { value: "TVA" },
    });
    await waitFor(() => {
      expect(screen.getByText(/1 event, 1 deadline match|0 events, 1 deadline match/)).toBeTruthy();
    });
    expect(tenant.mock.calls.length).toBe(baseLine);
  });

  it("finds a deadline by the file's client, the notes or a stage — not only its title", async () => {
    tenant.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url.startsWith("/workspace/context")) return Promise.resolve({ timeZone: TZ });
      if (url.startsWith("/workspace/events") && !opts?.method) {
        return Promise.resolve([eventFixture({ description: "Bring the signed BL" })]);
      }
      if (url.startsWith("/workspace/deadlines")) {
        return Promise.resolve({
          items: [
            deadlineFixture({
              description: "Call the carrier before the scanner slot",
              dossier_ref: "SL3213P44RG55ZSM",
              dossier_client_name: "Brasseries du Cameroun",
              milestone_labels: ["Pré-alerte et ordre de travail", "Déclaration en douane déposée"],
            }),
          ],
          audience: "mine",
          audiences: ["mine"],
        });
      }
      return Promise.resolve({});
    });
    view();
    await screen.findByRole("button", { name: /15 September 2026 — 1 event, 1 deadline/ }, { timeout: 4000 });
    const box = screen.getByLabelText("Filter by title, notes, file or client");
    const expectMatch = async (needle: string, text: RegExp) => {
      fireEvent.change(box, { target: { value: needle } });
      await waitFor(() => expect(screen.getByText(text)).toBeTruthy());
    };
    // The client's name, the file reference, the notes and a stage each find
    // the deadline; the event's notes find the event.
    await expectMatch("brasseries", /0 events, 1 deadline match/);
    await expectMatch("SL3213", /0 events, 1 deadline match/);
    await expectMatch("scanner", /0 events, 1 deadline match/);
    await expectMatch("douane", /0 events, 1 deadline match/);
    await expectMatch("signed bl", /1 event, 0 deadlines match/);
    await expectMatch("nothing-like-this", /0 events, 0 deadlines match/);
  });

  it("is axe-clean with a busy month on screen", async () => {
    const { container } = view();
    await screen.findByRole("button", { name: /15 September 2026 — 1 event, 1 deadline/ }, { timeout: 4000 });
    expect(await axe(container)).toHaveNoViolations();
  });
});
