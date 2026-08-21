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
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { makeQueryClient } from "@/lib/query-client";
import type { NavAccess } from "@/lib/nav-access";
import type { ShellPrefs } from "@/lib/preferences";

/** Captures what the shell PUTs, so a preference round-trip is a fact rather
 *  than an assumption about local state. */
const saved: Partial<ShellPrefs>[] = [];
const access = { current: null as NavAccess | null };
const stored = {
  current: {
    ribbonPinned: null,
    railPins: null,
    towerPins: null,
    railHintSeen: true,
  } as ShellPrefs,
};
/** Make the preferences read fail, which is NOT the same as it returning
 *  nothing — see "a failed preferences read" below. */
const prefsFail = { current: false };
/** Hold the permissions read open, so the "still loading" state can be asserted
 *  as itself rather than inferred from a frame that happens to render first. */
const accessPending = { current: false };

vi.mock("@/lib/nav-access", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/nav-access")>(
      "@/lib/nav-access",
    );
  return {
    ...actual,
    fetchNavAccess: () =>
      accessPending.current
        ? new Promise<never>(() => {}) // never settles
        : Promise.resolve(access.current ?? actual.NO_ACCESS),
  };
});

vi.mock("@/lib/preferences", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/preferences")>(
      "@/lib/preferences",
    );
  return {
    ...actual,
    fetchShellPrefs: async () => {
      if (prefsFail.current) throw new Error("network");
      return stored.current;
    },
    saveShellPrefs: async (patch: Partial<ShellPrefs>) => {
      saved.push(patch);
      stored.current = { ...stored.current, ...patch };
      return stored.current;
    },
  };
});

