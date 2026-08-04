/**
 * `useDebounced` — what keeps server-side search from firing one request per
 * keystroke now that the Finance hub's filter reaches the API (F8).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

import { useDebounced } from "./use-debounced";

// Fake timers are contained to this file: they leak into unrelated suites
// otherwise, which is how the Toast tests started hanging in PR2.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function Probe({ value }: { value: string }) {
  const settled = useDebounced(value, 300);
  return <span data-testid="out">{settled}</span>;
}

describe("useDebounced", () => {
  it("returns the initial value immediately", () => {
    render(<Probe value="a" />);
    expect(screen.getByTestId("out")).toHaveTextContent("a");
  });

  it("withholds the new value until the delay elapses", () => {
    const { rerender } = render(<Probe value="a" />);
    rerender(<Probe value="ab" />);

    // Still the old value: this is the whole point — no request yet.
    expect(screen.getByTestId("out")).toHaveTextContent("a");

    act(() => { vi.advanceTimersByTime(299); });
    expect(screen.getByTestId("out")).toHaveTextContent("a");

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByTestId("out")).toHaveTextContent("ab");
  });

  it("collapses a burst of keystrokes into ONE settled value", () => {
    const { rerender } = render(<Probe value="" />);

    // Typing "SBX-2026" one character at a time, faster than the delay.
    "SBX-2026".split("").forEach((_, i) => {
      rerender(<Probe value={"SBX-2026".slice(0, i + 1)} />);
      act(() => { vi.advanceTimersByTime(50); });
    });

    // Nothing has settled yet — eight keystrokes, zero requests.
    expect(screen.getByTestId("out")).toHaveTextContent("");

    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("out")).toHaveTextContent("SBX-2026");
  });

  it("does not strand a pending update when the component unmounts", () => {
    const { rerender, unmount } = render(<Probe value="a" />);
    rerender(<Probe value="b" />);
    unmount();
    // A surviving timer would call setState on an unmounted component.
    expect(() => act(() => { vi.runAllTimers(); })).not.toThrow();
  });
});
