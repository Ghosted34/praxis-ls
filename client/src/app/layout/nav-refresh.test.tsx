/**
 * The rail's refresh cell — and the distinction the whole control rests on.
 *
 * THE FAILURE THIS FILE EXISTS TO CATCH is a refresh button that reloads. It
 * looks identical in a screenshot, it "works" in a click-through, and the cost
 * only appears on the user who had a half-typed dossier open when they pressed
 * it. A tap here must refetch and must NOT touch `location.reload` — that
 * assertion is the point of the component, so it is the first test.
 *
 * The rest are states a screenshot cannot reach at all: a staged build, a press
 * made while the API is unreachable, and the two keyboard chords.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TENANT_KEY, makeQueryClient } from "@/lib/query-client";
import {
  reportReachable,
  reportUnreachable,
  __resetConnectionForTests,
} from "@/lib/connection";
import { setUpdateReady, __resetPwaUpdate } from "@/lib/pwa-update";
import { NavRefresh, tipFor } from "./nav-refresh";

let qc: QueryClient;
let reload: ReturnType<typeof vi.fn>;

function renderRefresh() {
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <NavRefresh />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const control = () =>
  screen.getByRole("button", { name: /Refresh|Offline|New version/ });

beforeEach(() => {
  __resetConnectionForTests();
  __resetPwaUpdate();
  qc = makeQueryClient();
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  __resetConnectionForTests();
  __resetPwaUpdate();
  qc.clear();
  vi.restoreAllMocks();
});

describe("NavRefresh", () => {
  it("is there from the first frame and is never disabled", () => {
    renderRefresh();
    const btn = control();
    // Unlike the arrows beside it, there is no state in which refusing a
    // refresh would be information, so this one never greys.
    expect(btn).not.toBeDisabled();
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    expect(btn.getAttribute("aria-label")).toMatch(/^Refresh data/);
    // And it advertises the chord, which is the only way anybody finds it.
    expect(btn.getAttribute("aria-label")).toMatch(/Alt\+R/);
  });

  it("refetches in place on a tap, and does not reload the page", async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderRefresh();

    await user.click(control());

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [TENANT_KEY] }),
    );
    // THE ASSERTION THIS FILE IS FOR. A reload here would throw away every open
    // form draft, the scroll position and the boot cost, to answer a question
    // that only ever needed a refetch.
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows the working state while the refetch is in flight, then settles", async () => {
    const user = userEvent.setup();
    renderRefresh();

    await user.click(control());
    await waitFor(() =>
      expect(control().getAttribute("aria-busy")).toBe("true"),
    );
    // A warm cache answers in under 20ms; the floor is what stops the control
    // flickering for one frame and reading as "did nothing".
    await waitFor(
      () => expect(control().getAttribute("aria-busy")).toBe("false"),
      { timeout: 3000 },
    );
  });

  it("opens the menu on a right-click, with the reload behind it", async () => {
    const user = userEvent.setup();
    renderRefresh();

    await user.pointer({ keys: "[MouseRight]", target: control() });

    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toMatch(/Refresh data/);
    expect(items[1].textContent).toMatch(/Reload app/);

    await user.click(items[1]);
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("treats a hold as the menu, not as a tap", async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderRefresh();
    const btn = control();

    // `userEvent.pointer`, not `fireEvent.pointerDown`: jsdom has no
    // PointerEvent constructor, so a fired pointerdown arrives with `button`
    // undefined and the primary-button guard correctly declines it. userEvent
    // builds the event properly, which is what a real press looks like.
    await user.pointer({ keys: "[MouseLeft>]", target: btn });
    // The hold fires at 450ms and opens the menu.
    await screen.findByRole("menu", {}, { timeout: 3000 });
    await user.pointer({ keys: "[/MouseLeft]" });

    // The click that ENDS a hold is the hold. Without the latch this control
    // would open the menu and refetch on the same gesture.
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("offers the staged build, and keeps saying so after the toast is gone", async () => {
    const user = userEvent.setup();
    setUpdateReady(true);
    renderRefresh();

    // The toast states this once and is dismissible; the rail states it for as
    // long as it is true, which is the whole reason the flag left that
    // component (lib/pwa-update.ts).
    expect(control().getAttribute("aria-label")).toMatch(/New version ready/);

    await user.pointer({ keys: "[MouseRight]", target: control() });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3);
    expect(
      within(menu).getByText(/Reload into new version/),
    ).toBeInTheDocument();
  });

  it("arms rather than fails when the API is unreachable, and fires on reconnect", async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderRefresh();

    act(() => reportUnreachable());
    await waitFor(() =>
      expect(control().getAttribute("aria-label")).toMatch(/^Refresh data/),
    );

    await user.click(control());
    // Not a request that fails — a request that is waiting for its moment.
    expect(invalidate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(control().getAttribute("aria-label")).toMatch(/^Offline/),
    );

    act(() => reportReachable());
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [TENANT_KEY] }),
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("disarms when pressed a second time while still offline", async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderRefresh();
    act(() => reportUnreachable());

    await user.click(control());
    await waitFor(() =>
      expect(control().getAttribute("aria-label")).toMatch(/^Offline/),
    );
    await user.click(control());
    await waitFor(() =>
      expect(control().getAttribute("aria-label")).toMatch(/^Refresh data/),
    );

    act(() => reportReachable());
    // Disarmed means disarmed: reconnecting must not fire a refresh the user
    // has withdrawn.
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("answers Alt+R with a refetch and Alt+Shift+R with a reload", async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderRefresh();

    await user.keyboard("{Alt>}r{/Alt}");
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [TENANT_KEY] }),
    );
    expect(reload).not.toHaveBeenCalled();

    await user.keyboard("{Alt>}{Shift>}r{/Shift}{/Alt}");
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("leaves Alt+R alone while the user is typing", async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <NavRefresh />
          <input aria-label="Client name" />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByLabelText("Client name"));
    await user.keyboard("{Alt>}r{/Alt}");

    // On a Mac that chord types "®". Firing a refetch out from under somebody
    // mid-word is the same class of theft as Alt+← moving the caret.
    expect(invalidate).not.toHaveBeenCalled();
  });
});

/** The tooltip is the only place these four states are ever spelled out, and
 *  three of them cannot be reached in a screenshot. */
