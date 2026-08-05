/**
 * The ribbon and the icon rail, against the four things that would make them
 * wrong in ways nobody notices in review.
 *
 *   1. A FAMILY WITH NOTHING IN IT. The spec is "hidden entirely — not empty,
 *      not locked". An empty tab is worse than a missing one: it tells a user
 *      there is something there and then refuses to say what.
 *   2. A CEO WITH NO GRANT ROWS. `rbac.js` lets the CEO through every module
 *      regardless of the permission table, so a shell resolved from grants
 *      alone shows an empty ribbon over an app that permits everything. This is
 *      the failure a test that only exercises a normal user cannot see.
 *   3. THE TWO-TAB CASE. Access is per-role, so the ribbon has to be a resolved
 *      object at two tabs and at six. Layout is not testable in jsdom, but the
 *      accessibility of both is, and a scan at each count is what stops the
 *      "minimal" case being the one nobody ever renders.
 *   4. AN EMPTY RAIL. A customisable strip that arrives empty teaches nobody
 *      that it is customisable, and the `+` at the bottom reads as breakage
 *      rather than as an invitation.
 *
 * Everything here drives the REAL components through the real
 * `/permissions/mine` shape. The only thing faked is the network.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NavAccess } from "@/lib/nav-access";
import type { ShellPrefs } from "@/lib/preferences";

/** Captures what the shell PUTs, so a preference round-trip is a fact rather
 *  than an assumption about local state. */
const saved: Partial<ShellPrefs>[] = [];
const access = { current: null as NavAccess | null };
const stored = { current: { ribbonPinned: null, railPins: null, railHintSeen: true } as ShellPrefs };

vi.mock("@/lib/nav-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nav-access")>("@/lib/nav-access");
  return { ...actual, fetchNavAccess: async () => access.current ?? actual.NO_ACCESS };
});

vi.mock("@/lib/preferences", async () => {
  const actual = await vi.importActual<typeof import("@/lib/preferences")>("@/lib/preferences");
  return {
    ...actual,
    fetchShellPrefs: async () => stored.current,
    saveShellPrefs: async (patch: Partial<ShellPrefs>) => {
      saved.push(patch);
      stored.current = { ...stored.current, ...patch };
      return stored.current;
    },
  };
});

// The rail's quick actions read the tenant's AI flag through useAuth.
vi.mock("@/app/auth/auth-context", async () => {
  const actual = await vi.importActual<typeof import("@/app/auth/auth-context")>("@/app/auth/auth-context");
  return {
    ...actual,
    useAuth: () => ({ user: { user_id: "u1", ai_enabled: true }, status: "authed" as const }),
  };
});

import { ShellProvider, RibbonCommandsProvider } from "./shell-providers";
import { Ribbon } from "./ribbon";
import { IconRail } from "./icon-rail";
import { BottomNav } from "./mobile-nav";
import { useRibbonCommands } from "./ribbon-commands";

/** A permissions payload in the endpoint's real shape. `byGroup` is the
 *  server's partition of the visible modules; the client never invents it. */
function grant(byGroup: Record<string, string[]>, isCeo = false): NavAccess {
  const modules = Object.values(byGroup).flat().sort();
  return { modules, groups: Object.keys(byGroup), byGroup, isCeo, version: modules.join("|").slice(0, 12) };
}

/** Two tabs: warehouse work and the money behind it. */
const TWO_TABS = grant({
  fulfill: ["MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37", "MOD-38"],
  transact: ["MOD-51", "MOD-52", "MOD-56", "MOD-58", "MOD-59", "MOD-54", "MOD-53", "MOD-07", "MOD-05"],
});

