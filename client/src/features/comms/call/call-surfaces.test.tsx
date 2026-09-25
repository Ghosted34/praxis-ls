/**
 * The call screens (calls audit PR-6; O4, F1–F6, F9, G2, G5).
 *
 * Solid surfaces that never block the app on a desktop, token colours, banners
 * in the flow, a static timer name, the recording notice and its processors on
 * the ring, Answer without recording, and a docked bar with its own controls.
 * Each screen is also run through axe.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { IncomingRing } from "./incoming-ring";
import { CallOverlay } from "./call-overlay";
import { ActiveCallBar } from "./active-call-bar";
import { processorsSentence } from "./call-capabilities";

const PROCESSING = {
  recording_enabled: true,
  transcription: [
    { vendor: "groq", role: "first", name: "Groq", country: "United States" },
    { vendor: "gemini", role: "when_first_fails", name: "Google (Gemini)", country: "United States" },
  ],
  summary: [
    { vendor: "gemini", role: "first", name: "Google (Gemini)", country: "United States" },
    { vendor: "deepseek", role: "last_resort", name: "DeepSeek", country: "China" },
  ],
  network: [],
  relay_configured: true,
};

/** No glass (F1): no blur, no translucent grounds. */
function expectSolid(el: HTMLElement) {
  const html = el.outerHTML;
  expect(html).not.toMatch(/backdrop-blur|backdrop-filter/);
  expect(html).not.toMatch(/bg-\[rgb\(var\(--background\)\/0\.9\d\)\]|bg-card\/\d|bg-background\/\d/);
  expect(html).not.toMatch(/brand-blue|text-white/);
}

