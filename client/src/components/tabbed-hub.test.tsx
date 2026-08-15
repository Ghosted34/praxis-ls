/**
 * The hub's tab strip is a FALLBACK, not an unconditional removal.
 *
 * THE STATE THIS EXISTS TO PREVENT. The ribbon's second row carries a hub's
 * sections, so the in-page strip is hidden on desktop — but the ribbon renders
 * nothing until the permissions read settles, and nothing at all if that read
 * failed. Hide the strip regardless and there is a state where a user is
 * standing inside a hub with no row B and no tabs: they cannot reach another
 * section of the screen they are already looking at, and nothing on screen says
 * why. A 403 is a restriction; this is a dead end.
 *
 * WHAT "HIDDEN ON DESKTOP" MEANS IN JSDOM. It is the `md:hidden` class, and
 * jsdom applies no media queries — so these assert the DECISION (is the class
 * applied?) rather than the pixels. That is the honest limit of this altitude,
 * and it is the right thing to pin: the class is the decision, and whether
 * Tailwind's breakpoint works is not this file's question. The browser gate
 * (`e2e/layout.spec.ts`) is where the rendered result is measured.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { authContextMock } from "@/test/screen-harness";
import type { NavAccess } from "@/lib/nav-access";

// `ShellProvider` reads the signed-in user, because the cached access record is
// keyed per user — a shared terminal must not paint the last operator's ribbon.
// This file mounts the real provider, so it needs a real answer from `useAuth`.
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const access = { current: null as NavAccess | null };
const accessFails = { current: false };
/** Held open, so "in flight" is asserted as itself rather than as a race against
 *  a promise that resolves a tick after the assertion. */
const accessPending = { current: false };

vi.mock("@/lib/nav-access", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/nav-access")>(
      "@/lib/nav-access",
    );
  return {
    ...actual,
    fetchNavAccess: () => {
      if (accessPending.current) return new Promise<never>(() => {}); // never settles
      if (accessFails.current) return Promise.reject(new Error("network"));
      return Promise.resolve(access.current ?? actual.NO_ACCESS);
    },
  };
});

vi.mock("@/lib/preferences", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/preferences")>(
      "@/lib/preferences",
    );
  return {
    ...actual,
    fetchShellPrefs: async () => actual.EMPTY_SHELL_PREFS,
    saveShellPrefs: async () => actual.EMPTY_SHELL_PREFS,
  };
});

import { ShellProvider } from "@/app/layout/shell-providers";
import { TabbedHub } from "./tabbed-hub";

function grant(byGroup: Record<string, string[]>): NavAccess {
  return {
    modules: Object.values(byGroup).flat().sort(),
    groups: Object.keys(byGroup),
    byGroup,
    isCeo: false,
    version: "test",
  };
}

/** Warehouse, fully granted — the ribbon will carry /wms's six sections. */
const WMS = grant({
  fulfill: ["MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37", "MOD-38"],
});

const Page = () => <p>inventory</p>;
const TABS = [
  { key: "locations", label: "Locations", Component: Page },
  { key: "inventory", label: "Inventory", Component: Page },
];

beforeEach(() => {
  access.current = null;
  accessFails.current = false;
  accessPending.current = false;
  // The shell now paints its FIRST frame from a localStorage record, so without
  // this each test starts from the previous one's ribbon — and a fixture with
  // fewer modules than its predecessor reads as a revocation, which triggers a
  // hard reload mid-assertion. Every test in this file shares one user id.
  localStorage.clear();
});

function renderHub() {
  return render(
    <MemoryRouter initialEntries={["/wms"]}>
      <ShellProvider>
        <TabbedHub eyebrow="Warehouse" basePath="/wms" tabs={TABS} inlineTabs />
      </ShellProvider>
    </MemoryRouter>,
  );
}

/** The strip's wrapper carries the desktop-hiding class, or does not. */
function stripIsHiddenOnDesktop() {
  const strip = screen.getAllByRole("tablist", {
    name: "Warehouse sections",
  })[0];
  return strip.parentElement!.className.includes("md:hidden");
}

describe("the in-page strip yields to the ribbon, and only to the ribbon", () => {
  it("hides on desktop when the ribbon is carrying this area's sections", async () => {
    access.current = WMS;
    renderHub();
    await waitFor(() => expect(stripIsHiddenOnDesktop()).toBe(true));
  });

  /**
   * THE FAILED READ. `families` is empty, so the ribbon returns null — and with
   * an unconditional `md:hidden` the user had no navigation of any kind inside
   * the hub they were already in.
   */
  it("stays on desktop when the permissions read failed", async () => {
    accessFails.current = true;
    renderHub();
    // The strip is present AND not hidden — both halves matter: rendering it
    // and then hiding it at `md` is the bug, not the fix.
    await waitFor(() => expect(stripIsHiddenOnDesktop()).toBe(false));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Locations",
      "Inventory",
    ]);
  });

  it("stays on desktop when the read succeeded but this area is not in the ribbon", async () => {
    // A user who can reach /wms by URL — a bookmark, a link in a message —
    // while holding no warehouse module. The ribbon has nothing to show for the
    // area, so the strip is how they move around the screen they are on.
    access.current = grant({ transact: ["MOD-51"] });
    renderHub();
    await waitFor(() => expect(stripIsHiddenOnDesktop()).toBe(false));
  });

  /**
   * Deliberately NOT shown while the read is in flight. It is one round trip,
   * and a strip that appears and then vanishes on every hub load is worse than
   * the wait — this is the flicker the `ready` gate exists to avoid.
   */
  it("does not flash on desktop while the read is still in flight", async () => {
    accessPending.current = true;
    renderHub();
    // `waitFor` so the preferences half of the read settles inside `act`; the
    // access half never does, which is what keeps this the in-flight case.
    await waitFor(() => expect(stripIsHiddenOnDesktop()).toBe(true));
  });
});
