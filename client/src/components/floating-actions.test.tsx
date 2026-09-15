import * as React from "react";
/**
 * The floating cluster, and the one screen it used to refuse to appear on.
 *
 * Smart Comms was `!chatWorkstation &&` in the shell because the cluster lands
 * on the composer's Send button — the mic, when nothing is typed, which is the
 * control that sends a voice note. The stand-in was a quick-actions menu in the
 * title bar; that menu is gone at every width, so the exception would leave a
 * phone in Smart Comms with no quick actions and no clock-in at all.
 *
 * What is pinned here is the replacement: the cluster reads a floor the docked
 * control publishes, so it clears the composer rather than hiding from it, and
 * every other screen falls through to the 6rem it has always used.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FloatingActions } from "@/components/floating-actions";
import { useFabFloor } from "@/lib/fab-floor";

vi.mock("@/components/ai-actions", () => ({ useAiEnabled: () => true }));
vi.mock("@/components/clock-punch", () => ({ ClockPunch: () => null }));

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
const fab = () =>
  screen.getByRole("button", { name: /Quick actions/ }).parentElement!;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--fab-floor");
});

describe("FloatingActions anchors above whatever is docked below it", () => {
  it("takes the larger of 6rem and the published floor", () => {
    // `max()` rather than a branch: an unset variable is then not a special
    // case, so a screen that publishes nothing needs no knowledge of this at
    // all — which is every screen but Smart Comms.
    wrap(<FloatingActions />);
    expect(fab().className).toContain(
      "bottom-[max(6rem,var(--fab-floor,0px))]",
    );
  });

  it("is touch-only — the rail carries this list on desktop", () => {
    wrap(<FloatingActions />);
    expect(fab().className).toContain("md:hidden");
  });

  it("carries the unread badge, capped", () => {
    wrap(<FloatingActions badge={140} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });
});

/**
 * The publishing half. Asserted through a probe rather than through the real
 * composer, because what matters is the arithmetic and the two states — and the
 * composer would need the whole chat API mocked to say the same thing.
 */
describe("useFabFloor — the docked control publishes its own top edge", () => {
  function Probe({ top, height }: { top: number; height: number }) {
    const ref = React.useRef<HTMLDivElement>(null);
    // jsdom lays nothing out, so the rect is the thing under test and has to be
    // stated. A real composer's rect comes from the browser.
    React.useLayoutEffect(() => {
      const el = ref.current!;
      el.getBoundingClientRect = () =>
        ({ top, height, bottom: top + height }) as DOMRect;
    }, [top, height]);
    useFabFloor(ref);
    return <div ref={ref} />;
  }

  it("publishes the distance from the viewport bottom to the element's top", () => {
    // 800 tall viewport, composer top at 620 → 180 to its top, +12 to clear the
    // border. The cluster then sits on the composer's edge and not over it.
    window.innerHeight = 800;
    wrap(<Probe top={620} height={180} />);
    expect(document.documentElement.style.getPropertyValue("--fab-floor")).toBe(
      "192px",
    );
  });

  it("clears the floor for a hidden element rather than computing one", () => {
    // On a phone the thread pane is `display: none` while the channel list is
    // up. A `display: none` element measures 0×0 at the origin, and a floor
    // taken from that rect is the whole viewport height — which would throw the
    // cluster off the TOP of the screen on the one view with nothing in its way.
    window.innerHeight = 800;
    wrap(<Probe top={0} height={0} />);
    expect(document.documentElement.style.getPropertyValue("--fab-floor")).toBe(
      "",
    );
  });

  it("stops publishing when the composer unmounts", () => {
    // Navigating out of chat must not leave every other screen's cluster
    // parked halfway up the viewport.
    window.innerHeight = 800;
    const view = wrap(<Probe top={620} height={180} />);
    expect(document.documentElement.style.getPropertyValue("--fab-floor")).toBe(
      "192px",
    );
    act(() => view.unmount());
    expect(document.documentElement.style.getPropertyValue("--fab-floor")).toBe(
      "",
    );
  });
});
