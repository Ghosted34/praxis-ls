/**
 * Comms → Calls and a call's own page (calls audit A6, E14): the summary a
 * notification points at can be opened, a draft the sweep made is findable by
 * its badge, a call with no recording says so, and the destructive action asks
 * first. Rendered through the shared screen harness with fixture API answers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { renderScreen, apiClientMock, authContextMock } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { CallsListPage } from "./calls-list";
import { CallRecordPage } from "./call-record";

const ME = "11111111-1111-1111-1111-111111111111";
const THEM = "22222222-2222-2222-2222-222222222222";

const row = (over: Record<string, unknown>) => ({
  call_id: "c1", group_id: "g1", caller_id: ME, callee_id: THEM,
  caller_name: "Awa Diallo", callee_name: "Bruno Kamga",
  status: "ENDED", end_reason: "hangup",
  started_at: "2026-09-24T13:00:00.000Z", ended_at: "2026-09-24T13:05:12.000Z",
  duration_seconds: 312, transcription_state: "CERTIFIED",
  draft_status: null, notified_at: null, summary_update_available: false,
  ...over,
});

const summaryView = (over: Record<string, unknown> = {}) => ({
  call_id: "c1",
  transcription_state: "CERTIFIED",
  transcription_reason: null,
  recording_enabled: true,
  is_caller: true,
  summary: {
    summary_id: "s1",
    summary_text: "You confirmed the delivery for Friday.",
    key_points: [{ text: "Livraison confirmée", raised_by: "callee" }],
    follow_ups: [{ text: "Send the delivery note", owner: "caller", due: "2026-09-30" }],
    language: "en",
    provenance: "gemini",
    draft_status: "PENDING_REVIEW",
    sent_message_id: null,
    update_available: false,
    update_message_id: null,
    regenerate_count: 0,
    ...over,
  },
});

beforeEach(() => {
  localStorage.setItem("praxis.user", JSON.stringify({ user_id: ME }));
});
afterEach(() => {
  localStorage.removeItem("praxis.user");
});

describe("the Calls list", () => {
  it("lists calls with who, a day-first time, the duration, and what is waiting", async () => {
    const { container } = renderScreen(<CallsListPage />, {
      routes: {
        "/smartcomm/calls": [
          row({ call_id: "c1", draft_status: "PENDING_REVIEW" }),
          row({ call_id: "c2", caller_id: THEM, callee_id: ME, status: "NO_ANSWER", end_reason: "no_answer", duration_seconds: 0, transcription_state: "NO_RECORDING" }),
          row({ call_id: "c3", transcription_state: "TRANSCRIPTION_FAILED" }),
        ],
      },
    });
    // Each row can render in more than one layout, hence getAll.
    expect((await screen.findAllByText("Summary to review")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bruno Kamga").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Awa Diallo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Transcript failed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5:12").length).toBeGreaterThan(0);
    // Day first ("24 Sep 2026", or "24 Sept 2026" on newer ICU), never "Sep 24".
    expect(screen.getAllByText(/^24 Sept? 2026/).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("says what to do when there are no calls", async () => {
    renderScreen(<CallsListPage />, { routes: { "/smartcomm/calls": [] } });
    expect(await screen.findByText("No calls yet")).toBeTruthy();
  });
});

describe("a call's page", () => {
  const at = { path: "/comms/calls/c1", pattern: "/comms/calls/:callId" };

  it("opens the caller's draft inline, labelled with where its words came from", async () => {
    const { container } = renderScreen(<CallRecordPage />, {
      ...at,
      routes: {
        "/smartcomm/calls/c1/summary": summaryView(),
        "/smartcomm/calls/c1": row({ recording_enabled: true }),
      },
    });
    expect(await screen.findByRole("heading", { name: "Call with Bruno Kamga" })).toBeTruthy();
    expect(await screen.findByDisplayValue("You confirmed the delivery for Friday.")).toBeTruthy();
    expect(screen.getByText("Transcribed from the call recording")).toBeTruthy();
    // Day-first, not the ISO the API sends, and editable (O3).
    expect(screen.getByDisplayValue("30/09/2026")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Key point 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove follow-up 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send to conversation/ })).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("asks before discarding, and discards nothing when the answer is no", async () => {
    renderScreen(<CallRecordPage />, {
      ...at,
      routes: {
        "/smartcomm/calls/c1/summary/discard": { call_id: "c1", draft_status: "DISCARDED" },
        "/smartcomm/calls/c1/summary": summaryView(),
        "/smartcomm/calls/c1": row({ recording_enabled: true }),
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Discard$/ }));
    expect(await screen.findByText("Discard this summary?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByText("Discard this summary?")).toBeNull());
    expect(screen.getByDisplayValue("You confirmed the delivery for Friday.")).toBeTruthy();
  });

  it("the callee reads that the caller sends it, and gets no editor", async () => {
    renderScreen(<CallRecordPage />, {
      ...at,
      routes: {
        "/smartcomm/calls/c1/summary": summaryView(),
        "/smartcomm/calls/c1": row({ caller_id: THEM, callee_id: ME, recording_enabled: true }),
      },
    });
    expect(await screen.findByRole("heading", { name: "Call with Awa Diallo" })).toBeTruthy();
    expect(screen.getByText(/The caller reviews and sends the summary/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send to conversation/ })).toBeNull();
  });

  it("an old call now marked NO_RECORDING still opens the draft it has", async () => {
    renderScreen(<CallRecordPage />, {
      ...at,
      routes: {
        "/smartcomm/calls/c1/summary": summaryView({ provenance: "browser-live" }),
        "/smartcomm/calls/c1": row({ transcription_state: "NO_RECORDING", draft_status: "PENDING_REVIEW", recording_enabled: true }),
      },
    });
    expect(await screen.findByDisplayValue("You confirmed the delivery for Friday.")).toBeTruthy();
    expect(screen.getByText("Generated from the in-call browser capture (unverified)")).toBeTruthy();
    expect(screen.queryByText("This call was not recorded, so there is no summary.")).toBeNull();
  });

  it("a failed call with no draft says so, and no longer promises a daily retry (O1)", async () => {
    renderScreen(<CallRecordPage />, {
      ...at,
      routes: { "/smartcomm/calls/c1": row({ transcription_state: "TRANSCRIPTION_FAILED", draft_status: null, recording_enabled: true }) },
    });
    expect(await screen.findByText("The transcript could not be produced, so there is no summary.")).toBeTruthy();
    expect(screen.queryByText(/retried once a day/)).toBeNull();
    expect(screen.queryByText("Transcribing the call…")).toBeNull();
  });

  it("links back to the conversation, with the caller's pending draft opened there (O3)", async () => {
    renderScreen(<CallRecordPage />, {
      ...at,
      routes: {
        "/smartcomm/calls/c1/summary": summaryView(),
        "/smartcomm/calls/c1": row({ recording_enabled: true, draft_status: "PENDING_REVIEW" }),
      },
    });
    const link = await screen.findByRole("link", { name: "Open the conversation" });
    expect(link.getAttribute("href")).toBe("/comms?channel=g1&summary=c1");
  });

  it("names the minutes with no transcript, and offers an administrator the re-run of a failed part", async () => {
    renderScreen(<CallRecordPage />, {
      ...at,
      routes: {
        "/smartcomm/calls/c1/transcript": {
          call_id: "c1", state: "TRANSCRIPTION_FAILED", reason: null, certified: true, provenance: "groq",
          text: "Caller:\n[en] hello", parts: [],
          sides: [
            { side: "caller", label: "Caller", name: "Awa Diallo", provider: "groq", certified: true, text: "[en] hello",
              parts: [{ part_index: 1, text: "hello", language: "en", provider: "groq", certified: true }] },
            { side: "callee", label: "Callee", name: null, provider: null, certified: false, text: null, parts: [] },
          ],
          recording: [
            { side: "caller", part_index: 1, status: "OK", duration_seconds: 120, provider: "groq", purged: false },
            { side: "caller", part_index: 2, status: "FAILED", duration_seconds: 120, provider: null, purged: false },
          ],
          gaps: [{ side: "caller", from_s: 120, to_s: 240, parts: [2] }],
        },
        "/smartcomm/calls/c1/summary": summaryView({ transcription_state: "TRANSCRIPTION_FAILED" }),
        "/smartcomm/calls/c1": row({ recording_enabled: true, transcription_state: "TRANSCRIPTION_FAILED", draft_status: "PENDING_REVIEW" }),
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Show transcript" }));
    expect(await screen.findByText("Some minutes of this call could not be transcribed:")).toBeTruthy();
    expect(screen.getByText(/Caller · 02:00–04:00/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Re-run part 2" })).toBeTruthy();
  });

  it("a call with no recording says so, and offers no transcript", async () => {
    renderScreen(<CallRecordPage />, {
      ...at,
      routes: { "/smartcomm/calls/c1": row({ transcription_state: "NO_RECORDING", recording_enabled: true }) },
    });
    expect(await screen.findByText("This call was not recorded, so there is no summary.")).toBeTruthy();
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Show transcript" })).toBeNull();
  });

  it("a call answered without recording says that, not just 'not recorded' (PR-6, F7)", async () => {
    renderScreen(<CallRecordPage />, {
      ...at,
      routes: {
        "/smartcomm/calls/c1": row({
          transcription_state: "NO_RECORDING", recording_enabled: false, recording_declined_at: "2026-09-25T08:00:00Z",
        }),
      },
    });
    expect(await screen.findByText("This call was answered without recording, so there is no summary.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show transcript" })).toBeNull();
  });
});