// The rail's quick actions read the tenant's AI flag through useAuth.
vi.mock("@/app/auth/auth-context", async () => {
  const actual = await vi.importActual<
    typeof import("@/app/auth/auth-context")
  >("@/app/auth/auth-context");
  return {
    ...actual,
    useAuth: () => ({
      user: { user_id: "u1", ai_enabled: true },
      status: "authed" as const,
    }),
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
  return {
    modules,
    groups: Object.keys(byGroup),
    byGroup,
    isCeo,
    version: modules.join("|").slice(0, 12),
  };
}

/** Two tabs: warehouse work and the money behind it. */
const TWO_TABS = grant({
  fulfill: ["MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37", "MOD-38"],
  transact: [
    "MOD-51",
    "MOD-52",
    "MOD-56",
    "MOD-58",
    "MOD-59",
    "MOD-54",
    "MOD-53",
    "MOD-07",
    "MOD-05",
  ],
});

/** All six, as a CEO resolves. */
const SIX_TABS = grant(
  {
    monitor: ["MOD-00A", "MOD-64", "MOD-74"],
    engage: [
      "MOD-20",
      "MOD-21",
      "MOD-22",
      "MOD-23",
      "MOD-24",
      "MOD-26",
      "MOD-27",
      "MOD-28",
      "MOD-60",
      "MOD-61",
      "MOD-62",
    ],
    fulfill: [
      "MOD-29",
      "MOD-30",
      "MOD-31",
      "MOD-32",
      "MOD-33",
      "MOD-34",
      "MOD-35",
      "MOD-36",
      "MOD-37",
      "MOD-38",
      "MOD-39",
      "MOD-40",
      "MOD-41",
      "MOD-42",
      "MOD-43",
      "MOD-44",
      "MOD-45",
    ],
    transact: [
      "MOD-51",
      "MOD-52",
      "MOD-53",
      "MOD-54",
      "MOD-56",
      "MOD-58",
      "MOD-59",
      "MOD-46",
      "MOD-47",
      "MOD-49",
    ],
    empower: [
      "MOD-02",
      "MOD-11",
      "MOD-12",
      "MOD-13",
      "MOD-14",
      "MOD-15",
      "MOD-16",
      "MOD-17",
      "MOD-18",
      "MOD-19",
      "MOD-71",
    ],
    configure: [
      "MOD-01",
      "MOD-03",
      "MOD-04",
      "MOD-05",
      "MOD-07",
      "MOD-08",
      "MOD-09",
      "MOD-10",
      "MOD-63",
      "MOD-65",
      "MOD-66",
      "MOD-67",
      "MOD-68",
      "MOD-70",
      "MOD-75",
      "MOD-00B",
    ],
  },
  true,
);

beforeAll(() => {
  // jsdom implements neither; the rail asks for the reduced-motion preference
  // and Radix's tooltip positioning asks for the second.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  saved.length = 0;
  prefsFail.current = false;
  accessPending.current = false;
  access.current = null;
  stored.current = {
    ribbonPinned: null,
    railPins: null,
    towerPins: null,
    railHintSeen: true,
  };
  // THE SHELL NOW REMEMBERS. `lib/nav-access-cache` persists the last answer so
  // the ribbon paints before the network replies, which makes every test in
  // this file start from whatever the previous one left behind — and a fixture
  // with fewer modules than its predecessor reads as a REVOCATION, which
  // hard-refreshes the page in the middle of an assertion. Persistent state
  // needs an explicit reset; a suite that shares it is testing the order it
  // happens to run in.
  localStorage.clear();
});

/**
 * The shell's providers, in the order main.tsx nests them.
 *
 * The QueryClient is here because the rail's refresh cell reads the query cache
 * to draw its freshness dial (`nav-refresh.tsx`) — in the app it is the
 * outermost provider of all, so a test that renders the rail without one is
 * testing a tree that cannot exist.
 */
function chrome(ui: React.ReactElement, at: string) {
  return (
    <QueryClientProvider client={makeQueryClient()}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[at]}>
          <ShellProvider>
            <RibbonCommandsProvider>{ui}</RibbonCommandsProvider>
          </ShellProvider>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function renderChrome(ui: React.ReactElement, at = "/") {
  return render(chrome(ui, at));
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
    expect((await tabs()).map((t) => t.textContent)).toEqual([
      "Fulfil",
      "Transact",
    ]);
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
    const current = (await tabs()).filter(
      (t) => t.getAttribute("aria-current") === "page",
    );
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
    const sections = await screen.findByRole("navigation", {
      name: "Warehouse sections",
    });
    expect(
      within(sections)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual([
      "Locations",
      "Inventory",
      "Inbound / GRN",
      "Outbound",
      "Equipment",
      "Cycle counts",
    ]);
  });

  it("hides a section this user cannot read, while keeping the rest", async () => {
    access.current = grant({ fulfill: ["MOD-33", "MOD-35"] }); // inbound + inventory only
    renderRibbon("/wms");
    const sections = await screen.findByRole("navigation", {
      name: "Warehouse sections",
    });
    expect(
      within(sections)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Inventory", "Inbound / GRN"]);
  });

  it("lists the family's areas when the area you are in has no sections of its own", async () => {
    // `monitor` is single-screen areas throughout. A row that insisted on
    // sections would be a lone dropdown with nothing beside it.
    //
    // MOD-00A carries three of them — the Control Tower, My workspace and
    // Praxis AI — which is also the case that proves an area needs no module of
    // its own to be filed correctly, only a registry entry naming one.
    access.current = grant({ monitor: ["MOD-00A", "MOD-74"] });
    renderRibbon("/");
    const areas = await screen.findByRole("navigation", {
      name: "Monitor areas",
    });
    expect(
      within(areas)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual([
      "Control Tower",
      "My workspace",
      "Praxis AI",
      "Support & feedback",
    ]);
  });

  it("offers the family's other areas without leaving the section row", async () => {
    access.current = SIX_TABS;
    renderRibbon("/operations/files");
    // Exactly "Operations" — the overflow trigger beside it is named "All
    // Operations destinations", and a loose matcher would pass on either.
    expect(
      await screen.findByRole("button", { name: "Operations" }),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByRole("button", { name: "Collapse the ribbon" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      await screen.findByRole("navigation", { name: "Warehouse sections" }),
    ).toBeInTheDocument();
  });

  it("persists a collapse, and hides row B", async () => {
    access.current = TWO_TABS;
    renderRibbon("/wms");
    await userEvent.click(
      await screen.findByRole("button", { name: "Collapse the ribbon" }),
    );

    expect(saved).toEqual([{ ribbonPinned: false }]);
    expect(
      screen.queryByRole("navigation", { name: "Warehouse sections" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Keep the ribbon open" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("reads the saved state back on the next session", async () => {
    access.current = TWO_TABS;
    stored.current = {
      ribbonPinned: false,
      railPins: null,
      towerPins: null,
      railHintSeen: true,
    };
    renderRibbon("/wms");
    await screen.findByRole("navigation", { name: "Workflow" });
    await waitFor(() =>
      expect(
        screen.queryByRole("navigation", { name: "Warehouse sections" }),
      ).toBeNull(),
    );
  });

  /** Unpinned is not "gone": clicking a family still summons row B, which is
   *  what makes collapsing safe to try. */
  it("summons row B from a family click while collapsed", async () => {
    access.current = TWO_TABS;
    stored.current = {
      ribbonPinned: false,
      railPins: null,
      towerPins: null,
      railHintSeen: true,
    };
    renderRibbon("/wms");
    const [fulfil] = await tabs();
    await userEvent.click(fulfil);
    expect(
      await screen.findByRole("navigation", { name: /sections|areas/ }),
    ).toBeInTheDocument();
  });
});

describe("a screen's commands sit in row B, right-aligned", () => {
  function Publisher() {
    useRibbonCommands(
      React.useMemo(
        () => [{ key: "new", label: "New invoice", onSelect: () => {} }],
        [],
      ),
    );
    return null;
  }

  /**
   * Only one screen publishes today, so on an area's landing page and on the
   * five single-screen areas the cluster had no children and rendered an empty
   * box. A region reserved for something that never arrives reads as a missing
   * feature; a nav row with no commands beside it is just a nav row.
   */
  it("renders no cluster at all when the screen has nothing to offer", async () => {
    access.current = SIX_TABS;
    // The Control Tower: a single-screen area, so there is no "overview" link
    // to fall back on and nothing has been published.
    const { container } = renderRibbon("/");
    await screen.findByRole("navigation", { name: "Workflow" });

    const rowB = container.querySelectorAll(".ribbon-row")[1];
    expect(rowB).toBeTruthy();
    expect(rowB.children).toHaveLength(1); // the nav cluster, and nothing beside it
  });

  it("keeps the area overview within reach from a section, which is not nothing", async () => {
    access.current = TWO_TABS;
    renderRibbon("/wms/inventory");
    expect(
      await screen.findByRole("link", { name: /Warehouse overview/ }),
    ).toBeInTheDocument();
  });

  it("shows what the mounted screen published, and drops it when the screen unmounts", async () => {
    access.current = TWO_TABS;
    const { rerender } = renderChrome(
      <>
        <Ribbon pathname="/finance" />
        <Publisher />
      </>,
      "/finance",
    );
    expect(
      await screen.findByRole("button", { name: "New invoice" }),
    ).toBeInTheDocument();

    rerender(chrome(<Ribbon pathname="/finance" />, "/finance"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "New invoice" })).toBeNull(),
    );
  });
});

describe("the icon rail", () => {
  it("is never empty on a first login", async () => {
    access.current = SIX_TABS;
    stored.current = {
      ribbonPinned: null,
      railPins: null,
      towerPins: null,
      railHintSeen: null,
    };
    renderChrome(<IconRail />, "/");

    const rail = await screen.findByRole("navigation", { name: "Shortcuts" });
    // The fixed pair plus a starter set — not "two icons and a plus".
    await waitFor(() =>
      expect(within(rail).getAllByRole("link").length).toBeGreaterThan(3),
    );
    expect(
      within(rail).getByRole("link", { name: "Control Tower" }),
    ).toBeInTheDocument();
    expect(
      within(rail).getByRole("button", { name: /Search/ }),
    ).toBeInTheDocument();
  });

  it("falls back to what this user CAN see when none of the defaults are visible", async () => {
    // A warehouse-only role sees none of Operations / Finance / Comms /
    // Workspace, which is exactly when a naive default set yields an empty rail.
    access.current = grant({ fulfill: ["MOD-33", "MOD-35"] });
    stored.current = {
      ribbonPinned: null,
      railPins: null,
      towerPins: null,
      railHintSeen: null,
    };
    renderChrome(<IconRail />, "/wms");
    const rail = await screen.findByRole("navigation", { name: "Shortcuts" });
    await waitFor(() =>
      expect(
        within(rail).getByRole("link", { name: "Warehouse" }),
      ).toBeInTheDocument(),
    );
  });

  it("keeps a deliberately cleared rail cleared", async () => {
    access.current = SIX_TABS;
    stored.current = {
      ribbonPinned: null,
      railPins: [],
      towerPins: null,
      railHintSeen: true,
    };
    renderChrome(<IconRail />, "/");
    const rail = await screen.findByRole("navigation", { name: "Shortcuts" });
    // Control Tower and the editor survive — "cleared" is not "empty".
    await waitFor(() =>
      expect(within(rail).queryByRole("link", { name: "Finance" })).toBeNull(),
    );
    expect(
      within(rail).getByRole("link", { name: "Control Tower" }),
    ).toBeInTheDocument();
    expect(
      within(rail).getByRole("link", { name: "Edit shortcuts" }),
    ).toBeInTheDocument();
  });

  it("drops a pin whose area the user can no longer reach", async () => {
    access.current = grant({ fulfill: ["MOD-33"] });
    stored.current = {
      ribbonPinned: null,
      railPins: ["wms", "finance"],
      towerPins: null,
      railHintSeen: true,
    };
    renderChrome(<IconRail />, "/wms");
    const rail = await screen.findByRole("navigation", { name: "Shortcuts" });
    await waitFor(() =>
      expect(
        within(rail).getByRole("link", { name: "Warehouse" }),
      ).toBeInTheDocument(),
    );
    expect(within(rail).queryByRole("link", { name: "Finance" })).toBeNull();
  });

  it("nudges the edit affordance once, and records that it has", async () => {
    access.current = SIX_TABS;
    stored.current = {
      ribbonPinned: null,
      railPins: null,
      towerPins: null,
      railHintSeen: null,
    };
    renderChrome(<IconRail />, "/");
    // The rail paints before the preferences land — the hint is decided once
    // BOTH reads settle, which is what stops it firing at a returning user on
    // the strength of the all-null starting state.
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Edit shortcuts" }).className,
      ).toContain("rail-jiggle"),
    );
    expect(saved).toEqual([{ railHintSeen: true }]);
  });

  it("does not nudge a user who has already seen it", async () => {
    access.current = SIX_TABS;
    stored.current = {
      ribbonPinned: null,
      railPins: null,
      towerPins: null,
      railHintSeen: true,
    };
    renderChrome(<IconRail />, "/");
    const edit = await screen.findByRole("link", { name: "Edit shortcuts" });
    await waitFor(() => expect(edit.className).not.toContain("rail-jiggle"));
    expect(saved).toEqual([]);
  });

  /**
   * A FAILED READ IS NOT A FIRST LOGIN, and the two are indistinguishable from
   * the preference object alone: both leave every key null.
   *
   * Get this wrong and a returning user whose preferences read blipped — one
   * timeout, on a screen they were not looking at — loses the one-time hint
   * permanently, because the rail fires it and records it. This is the same
   * defect as the timing one `ready` fixes, reached by a different route: there
   * the answer had not arrived yet, here it never will.
   */
  it("does not spend the hint when the preferences read fails", async () => {
    access.current = SIX_TABS;
    prefsFail.current = true;
    renderChrome(<IconRail />, "/");

    const edit = await screen.findByRole("link", { name: "Edit shortcuts" });
    // The rail still works — the fixed entries do not depend on preferences.
    expect(
      await screen.findByRole("link", { name: "Control Tower" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(edit.className).not.toContain("rail-jiggle"));
    // And nothing was written, so a real first login still gets its hint once
    // the read succeeds.
    expect(saved).toEqual([]);
  });

  it("falls back to the starter pins when the preferences read fails", async () => {
    // Suppressing the hint must not also empty the rail: `railPins` is still
    // null, which the rail answers with its starter set.
    access.current = SIX_TABS;
    prefsFail.current = true;
    renderChrome(<IconRail />, "/");
    const rail = await screen.findByRole("navigation", { name: "Shortcuts" });
    await waitFor(() =>
      expect(within(rail).getAllByRole("link").length).toBeGreaterThan(3),
    );
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
    renderChrome(<BottomNav />, "/");
    const bar = await screen.findByRole("navigation", { name: "Primary" });
    await waitFor(() =>
      expect(within(bar).getAllByRole("button")).toHaveLength(6),
    ); // six families, nothing else
  });

  /**
   * THE BAR IS THE FAMILIES AND NOTHING ELSE. Search used to be a seventh cell
   * here; the title bar's search button is unconditional now (it was `lg:flex`,
   * which left 768–1023px with no touch path at all), so this cell was a second
   * door to the same palette taking a seventh of the thumb width to be it.
   *
   * Pinned as a COUNT, because the regression is additive: the way this comes
   * back is somebody re-adding a cell here rather than editing the strip.
   */
  it("carries no Search cell — the title bar's button is the one search control", async () => {
    access.current = SIX_TABS;
    renderChrome(<BottomNav />, "/");
    const bar = await screen.findByRole("navigation", { name: "Primary" });
    await waitFor(() => expect(bar).not.toHaveAttribute("aria-busy"));
    expect(within(bar).queryByRole("button", { name: /search/i })).toBeNull();
  });

  /**
   * THE BAR MUST SAY WHICH OF THREE THINGS HAPPENED. It only read `access`, and
   * `buildRibbon(NO_ACCESS)` is empty — so "still loading", "the read failed"
   * and "you genuinely have nothing" looked identical. That was already the
   * worst thing to get wrong on a phone, where the bottom bar IS the
   * navigation; with the Search cell gone the empty case renders nothing at
   * all, so the three states carry the whole message.
   */
  it("reads as unfinished while the permissions read is in flight", async () => {
    access.current = SIX_TABS;
    accessPending.current = true;
    renderChrome(<BottomNav />, "/");

    const bar = await screen.findByRole("navigation", { name: "Primary" });
    expect(bar).toHaveAttribute("aria-busy", "true");
    // Nothing to press at all — and crucially the placeholders are not buttons,
    // so a thumb cannot land on a control that does nothing.
    expect(within(bar).queryAllByRole("button")).toHaveLength(0);
    expect(within(bar).getByText("Loading navigation…")).toBeInTheDocument();
  });

  it("offers the unfiltered drawer when the read comes back with nothing", async () => {
    // Whether that is a failure or an honest empty answer, stranding a phone
    // user with a blank bar is not an answer. The drawer lists every area in the
    // product and is not permission-filtered — which is why it is the branch
    // that had to survive Search leaving: it is the only route out of an empty
    // permissions read, and it is now the ONLY control in the bar when one
    // happens.
    const onMenu = vi.fn();
    access.current = grant({});
    renderChrome(<BottomNav onMenu={onMenu} />, "/");

    const bar = await screen.findByRole("navigation", { name: "Primary" });
    await waitFor(() => expect(bar).not.toHaveAttribute("aria-busy"));
    expect(within(bar).getAllByRole("button")).toHaveLength(1);
    await userEvent.click(
      within(bar).getByRole("button", { name: /All areas/ }),
    );
    expect(onMenu).toHaveBeenCalled();
  });

  it("shows the real bar once the read lands, with no placeholders left", async () => {
    access.current = TWO_TABS;
    renderChrome(<BottomNav />, "/");
    const bar = await screen.findByRole("navigation", { name: "Primary" });
    await waitFor(() =>
      expect(within(bar).getAllByRole("button")).toHaveLength(2),
    ); // two families
    expect(bar).not.toHaveAttribute("aria-busy");
    expect(within(bar).queryByText("Loading navigation…")).toBeNull();
  });

  it("opens a family into a sheet of its destinations", async () => {
    access.current = TWO_TABS;
    renderChrome(<BottomNav />, "/wms");
    const bar = await screen.findByRole("navigation", { name: "Primary" });
    // The SKELETON nav carries `aria-label="Primary"` too, so findByRole
    // resolves on the loading bar and a synchronous getByRole for a tab races
    // the access read. Every sibling test here waits first; this one did not,
    // which is why it passed locally and failed on a slow CI runner.
    await waitFor(() => expect(bar).not.toHaveAttribute("aria-busy"));
    await userEvent.click(within(bar).getByRole("button", { name: /Fulfil/ }));

    const sheet = await screen.findByRole("dialog");
    expect(
      within(sheet).getByRole("link", { name: "Warehouse" }),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole("link", { name: "Cycle counts" }),
    ).toBeInTheDocument();
  });
});
