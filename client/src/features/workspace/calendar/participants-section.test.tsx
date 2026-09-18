/**
 * The guest list — who is told what, and who is offered which control.
 *
 * Authorisation is the server's (`canManageEvent`, self-only responses), and
 * these tests pin the client to its recorded part: narrows, never decides.
 * The organiser sees invite controls; the invitee sees only their own answer
 * buttons; an outsider sees a list. The response display, the external name,
 * and the "organiser" marker are all pinned, because a control that lies —
 * one that offers an action the server will refuse — is the failure the
 * gap review actually found.
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

const ME = "viewer-1";
vi.mock("@/app/auth/auth-context", async () => {
  const actual = await vi.importActual<typeof import("@/app/auth/auth-context")>(
    "@/app/auth/auth-context",
  );
  return {
    ...actual,
    useAuth: () => ({ user: { user_id: ME, full_name: "Viewer One" }, status: "authed" }),
  };
});

import type { CalendarEvent, Participant } from "../api";
import { ParticipantsSection } from "./participants-section";

function participant(over: Partial<Participant> = {}): Participant {
  return {
    calendar_participant_id: "p1",
    calendar_event_id: "e1",
    user_id: "u-guest",
    user_name: "Amara Guest",
    email: null,
    external_name: null,
    response_status: "INVITED",
    responded_at: null,
    is_organiser: false,
    ...over,
  };
}

function eventFixture(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    calendar_event_id: "e1",
    title: "Client fitting",
    event_type: "meeting",
    location: "Lekki showroom",
    description: null,
    start_at: "2026-09-15T13:00:00.000Z",
    end_at: "2026-09-15T14:00:00.000Z",
    all_day: false,
    recurrence_rule: null,
    recurrence_series_id: null,
    reminder_minutes: null,
    remind_at: null,
    created_by: ME,
    created_by_name: "Viewer One",
    entity_type: null,
    entity_id: null,
    scope_id: null,
    link_url: null,
    entity_label: null,
    has_link: false,
    participant_count: 3,
    created_at: "2026-09-10T08:00:00.000Z",
    updated_at: "2026-09-10T08:00:00.000Z",
    participants: [
      participant({ calendar_participant_id: "p-org", user_id: ME, user_name: "Viewer One", is_organiser: true, response_status: "ACCEPTED" }),
      participant(),
      participant({ calendar_participant_id: "p-ext", user_id: null, user_name: null, external_name: "Mme Biya", response_status: "INVITED" }),
    ],
    ...over,
  };
}

function view(event = eventFixture()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ParticipantsSection event={event} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => tenant.mockReset());

describe("ParticipantsSection — the organiser's reading", () => {
  it("shows the list with organiser, internal guest and outside name, each labelled", () => {
    view();
    expect(screen.getByText(/Amara Guest/)).toBeTruthy();
    expect(screen.getByText(/Mme Biya/)).toBeTruthy();
    expect(screen.getByText("(outside the company)")).toBeTruthy();
    expect(screen.getByText(/View/)).toBeTruthy();
    expect(screen.getByText(/organiser/)).toBeTruthy();
  });

  it("gives the organiser the invite controls", () => {
    view();
    expect(screen.getByLabelText(/Invite/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/outside the company/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Amara Guest" })).toBeTruthy();
  });

  it("posts an external name the way the guide's narrow scope says: a name, nothing else", async () => {
    tenant.mockResolvedValue({});
    view();
    const input = screen.getByPlaceholderText(/outside the company/);
    fireEvent.change(input, { target: { value: "Driver — Musa" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(
        tenant.mock.calls.some(([url, init]) => url === "/workspace/events/e1/participants" && init?.method === "POST"),
      ).toBe(true);
    });
    // The picker's own /employees read rides the same mock — it is why the
    // assertion names the write rather than "the first call".
    const [, init] = tenant.mock.calls.find(([url]) => url === "/workspace/events/e1/participants")!;
    expect(init.method).toBe("POST");
    expect(init.body).toEqual({ external_name: "Driver — Musa" });
  });

  it("an organiser is not offered their own answer buttons", () => {
    view();
    // The organiser row carries no Accept/Decline — the organiser IS the
    // event's answer; click yes to your own party would file a response
    // about a decision nobody made.
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("is axe-clean", async () => {
    const { container } = view();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ParticipantsSection — the invitee's reading", () => {
  const asInvitee = () =>
    eventFixture({
      created_by: "u-boss",
      participants: [
        participant({ calendar_participant_id: "p-org", user_id: "u-boss", user_name: "The Boss", is_organiser: true }),
        participant({ calendar_participant_id: "p-me", user_id: ME, user_name: "Viewer One", response_status: "INVITED" }),
      ],
    });

  it("sees answer buttons on themself and nobody else", () => {
    view(asInvitee());
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
    // …and not the organiser's controls. A refusal from the server is the
    // backstop, not the promise the UI makes.
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.queryByPlaceholderText(/outside the company/)).toBeNull();
  });

  it("posts the response as themselves", async () => {
    tenant.mockResolvedValue({});
    view(asInvitee());
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(tenant).toHaveBeenCalledTimes(1));
    const [url, init] = tenant.mock.calls[0];
    expect(url).toBe("/workspace/events/e1/participants/p-me/response");
    expect(init.body).toEqual({ status: "ACCEPTED" });
  });
});
