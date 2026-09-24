/**
 * Owner decision O3: after a call, the caller's summary draft is pinned above
 * the composer of that conversation. Collapsed it says which call is waiting;
 * "Review & send" opens the full editor (the summary, key points, follow-ups,
 * EN/FR, send, discard). `?summary=` (the notification's link) opens it
 * expanded. Nothing is pinned when nothing is waiting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { renderScreen, apiClientMock, authContextMock } from "@/test/screen-harness";
import type { PendingCallSummary } from "@/lib/smartcomm-api";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { PinnedCallSummary } from "./pinned-call-summary";

const draft = (over: Partial<PendingCallSummary> = {}): PendingCallSummary => ({
  call_id: "c1",
  drafted_at: "2026-09-24T13:06:00.000Z",
  started_at: "2026-09-24T13:00:00.000Z",
  ended_at: "2026-09-24T13:10:12.000Z",
  duration_seconds: 612,
  provenance: "groq",
  transcription_state: "CERTIFIED",
  ...over,
});

const summaryView = {
  call_id: "c1",
  group_id: "g1",
  gaps: [{ side: "callee", from_s: 240, to_s: 360, parts: [3] }],
  transcription_state: "TRANSCRIPTION_FAILED",
  transcription_error: null,
  recording_enabled: true,
  is_caller: true,
  summary: {
    summary_id: "s1",
    summary_text: "You agreed the Friday delivery.",
    key_points: [{ text: "Livraison vendredi", raised_by: "callee" }],
    follow_ups: [{ text: "Send the note", owner: "caller", due: null }],
    language: "en",
    provenance: "groq",
    draft_status: "PENDING_REVIEW",
    sent_message_id: null,
    update_available: false,
    update_message_id: null,
    regenerate_count: 0,
  },
};

beforeEach(() => localStorage.setItem("praxis.user", JSON.stringify({ user_id: "u1" })));
afterEach(() => localStorage.removeItem("praxis.user"));

describe("the draft pinned above the composer (O3)", () => {
  it("collapsed: which call, when, how long, and a Review & send that opens it", async () => {
    const onOpenChange = vi.fn();
    const { container } = renderScreen(
      <PinnedCallSummary drafts={[draft()]} openCallId={null} onOpenChange={onOpenChange} onChanged={() => {}} />,
    );
    const region = screen.getByRole("region", { name: "Call summary — Review & send" });
    expect(region.textContent).toMatch(/24 Sept? 2026/);
    expect(region.textContent).toContain("10:12");
    const open = screen.getByRole("button", { name: "Review & send" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(open);
    expect(onOpenChange).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("button", { name: /Send to conversation/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("expanded (the notification's ?summary=): the full editor, the missing minutes, and a way to the record", async () => {
    const { container } = renderScreen(
      <PinnedCallSummary drafts={[draft()]} openCallId="c1" onOpenChange={() => {}} onChanged={() => {}} />,
      { routes: { "/smartcomm/calls/c1/summary": summaryView } },
    );
    expect(await screen.findByDisplayValue("You agreed the Friday delivery.")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Key point 1" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Follow-up 1" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Summary language" })).toBeTruthy();
    expect(screen.getByText(/Not transcribed: 04:00–06:00 on their side/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send to conversation/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Discard$/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the call record" }).getAttribute("href")).toBe("/comms/calls/c1");
    expect(screen.getByRole("button", { name: "Hide" }).getAttribute("aria-expanded")).toBe("true");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("several drafts: the newest is pinned, and the rest are counted with a link to the Calls list", () => {
    renderScreen(
      <PinnedCallSummary drafts={[draft(), draft({ call_id: "c0" }), draft({ call_id: "c-1" })]} openCallId={null} onOpenChange={() => {}} onChanged={() => {}} />,
    );
    expect(screen.getByText(/2 more waiting/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "All calls" }).getAttribute("href")).toBe("/comms/calls");
  });

  it("nothing waiting, nothing pinned", () => {
    const { container } = renderScreen(
      <PinnedCallSummary drafts={[]} openCallId="c1" onOpenChange={() => {}} onChanged={() => {}} />,
    );
    expect(container.querySelector("section")).toBeNull();
  });
});