/** All six, as a CEO resolves. */
const SIX_TABS = grant(
  {
    monitor: ["MOD-00A", "MOD-64", "MOD-74"],
    engage: ["MOD-20", "MOD-21", "MOD-22", "MOD-23", "MOD-24", "MOD-26", "MOD-27", "MOD-28", "MOD-60", "MOD-61", "MOD-62"],
    fulfill: ["MOD-29", "MOD-30", "MOD-31", "MOD-32", "MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37", "MOD-38", "MOD-39", "MOD-40", "MOD-41", "MOD-42", "MOD-43", "MOD-44", "MOD-45"],
    transact: ["MOD-51", "MOD-52", "MOD-53", "MOD-54", "MOD-56", "MOD-58", "MOD-59", "MOD-46", "MOD-47", "MOD-49"],
    empower: ["MOD-02", "MOD-11", "MOD-12", "MOD-13", "MOD-14", "MOD-15", "MOD-16", "MOD-17", "MOD-18", "MOD-19", "MOD-71"],
    configure: ["MOD-01", "MOD-03", "MOD-04", "MOD-05", "MOD-07", "MOD-08", "MOD-09", "MOD-10", "MOD-63", "MOD-65", "MOD-66", "MOD-67", "MOD-68", "MOD-70", "MOD-75", "MOD-00B"],
  },
  true,
);

beforeAll(() => {
  // jsdom implements neither; the rail asks for the reduced-motion preference
  // and Radix's tooltip positioning asks for the second.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }),
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  saved.length = 0;
  access.current = null;
  stored.current = { ribbonPinned: null, railPins: null, railHintSeen: true };
  // THE SHELL NOW REMEMBERS. `lib/nav-access-cache` persists the last answer so
  // the ribbon paints before the network replies, which makes every test in
  // this file start from whatever the previous one left behind — and a fixture
  // with fewer modules than its predecessor reads as a REVOCATION, which
  // hard-refreshes the page in the middle of an assertion. Persistent state
  // needs an explicit reset; a suite that shares it is testing the order it
  // happens to run in.
  localStorage.clear();
});

function renderChrome(ui: React.ReactElement, at = "/") {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[at]}>
        <ShellProvider>
          <RibbonCommandsProvider>{ui}</RibbonCommandsProvider>
        </ShellProvider>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

const renderRibbon = (at = "/") => renderChrome(<Ribbon pathname={at} />, at);

/** The ribbon renders nothing until the permissions read settles. Row A is a
 *  nav of LINKS — see ribbon.tsx for why it does not claim `role="tab"`. */
const tabs = async () => {
  const track = await screen.findByRole("navigation", { name: "Workflow" });
  return within(track).getAllByRole("link");
};

describe("the ribbon's tabs are the user's, not the app's", () => {
  it("shows only the families this user has modules in", async () => {
    access.current = TWO_TABS;
    renderRibbon("/wms");
    expect((await tabs()).map((t) => t.textContent)).toEqual(["Fulfil", "Transact"]);
  });

  it("does not render a family whose modules resolve to no screen", async () => {
    // A verb the server reports, whose only visible module has no area in this
    // client — a backend-only module, or one whose screen has not shipped. The
    // tab must be absent, not present-and-empty.
    access.current = grant({ fulfill: ["MOD-29"], empower: ["MOD-99"] });
    renderRibbon("/operations");
    expect((await tabs()).map((t) => t.textContent)).toEqual(["Fulfil"]);
  });

  it("marks the family you are in, since the row is links rather than tabs", async () => {
    access.current = TWO_TABS;
    renderRibbon("/finance/invoices");
    const current = (await tabs()).filter((t) => t.getAttribute("aria-current") === "page");
    expect(current.map((t) => t.textContent)).toEqual(["Transact"]);
  });

  it("gives a CEO with no grant rows every family", async () => {
    access.current = SIX_TABS;
    renderRibbon("/");
    expect(await tabs()).toHaveLength(6);
  });

  it("renders nothing at all when the permissions read fails", async () => {
    // Falling open would offer destinations that 403 on click, which reads as a
    // broken product rather than a restricted one.
    access.current = grant({});
    const { container } = renderRibbon("/");
    await waitFor(() => expect(container.querySelector(".ribbon")).toBeNull());
  });
});

