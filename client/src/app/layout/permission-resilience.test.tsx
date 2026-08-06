/**
 * The four behaviours that make the shell survive a permissions read, and the
 * one that makes a direct URL survive a missing grant.
 *
 *   1. NO LAYOUT SHIFT. The ribbon must occupy its band on the first frame,
 *      whether it is drawing the last session's answer or a placeholder. jsdom
 *      cannot measure a pixel, so the assertion is the thing that CAUSES the
 *      pixel: the same element, the same classes, the same row count, whichever
 *      path produced it. A regression here is invisible in review and obvious
 *      to anyone using the product.
 *
 *   2 & 3. A GRANT AND A REVOCATION ARE DIFFERENT EVENTS. This is the whole
 *      point of the change and the thing most likely to be collapsed back into
 *      one path by a later refactor, because one path is simpler and looks
 *      right. It is not: a revocation must destroy the page immediately, and a
 *      grant must not destroy a half-written form to deliver news that cannot
 *      expose anything. Both directions are pinned, including the negative —
 *      that a grant does NOT reload — because that is the half a "just reload
 *      on any change" implementation gets wrong while passing every other test.
 *
 *   4. THE REFUSAL IS A PAGE, NOT A RENDERED 403. The gated screen must never
 *      mount, so the assertion is not "an error is shown" but "the child never
 *      ran and made no request".
 *
 * Only the network is faked. The real ShellProvider, the real cache, the real
 * ribbon and the real gate all run.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavAccess } from "@/lib/nav-access";
import type { ShellPrefs } from "@/lib/preferences";
import { writeCachedAccess, readCachedAccess } from "@/lib/nav-access-cache";

/** What the next `/permissions/mine` resolves to. `pending` never settles, so
 *  the shell stays in whatever state it painted first — which is how the cache
 *  miss and the cache hit are held still long enough to compare. */
const server = { current: null as NavAccess | null, pending: false, calls: 0 };

vi.mock("@/lib/nav-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nav-access")>("@/lib/nav-access");
  return {
    ...actual,
    fetchNavAccess: async () => {
      server.calls += 1;
      if (server.pending) return new Promise<NavAccess>(() => {});
      return server.current ?? actual.NO_ACCESS;
    },
  };
});

const storedPrefs = { current: { ribbonPinned: null, railPins: null, towerPins: null, railHintSeen: true } as ShellPrefs };
vi.mock("@/lib/preferences", async () => {
  const actual = await vi.importActual<typeof import("@/lib/preferences")>("@/lib/preferences");
  return { ...actual, fetchShellPrefs: async () => storedPrefs.current, saveShellPrefs: async () => storedPrefs.current };
});

vi.mock("@/app/auth/auth-context", async () => {
  const actual = await vi.importActual<typeof import("@/app/auth/auth-context")>("@/app/auth/auth-context");
  return { ...actual, useAuth: () => ({ user: { user_id: USER, ai_enabled: true }, status: "authed" as const }) };
});

import { ShellProvider } from "./shell-providers";
import { Ribbon } from "./ribbon";
import { RibbonSkeleton } from "./shell-skeleton";
import { AccessBanner } from "./access-banner";
import { RouteAccessGate } from "./route-access-gate";

const USER = "u-shell-test";

/** A payload in the endpoint's real shape. */
function grant(byGroup: Record<string, string[]>, isCeo = false): NavAccess {
  const modules = Object.values(byGroup).flat().sort();
  return { modules, groups: Object.keys(byGroup), byGroup, isCeo, version: modules.join("|").slice(0, 12) };
}

const WAREHOUSE = grant({ fulfill: ["MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37", "MOD-38"] });
/** The same, plus a finance family. A pure GAIN over WAREHOUSE. */
const WAREHOUSE_PLUS_FINANCE = grant({
  fulfill: ["MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37", "MOD-38"],
  transact: ["MOD-51", "MOD-52"],
});
/** WAREHOUSE with one module taken away. A pure LOSS. */
const WAREHOUSE_LESS_ONE = grant({ fulfill: ["MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37"] });

let reload: ReturnType<typeof vi.fn>;
/** The throttle in ShellProvider reads `Date.now()`. Driving it by hand beats
 *  fake timers here: `waitFor` needs the real ones. */
let clock = 0;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
});

beforeEach(() => {
  localStorage.clear();
  server.current = null;
  server.pending = false;
  server.calls = 0;
  storedPrefs.current = { ribbonPinned: null, railPins: null, towerPins: null, railHintSeen: true };
  clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  reload = vi.fn();
  Object.defineProperty(window, "location", { value: { reload, pathname: "/" }, writable: true });
});