describe("tipFor", () => {
  const t = (_k: string, o?: Record<string, unknown>) =>
    String(o?.defaultValue ?? "").replace(
      "{{n}}",
      String((o as { n?: number })?.n ?? ""),
    );
  const base = {
    working: false,
    armed: false,
    updateReady: false,
    ageMs: null,
    chord: "Alt+R",
  };

  it("reports the age of the oldest thing on screen", () => {
    expect(tipFor(t, { ...base, ageMs: 4_000 })).toMatch(/updated just now/);
    expect(tipFor(t, { ...base, ageMs: 4 * 60_000 })).toMatch(
      /updated 4 min ago/,
    );
    expect(tipFor(t, { ...base, ageMs: 3 * 3_600_000 })).toMatch(
      /updated 3 h ago/,
    );
  });

  it("says nothing about age when there is nothing to measure", () => {
    // A settings screen fetches nothing. A drained dial there would be fiction.
    expect(tipFor(t, base)).toBe("Refresh data (Alt+R)");
  });

  it("puts the states that need a decision ahead of the age", () => {
    expect(tipFor(t, { ...base, working: true, ageMs: 0 })).toMatch(
      /Refreshing/,
    );
    expect(tipFor(t, { ...base, armed: true, ageMs: 0 })).toMatch(/^Offline/);
    expect(tipFor(t, { ...base, updateReady: true, ageMs: 0 })).toMatch(
      /New version ready/,
    );
  });
});