describe("row B is the hub's tabs, in the chrome", () => {
  it("lists the active area's sections", async () => {
    access.current = TWO_TABS;
    renderRibbon("/wms/inventory");
    const sections = await screen.findByRole("navigation", { name: "Warehouse sections" });
    expect(within(sections).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Locations", "Inventory", "Inbound / GRN", "Outbound", "Equipment", "Cycle counts",
    ]);
  });

  it("hides a section this user cannot read, while keeping the rest", async () => {
    access.current = grant({ fulfill: ["MOD-33", "MOD-35"] }); // inbound + inventory only
    renderRibbon("/wms");
    const sections = await screen.findByRole("navigation", { name: "Warehouse sections" });
    expect(within(sections).getAllByRole("link").map((l) => l.textContent)).toEqual(["Inventory", "Inbound / GRN"]);
  });

  it("lists the family's areas when the area you are in has no sections of its own", async () => {
    // `monitor` is four single-screen areas. A row that insisted on sections
    // would be a lone dropdown with nothing beside it.
    access.current = grant({ monitor: ["MOD-00A", "MOD-74"] });
    renderRibbon("/");
    const areas = await screen.findByRole("navigation", { name: "Monitor areas" });
    expect(within(areas).getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Control Tower", "My workspace", "Support & feedback",
    ]);
  });

  it("offers the family's other areas without leaving the section row", async () => {
    access.current = SIX_TABS;
    renderRibbon("/operations/files");
    // Exactly "Operations" — the overflow trigger beside it is named "All
    // Operations destinations", and a loose matcher would pass on either.
    expect(await screen.findByRole("button", { name: "Operations" })).toBeInTheDocument();
  });
});

describe("the ribbon is accessible at every tab count", () => {
  it.each([
    ["two tabs", TWO_TABS, "/wms/inventory"],
    ["six tabs", SIX_TABS, "/finance/invoices"],
  ])("is axe-clean with %s", async (_label, payload, at) => {
    access.current = payload;
    const { container } = renderRibbon(at);
    await screen.findByRole("navigation", { name: "Workflow" });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("pinned / collapsed round-trips through the preference API", () => {
  it("defaults to pinned when the user has never chosen", async () => {
    access.current = TWO_TABS;
    renderRibbon("/wms");
    expect(await screen.findByRole("button", { name: "Collapse the ribbon" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("navigation", { name: "Warehouse sections" })).toBeInTheDocument();
  });

  it("persists a collapse, and hides row B", async () => {
    access.current = TWO_TABS;
    renderRibbon("/wms");
    await userEvent.click(await screen.findByRole("button", { name: "Collapse the ribbon" }));

    expect(saved).toEqual([{ ribbonPinned: false }]);
    expect(screen.queryByRole("navigation", { name: "Warehouse sections" })).toBeNull();
    expect(screen.getByRole("button", { name: "Keep the ribbon open" })).toHaveAttribute("aria-pressed", "false");
  });

  it("reads the saved state back on the next session", async () => {
    access.current = TWO_TABS;
    stored.current = { ribbonPinned: false, railPins: null, railHintSeen: true };
    renderRibbon("/wms");
    await screen.findByRole("navigation", { name: "Workflow" });
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "Warehouse sections" })).toBeNull());
  });

  /** Unpinned is not "gone": clicking a family still summons row B, which is
   *  what makes collapsing safe to try. */
  it("summons row B from a family click while collapsed", async () => {
    access.current = TWO_TABS;
    stored.current = { ribbonPinned: false, railPins: null, railHintSeen: true };
    renderRibbon("/wms");
    const [fulfil] = await tabs();
    await userEvent.click(fulfil);
    expect(await screen.findByRole("navigation", { name: /sections|areas/ })).toBeInTheDocument();
  });
});

describe("a screen's commands sit in row B, right-aligned", () => {
  function Publisher() {
    useRibbonCommands(React.useMemo(() => [{ key: "new", label: "New invoice", onSelect: () => {} }], []));
    return null;
  }

  it("shows what the mounted screen published, and drops it when the screen unmounts", async () => {
    access.current = TWO_TABS;
    const { rerender } = renderChrome(
      <>
        <Ribbon pathname="/finance" />
        <Publisher />
      </>,
      "/finance",
    );
    expect(await screen.findByRole("button", { name: "New invoice" })).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <MemoryRouter initialEntries={["/finance"]}>
          <ShellProvider>
            <RibbonCommandsProvider>
              <Ribbon pathname="/finance" />
            </RibbonCommandsProvider>
          </ShellProvider>
        </MemoryRouter>
      </TooltipProvider>,
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "New invoice" })).toBeNull());
  });
});