afterEach(() => vi.restoreAllMocks());

function renderShell(ui: React.ReactElement, at = "/wms") {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[at]}>
        <ShellProvider>{ui}</ShellProvider>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

const ribbonOf = (c: HTMLElement) => c.querySelector<HTMLElement>(".ribbon");

/** Radix mints an incrementing id per render tree (`radix-:r4:`), so two
 *  renderings of the same markup differ by a counter and nothing else. Blanking
 *  it keeps the comparison about STRUCTURE, which is the only thing that can
 *  move a pixel. */
const structureOf = (el: HTMLElement) => el.outerHTML.replace(/radix-:r[0-9a-z]+:/g, "radix-id");

/* ── 1. the first frame ────────────────────────────────────────────────────── */

describe("the shell holds its structure from the first paint", () => {
  it("draws the ribbon from cache BEFORE the network answers", async () => {
    // The network never settles, so anything on screen came from storage.
    writeCachedAccess(USER, WAREHOUSE);
    server.pending = true;

    const { container } = renderShell(<Ribbon pathname="/wms" />);

    // Synchronously — no `findBy`, no tick. If this needed to await, the band
    // would be zero-height for at least one frame, which is the shift.
    const track = container.querySelector('[aria-label="Workflow"]');
    expect(track).not.toBeNull();
    expect(track!.textContent).toContain("Fulfil");
  });

  it("paints a SKELETON on a cache miss — not blank, and not a spinner", async () => {
    server.pending = true;
    const { container } = renderShell(<Ribbon pathname="/wms" />);

    const ribbon = ribbonOf(container);
    expect(ribbon).not.toBeNull();
    // A shimmer, which is the reused `Skeleton` primitive…
    expect(ribbon!.querySelectorAll(".animate-pulse").length).toBeGreaterThan(4);
    // …and emphatically not a spinner, nor an empty box.
    expect(ribbon!.querySelector(".animate-spin")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("gives the skeleton the same band as the resolved ribbon", async () => {
    // THE ACTUAL "NO SHIFT" ASSERTION for the cache-miss path. Height comes from
    // `.ribbon` / `.ribbon-row` in CSS, which jsdom does not apply — so what is
    // checked is the structure those rules attach to. A skeleton that dropped a
    // row, or used a plain <div>, would be a different height in a browser and
    // identical here without this.
    server.pending = true;
    const miss = renderShell(<Ribbon pathname="/wms" />);
    const placeholder = ribbonOf(miss.container)!;
    const placeholderShape = {
      tag: placeholder.tagName,
      cls: placeholder.className,
      rows: placeholder.querySelectorAll(".ribbon-row").length,
      tracks: placeholder.querySelectorAll(".ribbon-track").length,
    };
    miss.unmount();

    server.pending = false;
    server.current = WAREHOUSE;
    const hit = renderShell(<Ribbon pathname="/wms" />);
    await screen.findByRole("navigation", { name: "Workflow" });
    const real = ribbonOf(hit.container)!;

    expect({
      tag: real.tagName,
      cls: real.className,
      rows: real.querySelectorAll(".ribbon-row").length,
      tracks: real.querySelectorAll(".ribbon-track").length,
    }).toEqual(placeholderShape);
  });

  it("produces the SAME DOM from cache as from the network", async () => {
    // Same answer, two delivery paths, one rendering. Any divergence is a
    // reflow the moment the revalidation lands.
    writeCachedAccess(USER, WAREHOUSE);
    server.pending = true;
    const cached = renderShell(<Ribbon pathname="/wms" />);
    const fromCache = structureOf(ribbonOf(cached.container)!);
    cached.unmount();

    localStorage.clear();
    server.pending = false;
    server.current = WAREHOUSE;
    const fetched = renderShell(<Ribbon pathname="/wms" />);
    await screen.findByRole("navigation", { name: "Workflow" });

    expect(structureOf(ribbonOf(fetched.container)!)).toBe(fromCache);
  });

  it("reserves the COLLAPSED band for a user who collapsed it, before preferences load", async () => {
    // `prefs.ribbonPinned` is null both while loading and when never chosen, so
    // a shell that fell straight through to the default would open row B for
    // this user and shut it again a tick later — a 46px jump, reintroducing the
    // shift by the back door.
    localStorage.setItem("praxis.ribbon-pinned", "0");
    writeCachedAccess(USER, WAREHOUSE);
    server.pending = true;

    const { container } = renderShell(<Ribbon pathname="/wms" />);
    expect(ribbonOf(container)!.querySelectorAll(".ribbon-row")).toHaveLength(1);
  });

  it("is axe-clean while it is still a skeleton", async () => {
    server.pending = true;
    const { container } = renderShell(<Ribbon pathname="/wms" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ── 2. revocation ─────────────────────────────────────────────────────────── */

describe("a revoked module takes effect immediately", () => {
  it("hard-refreshes when the fresh set has lost something", async () => {
    writeCachedAccess(USER, WAREHOUSE);
    server.current = WAREHOUSE_LESS_ONE;

    renderShell(<Ribbon pathname="/wms" />);

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("clears the cache BEFORE reloading, so the next boot is not another reload", async () => {
    // The loop this prevents: reload → paint the revoked ribbon from cache →
    // diff against the same answer → revoked → reload. Forever.
    writeCachedAccess(USER, WAREHOUSE);
    server.current = WAREHOUSE_LESS_ONE;

    renderShell(<Ribbon pathname="/wms" />);

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(readCachedAccess(USER)).toBeNull();
  });

  it("shows no banner — a revocation is not something to acknowledge", async () => {
    writeCachedAccess(USER, WAREHOUSE);
    server.current = WAREHOUSE_LESS_ONE;

    renderShell(
      <>
        <Ribbon pathname="/wms" />
        <AccessBanner />
      </>,
    );

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(screen.queryByText(/access permissions have been updated/i)).toBeNull();
  });

  it("does NOT reload on a first login, when there is nothing to compare against", async () => {
    // An empty cache is not "everything was revoked".
    server.current = WAREHOUSE;
    renderShell(<Ribbon pathname="/wms" />);
    await screen.findByRole("navigation", { name: "Workflow" });
    expect(reload).not.toHaveBeenCalled();
  });
});

/* ── 3. grant ──────────────────────────────────────────────────────────────── */

describe("a granted module does not throw away what you were typing", () => {
  it("does NOT reload", async () => {
    writeCachedAccess(USER, WAREHOUSE);
    server.current = WAREHOUSE_PLUS_FINANCE;

    renderShell(
      <>
        <Ribbon pathname="/wms" />
        <AccessBanner />
      </>,
    );

    await screen.findByText(/access permissions have been updated/i);
    expect(reload).not.toHaveBeenCalled();
  });

  it("says so, in the words the product uses", async () => {
    writeCachedAccess(USER, WAREHOUSE);
    server.current = WAREHOUSE_PLUS_FINANCE;
    renderShell(<AccessBanner />);
    expect(
      await screen.findByText("Your access permissions have been updated. Reload to apply changes."),
    ).toBeInTheDocument();
  });

  it("still applies the new access to the ribbon without a reload", async () => {
    // The banner is about picking up the SCREENS behind the grant. The chrome
    // itself has no reason to wait — it re-renders from the fresh answer.
    writeCachedAccess(USER, WAREHOUSE);
    server.current = WAREHOUSE_PLUS_FINANCE;

    const { container } = renderShell(<Ribbon pathname="/wms" />);
    await waitFor(() =>
      expect(container.querySelector('[aria-label="Workflow"]')!.textContent).toContain("Transact"),
    );
  });

  it("is dismissible, and stays dismissed for the same change", async () => {
    writeCachedAccess(USER, WAREHOUSE);
    server.current = WAREHOUSE_PLUS_FINANCE;

    renderShell(<AccessBanner />);
    await screen.findByText(/access permissions have been updated/i);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/access permissions have been updated/i)).toBeNull();

    // Now make the shell ask again — past the throttle, with the SAME answer.
    // A dismissal keyed on anything but the change itself pops the banner back
    // up here, every fifteen seconds, forever.
    clock += 60_000;
    const before = server.calls;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(server.calls).toBeGreaterThan(before));
    expect(screen.queryByText(/access permissions have been updated/i)).toBeNull();
  });

  it("raises it again for a FURTHER grant on top of a dismissed one", async () => {
    writeCachedAccess(USER, WAREHOUSE);
    server.current = WAREHOUSE_PLUS_FINANCE;

    renderShell(<AccessBanner />);
    await screen.findByText(/access permissions have been updated/i);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    server.current = grant({
      fulfill: ["MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37", "MOD-38"],
      transact: ["MOD-51", "MOD-52"],
      empower: ["MOD-11"],
    });
    clock += 60_000;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(await screen.findByText(/access permissions have been updated/i)).toBeInTheDocument();
  });

  it("is axe-clean", async () => {
    writeCachedAccess(USER, WAREHOUSE);
    server.current = WAREHOUSE_PLUS_FINANCE;
    const { container } = renderShell(<AccessBanner />);
    await screen.findByText(/access permissions have been updated/i);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ── 4. revalidation cadence ───────────────────────────────────────────────── */

describe("when the shell re-asks", () => {
  it("asks once on mount", async () => {
    server.current = WAREHOUSE;
    renderShell(<Ribbon pathname="/wms" />);
    await waitFor(() => expect(server.calls).toBe(1));
  });

  it("throttles a burst of focus events into nothing extra", async () => {
    // An operator alt-tabs continuously. Without a floor this is a permissions
    // read per tab-out, forever, on every user.
    server.current = WAREHOUSE;
    renderShell(<Ribbon pathname="/wms" />);
    await waitFor(() => expect(server.calls).toBe(1));

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
    }
    expect(server.calls).toBe(1);
  });

  it("does ask again once the floor has passed", async () => {
    server.current = WAREHOUSE;
    renderShell(<Ribbon pathname="/wms" />);
    await waitFor(() => expect(server.calls).toBe(1));

    clock += 60_000;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(server.calls).toBe(2));
  });
});

/* ── 5. the no-access page ─────────────────────────────────────────────────── */

describe("a direct URL into a module you cannot see", () => {
  /** Stands in for a routed screen. Records that it mounted and that it would
   *  have fetched — the two things that must not happen. */
  function Screen({ onMount }: { onMount: () => void }) {
    React.useEffect(onMount, [onMount]);
    return <p>the finance ledger</p>;
  }

  it("renders a branded refusal instead of the screen", async () => {
    server.current = WAREHOUSE; // no MOD-51
    const mounted = vi.fn();

    renderShell(
      <RouteAccessGate pathname="/finance/invoices">
        <Screen onMount={mounted} />
      </RouteAccessGate>,
      "/finance/invoices",
    );

    // One <h1>, and it names the module's area rather than saying "403".
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/Finance is not part of your access/i);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("NEVER MOUNTS THE SCREEN, so nothing behind the grant is ever requested", async () => {
    // The hard boundary, from the client side. The page is friendly because it
    // is a page — not because a 403 was rendered nicely. If the screen mounted,
    // its reads would fire and the only thing standing between this user and a
    // Finance payload would be the server. (The server holds too:
    // tests/unit/no-access-boundary.test.js asserts the 403's BODY.)
    server.current = WAREHOUSE;
    const mounted = vi.fn();

    renderShell(
      <RouteAccessGate pathname="/finance/invoices">
        <Screen onMount={mounted} />
      </RouteAccessGate>,
      "/finance/invoices",
    );

    await screen.findByRole("heading", { level: 1 });
    expect(mounted).not.toHaveBeenCalled();
    expect(screen.queryByText("the finance ledger")).toBeNull();
  });

  it("names the module and explains what it is for, without a figure from it", async () => {
    server.current = WAREHOUSE;
    renderShell(
      <RouteAccessGate pathname="/finance/invoices">
        <p>screen</p>
      </RouteAccessGate>,
      "/finance/invoices",
    );

    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByText("MOD-51")).toBeInTheDocument();
    expect(screen.getByText(/revenue recognition/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request access" })).toBeInTheDocument();
  });

  it("lets the screen through when the grant is there", async () => {
    server.current = grant({ transact: ["MOD-51"] });
    renderShell(
      <RouteAccessGate pathname="/finance/invoices">
        <p>the finance ledger</p>
      </RouteAccessGate>,
      "/finance/invoices",
    );
    expect(await screen.findByText("the finance ledger")).toBeInTheDocument();
  });

  it("shows a skeleton rather than the screen while the answer is unknown", async () => {
    // Mounting optimistically would fire reads that may 403; rendering nothing
    // would collapse the content column.
    server.pending = true;
    const { container } = renderShell(
      <RouteAccessGate pathname="/finance/invoices">
        <p>the finance ledger</p>
      </RouteAccessGate>,
      "/finance/invoices",
    );
    expect(screen.queryByText("the finance ledger")).toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("is axe-clean", async () => {
    server.current = WAREHOUSE;
    const { container } = renderShell(
      <RouteAccessGate pathname="/finance/invoices">
        <p>screen</p>
      </RouteAccessGate>,
      "/finance/invoices",
    );
    await screen.findByRole("heading", { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ── the placeholder in isolation ──────────────────────────────────────────── */

describe("RibbonSkeleton", () => {
  it("announces nothing — the content column owns the one loading region", () => {
    // Two "loading" announcements per cold start is noise, and the furniture is
    // the half nobody asked about.
    const { container } = render(<RibbonSkeleton />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector(".ribbon")).toHaveAttribute("aria-hidden", "true");
  });
});