describe("the incoming call card", () => {
  const ring = (over = {}) => {
    const h = { onAccept: vi.fn(), onAcceptWithoutRecording: vi.fn(), onDecline: vi.fn() };
    const view = render(<IncomingRing name="Aïcha Ndongo" secondsLeft={48} recordingEnabled processing={PROCESSING} {...h} {...over} />);
    return { ...h, view };
  };

  it("is a solid card at the top right on a desktop, never a layer over the app", () => {
    const { view } = ring();
    const card = view.container.querySelector("[data-call-surface='ring']") as HTMLElement;
    expect(card.className).toMatch(/md:right-4/);
    expect(card.className).toMatch(/md:w-\[380px\]/);
    expect(card.className).not.toMatch(/(^|\s)inset-0(\s|$)/);
    expect(card.getAttribute("aria-modal")).toBe("false");
    expectSolid(card);
  });

  it("names the caller, how long it has rung, and that the call will be recorded, by whom (F6, G2)", () => {
    ring();
    expect(screen.getByRole("heading", { name: "Aïcha Ndongo" })).toBeInTheDocument();
    expect(screen.getByText(/ringing 0:12/)).toBeInTheDocument();
    expect(screen.getByText(/will be recorded and summarised/)).toBeInTheDocument();
    expect(screen.getByText(/Audio: Groq, or Google \(Gemini\) if Groq fails\./)).toBeInTheDocument();
    expect(screen.getByText(/Summary: Google \(Gemini\), or DeepSeek as a last resort\./)).toBeInTheDocument();
  });

  it("offers Answer without recording when the call would be recorded (G5)", async () => {
    const h = ring();
    await userEvent.click(screen.getByRole("button", { name: "Answer without recording" }));
    expect(h.onAcceptWithoutRecording).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Answer" }));
    expect(h.onAccept).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(h.onDecline).toHaveBeenCalled();
  });

  it("says nothing about recording, and offers no such choice, when nothing is recorded", () => {
    ring({ recordingEnabled: false });
    expect(screen.queryByText(/recorded/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Answer without recording" })).not.toBeInTheDocument();
  });

  it("uses the destructive and ok token pairs, with no pulsing (F2, F9)", () => {
    const { view } = ring();
    expect(screen.getByRole("button", { name: "Decline" }).className).toMatch(/bg-destructive/);
    expect(screen.getByRole("button", { name: "Answer" }).className).toMatch(/bg-ok/);
    expect(view.container.innerHTML).not.toMatch(/animate-pulse/);
  });

  it("an empty name never reads 'Incoming call from '", () => {
    ring({ name: null });
    expect(screen.getByRole("heading", { name: "Someone" })).toBeInTheDocument();
  });

  it("opens to a full solid screen on a phone", async () => {
    const { view } = ring();
    await userEvent.click(screen.getByRole("button", { name: "Full screen" }));
    const card = view.container.querySelector("[data-call-surface='ring']") as HTMLElement;
    expect(card.className).toMatch(/(^|\s)inset-0(\s|$)/);
    expect(card.getAttribute("aria-modal")).toBe("true");
  });

  it("passes axe", async () => {
    const { view } = ring();
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe("the call screen", () => {
  const screenFor = (over = {}) => {
    const h = { onHangup: vi.fn(), onMute: vi.fn(), onMinimise: vi.fn(), onToggleNoise: vi.fn() };
    const view = render(
      <CallOverlay
        name="Bruno" phase="in_call" elapsedS={1745} warning muted={false}
        recordingEnabled processors="Audio: Groq." recordingLost={1}
        quality={{ state: "fair", rttMs: 200, jitterMs: 30, lossPct: 2 }}
        noise={{ enabled: true, status: "unavailable", reason: "wasm_load_failed" }}
        {...h} {...over}
      />,
    );
    return { ...h, view };
  };

  it("is a card at the bottom right on a desktop and solid everywhere (F1, F4)", () => {
    const { view } = screenFor();
    const s = view.container.querySelector("[data-call-surface='screen']") as HTMLElement;
    expect(s.className).toMatch(/md:bottom-4/);
    expect(s.className).toMatch(/md:w-\[380px\]/);
    expectSolid(s);
  });

  it("keeps every banner in the flow, none absolutely placed (F3)", () => {
    const { view } = screenFor();
    expect(view.container.innerHTML).not.toMatch(/absolute top-/);
    expect(screen.getByText("1 minute left")).toBeInTheDocument();
    expect(screen.getByText(/could not be uploaded/)).toBeInTheDocument();
    expect(screen.getByText(/is recorded and summarised/)).toBeInTheDocument();
  });

  it("names its timer once, not every second (F9)", () => {
    const { view } = screenFor();
    const timer = screen.getByRole("timer");
    expect(timer).toHaveAccessibleName("Call duration");
    expect(timer).toHaveTextContent("29:05");
    view.rerender(<CallOverlay name="Bruno" phase="in_call" elapsedS={1746} warning={false} muted={false} onHangup={() => {}} onMute={() => {}} />);
    expect(screen.getByRole("timer")).toHaveAccessibleName("Call duration");
  });

  it("minimises, mutes and hangs up; the noise switch is the house checkbox (F5)", async () => {
    const h = screenFor();
    await userEvent.click(screen.getByRole("button", { name: "Minimise call" }));
    expect(h.onMinimise).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(h.onMute).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(h.onHangup).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox", { name: "Yard noise filter" }));
    expect(h.onToggleNoise).toHaveBeenCalledWith(false);
    expect(screen.getByRole("button", { name: "End call" }).className).toMatch(/bg-destructive/);
  });

  it("passes axe", async () => {
    const { view } = screenFor();
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe("the docked in-call bar (F4)", () => {
  it("has the clock, mute, open conversation, expand and hang up", async () => {
    const h = { onMute: vi.fn(), onHangup: vi.fn(), onExpand: vi.fn(), onOpenConversation: vi.fn() };
    const view = render(<ActiveCallBar name="Bruno" phase="in_call" elapsedS={65} muted recordingEnabled {...h} />);
    expect(screen.getByText("1:05")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Unmute" }));
    await userEvent.click(screen.getByRole("button", { name: "Conversation" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Open the call" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "End call" }));
    expect(h.onMute).toHaveBeenCalled();
    expect(h.onOpenConversation).toHaveBeenCalled();
    expect(h.onExpand).toHaveBeenCalled();
    expect(h.onHangup).toHaveBeenCalled();
    expectSolid(view.container.firstElementChild as HTMLElement);
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

describe("the processors sentence (G2)", () => {
  it("follows the pipeline's order and leaves out what is not configured", () => {
    expect(processorsSentence({ ...PROCESSING, summary: [PROCESSING.summary[0]] }))
      .toBe("Audio: Groq, or Google (Gemini) if Groq fails. Summary: Google (Gemini).");
    expect(processorsSentence(null)).toBe("");
  });
});
