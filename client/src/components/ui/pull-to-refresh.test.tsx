/**
 * PullToRefresh — the arming logic, which is where the "only works on the
 * control tower" bug actually lived.
 *
 * The gesture used to key off `window.scrollY`. In this app that is ALWAYS 0
 * (index.css makes html/body/#root `overflow:hidden`; the shell's <main> is the
 * only scroller), so the check was a no-op: it happened not to matter on the
 * control tower, a short overview page, and would have fired mid-scroll on every
 * long page — which is why the gesture was never hoisted app-wide. The fix is
 * `scrollRef`: read the real scroller's `scrollTop`. These tests pin that, plus
 * the two suppression paths the app-wide instance leans on (a modal open behind
 * it, and the explicit `disabled` the chat workstation passes).
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";

import { PullToRefresh } from "./pull-to-refresh";

/** A touch-device matchMedia: `(hover: hover)` is false, so the desktop guard
 *  stands down and the gesture is live — the same as a phone. */
function stubTouchMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Dispatch a touch event the component understands — it only reads
 *  `touches[0].clientY` and `touches.length`. jsdom has no TouchEvent
 *  constructor, so we hang a `touches` list off a plain Event. */
function fireTouch(el: Element, type: "touchstart" | "touchmove" | "touchend", clientY: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "touches", {
    value: type === "touchend" ? [] : [{ clientY }],
    configurable: true,
  });
  act(() => {
    el.dispatchEvent(ev);
  });
}

/** A full pull past the 72px trigger: start, drag down 200px (damped 0.55 =
 *  110px, over threshold), release. `startAt` seeds the fake scroller position
 *  so a test can place the finger at the top or mid-page. */
function pullPastThreshold(wrapper: Element) {
  fireTouch(wrapper, "touchstart", 100);
  fireTouch(wrapper, "touchmove", 300);
}

const scrollRefAt = (scrollTop: number) =>
  ({ current: { scrollTop } }) as unknown as React.RefObject<HTMLElement>;

beforeEach(() => {
  stubTouchMatchMedia();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PullToRefresh arming", () => {
  it("refreshes when pulled from the top of its scroll container", async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container, getByText, queryByText } = render(
      <PullToRefresh onRefresh={onRefresh} scrollRef={scrollRefAt(0)}>
        <div style={{ height: 2000 }}>content</div>
      </PullToRefresh>,
    );
    const wrapper = container.firstElementChild as Element;

    pullPastThreshold(wrapper);
    // The indicator has crossed the trigger line.
    expect(getByText("Release to refresh")).toBeInTheDocument();

    await act(async () => {
      fireTouch(wrapper, "touchend", 300);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(getByText("Refreshing…")).toBeInTheDocument();

    // The spinner clears itself after its minimum-visible window.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(queryByText("Refreshing…")).not.toBeInTheDocument();
  });

  it("does NOT arm when the scroll container is scrolled down (the app-wide bug)", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container, queryByText } = render(
      <PullToRefresh onRefresh={onRefresh} scrollRef={scrollRefAt(400)}>
        <div style={{ height: 2000 }}>content</div>
      </PullToRefresh>,
    );
    const wrapper = container.firstElementChild as Element;

    pullPastThreshold(wrapper);
    fireTouch(wrapper, "touchend", 300);

    // Mid-page: a downward drag is an ordinary scroll, never a refresh. This is
    // exactly what window.scrollY (always 0 here) could not tell us.
    expect(queryByText("Release to refresh")).not.toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("stands down while a modal dialog is open behind it", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    // A write form / meeting view / drilldown — any modal. The shell-level
    // instance must not fight its backdrop on any screen.
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);

    const { container } = render(
      <PullToRefresh onRefresh={onRefresh} scrollRef={scrollRefAt(0)}>
        <div>content</div>
      </PullToRefresh>,
    );
    const wrapper = container.firstElementChild as Element;

    pullPastThreshold(wrapper);
    fireTouch(wrapper, "touchend", 300);

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("respects the disabled prop (the chat workstation owns its own scroll)", () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <PullToRefresh onRefresh={onRefresh} scrollRef={scrollRefAt(0)} disabled>
        <div>content</div>
      </PullToRefresh>,
    );
    const wrapper = container.firstElementChild as Element;

    pullPastThreshold(wrapper);
    fireTouch(wrapper, "touchend", 300);

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