describe("the icon rail", () => {
  it("is never empty on a first login", async () => {
    access.current = SIX_TABS;
    stored.current = { ribbonPinned: null, railPins: null, railHintSeen: null };
    renderChrome(<IconRail />, "/");

    const rail = await screen.findByRole("navigation", { name: "Shortcuts" });
    // The fixed pair plus a starter set — not "two icons and a plus".
    await waitFor(() => expect(within(rail).getAllByRole("link").length).toBeGreaterThan(3));
    expect(within(rail).getByRole("link", { name: "Control Tower" })).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: /Search/ })).toBeInTheDocument();
  });

  it("falls back to what this user CAN see when none of the defaults are visible", async () => {
    // A warehouse-only role sees none of Operations / Finance / Comms /
    // Workspace, which is exactly when a naive default set yields an empty rail.
    access.current = grant({ fulfill: ["MOD-33", "MOD-35"] });
    stored.current = { ribbonPinned: null, railPins: null, railHintSeen: null };
    renderChrome(<IconRail />, "/wms");
    const rail = await screen.findByRole("navigation", { name: "Shortcuts" });
    await waitFor(() => expect(within(rail).getByRole("link", { name: "Warehouse" })).toBeInTheDocument());
  });

  it("keeps a deliberately cleared rail cleared", async () => {
    access.current = SIX_TABS;
    stored.current = { ribbonPinned: null, railPins: [], railHintSeen: true };
    renderChrome(<IconRail />, "/");
    const rail = await screen.findByRole("navigation", { name: "Shortcuts" });
    // Control Tower and the editor survive — "cleared" is not "empty".
    await waitFor(() => expect(within(rail).queryByRole("link", { name: "Finance" })).toBeNull());
    expect(within(rail).getByRole("link", { name: "Control Tower" })).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "Edit shortcuts" })).toBeInTheDocument();
  });

  it("drops a pin whose area the user can no longer reach", async () => {
    access.current = grant({ fulfill: ["MOD-33"] });
    stored.current = { ribbonPinned: null, railPins: ["wms", "finance"], railHintSeen: true };
    renderChrome(<IconRail />, "/wms");
    const rail = await screen.findByRole("navigation", { name: "Shortcuts" });
    await waitFor(() => expect(within(rail).getByRole("link", { name: "Warehouse" })).toBeInTheDocument());
    expect(within(rail).queryByRole("link", { name: "Finance" })).toBeNull();
  });

  it("nudges the edit affordance once, and records that it has", async () => {
    access.current = SIX_TABS;
    stored.current = { ribbonPinned: null, railPins: null, railHintSeen: null };
    renderChrome(<IconRail />, "/");
    // The rail paints before the preferences land — the hint is decided once
    // BOTH reads settle, which is what stops it firing at a returning user on
    // the strength of the all-null starting state.
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Edit shortcuts" }).className).toContain("rail-jiggle"),
    );
    expect(saved).toEqual([{ railHintSeen: true }]);
  });

  it("does not nudge a user who has already seen it", async () => {
    access.current = SIX_TABS;
    stored.current = { ribbonPinned: null, railPins: null, railHintSeen: true };
    renderChrome(<IconRail />, "/");
    const edit = await screen.findByRole("link", { name: "Edit shortcuts" });
    await waitFor(() => expect(edit.className).not.toContain("rail-jiggle"));
    expect(saved).toEqual([]);
  });

  it("is axe-clean", async () => {
    access.current = SIX_TABS;
    const { container } = renderChrome(<IconRail />, "/");
    await screen.findByRole("navigation", { name: "Shortcuts" });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("the phone gets the same families, not a scrolled ribbon", () => {
  it("puts every family in the bottom bar", async () => {
    access.current = SIX_TABS;
    renderChrome(<BottomNav onSearch={() => {}} />, "/");
    const bar = await screen.findByRole("navigation", { name: "Primary" });
    await waitFor(() => expect(within(bar).getAllByRole("button")).toHaveLength(7)); // six + Search
  });

  it("opens a family into a sheet of its destinations", async () => {
    access.current = TWO_TABS;
    renderChrome(<BottomNav onSearch={() => {}} />, "/wms");
    const bar = await screen.findByRole("navigation", { name: "Primary" });
    await userEvent.click(within(bar).getByRole("button", { name: /Fulfil/ }));

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("link", { name: "Warehouse" })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Cycle counts" })).toBeInTheDocument();
  });
});
