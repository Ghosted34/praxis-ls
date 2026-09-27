/**
 * The call inside its own conversation (calls audit PR-6; O4): the ring banner
 * replaces the card there, so there is one Answer button, and it becomes the
 * live strip once answered. CommsLive then shows no card and no bar for it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const S = vi.hoisted(() => ({
  state: {
    phase: "incoming", call: { call_id: "c1", group_id: "g1", caller_id: "them", callee_id: "me" },
    peerName: "Aïcha", ringSecondsLeft: 50, elapsedS: 0, muted: false, warning: false,
    recordingEnabled: true, recordingLost: 0, endedReason: null, lastError: null, summaryNotice: null,
    noise: { enabled: false, status: "off", reason: null }, quality: { state: "good" }, recovering: false,
    audioBlocked: false, redial: null, elsewhere: null, callsAvailable: true,
  } as Record<string, unknown>,
  answer: vi.fn(async (_o?: unknown) => {}), decline: vi.fn(async () => {}), hangup: vi.fn(async () => {}), setMuted: vi.fn(),
}));

vi.mock("./call-session", () => ({
  useCall: () => S.state,
  answer: (o?: unknown) => S.answer(o),
  decline: () => S.decline(),
  hangup: () => S.hangup(),
  setMuted: (m: boolean) => S.setMuted(m),
  wireCallSocket: () => {},
  myUserId: () => "me",
  clearSummaryNotice: () => {},
  initCallDeepLink: () => {},
  redial: async () => {},
  dismissRedial: () => {},
  resumeAudio: async () => {},
  clearElsewhere: () => {},
  setNoise: async () => {},
}));
vi.mock("@/lib/smartcomm-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/smartcomm-api")>()),
  fetchCallCapabilities: async () => ({ calls: true, can_dial: true, recording: true, settings_admin: false }),
  fetchCallProcessing: async () => ({ recording_enabled: true, transcription: [], summary: [], network: [] }),
}));
vi.mock("@/app/auth/auth-context", () => ({ useAuth: () => ({ status: "authed", user: { id: "me" } }) }));
vi.mock("@/lib/comms-socket", () => ({
  getCommsSocket: () => ({ connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
  disconnectCommsSocket: () => {},
}));
vi.mock("./call-ring-prompt", () => ({ CallRingPrompt: () => null }));

import { ThreadCallStrip } from "./thread-call-strip";
import { CommsLive } from "../comms-live";
import { ToastProvider } from "@/components/ui/toast";
import { setCallView } from "./call-view";

beforeEach(() => {
  S.state.phase = "incoming";
  S.answer.mockClear();
  setCallView("auto");
});

describe("the thread strip", () => {
  it("rings in its own conversation, with the recording choice", async () => {
    render(<ThreadCallStrip groupId="g1" />);
    expect(screen.getByText(/is calling/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Answer without recording" }));
    expect(S.answer).toHaveBeenCalledWith({ record: false });
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(S.answer).toHaveBeenLastCalledWith(undefined);
  });

  it("shows nothing in another conversation", () => {
    const { container } = render(<ThreadCallStrip groupId="other" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("becomes the live strip once answered", async () => {
    S.state.phase = "in_call";
    S.state.elapsedS = 75;
    render(<ThreadCallStrip groupId="g1" />);
    expect(screen.getByText("1:15")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(S.hangup).toHaveBeenCalled();
  });
});

const live = (path: string) => render(
  <ToastProvider><MemoryRouter initialEntries={[path]}><CommsLive /></MemoryRouter></ToastProvider>,
);

describe("CommsLive places the call once (O4)", () => {
  it("a ring shows the card on any other screen", () => {
    live("/finance/invoices");
    expect(document.querySelector("[data-call-surface='ring']")).not.toBeNull();
  });

  it("in the caller's conversation the card steps aside for the thread banner", () => {
    live("/comms?channel=g1");
    expect(document.querySelector("[data-call-surface='ring']")).toBeNull();
  });

  it("an active call opens full, minimises to the docked bar, and expands again", async () => {
    S.state.phase = "in_call";
    live("/wms");
    expect(document.querySelector("[data-call-surface='screen']")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Minimise call" }));
    expect(document.querySelector("[data-call-surface='screen']")).toBeNull();
    expect(document.querySelector("[data-call-surface='bar']")).not.toBeNull();
    await userEvent.click(screen.getAllByRole("button", { name: "Open the call" })[0]);
    expect(document.querySelector("[data-call-surface='screen']")).not.toBeNull();
  });

  it("in the call's conversation a live call is the strip alone; Open the call shows the screen and the strip steps aside", async () => {
    S.state.phase = "in_call";
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={["/comms?channel=g1"]}>
          <ThreadCallStrip groupId="g1" />
          <CommsLive />
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(document.querySelector("[data-call-surface='thread-live']")).not.toBeNull();
    expect(document.querySelector("[data-call-surface='screen']")).toBeNull();
    expect(document.querySelector("[data-call-surface='bar']")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open the call" }));
    expect(document.querySelector("[data-call-surface='screen']")).not.toBeNull();
    expect(document.querySelector("[data-call-surface='thread-live']")).toBeNull();
    expect(screen.getAllByRole("button", { name: "End call" })).toHaveLength(1);
    // Minimised again: back to the strip, and no docked bar in the thread.
    await userEvent.click(screen.getByRole("button", { name: "Minimise call" }));
    expect(document.querySelector("[data-call-surface='thread-live']")).not.toBeNull();
    expect(document.querySelector("[data-call-surface='bar']")).toBeNull();
  });
});
