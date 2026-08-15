/**
 * ⌘K must not offer a door it knows is locked.
 *
 * WHY THIS SURFACE IN PARTICULAR. The ribbon and the rail were made
 * permission-aware first, which is the right order — they are what a user
 * looks at — and it left the palette as the widest unfiltered offer in the
 * product. It carries five curated jumps, every screen in NAV on a keystroke,
 * and four hard-coded actions, three of which land in Finance or Operations. A
 * warehouse role could reach four separate 403s from here without ever having
 * seen a menu that offered them, and each one looks like the product breaking
 * rather than the product refusing.
 *
 * The negative case at the bottom is the one that keeps this honest. Filtering
 * against an unanswered permissions read is indistinguishable from filtering
 * against a user who has nothing — and a palette that opens EMPTY on a slow
 * first login is a worse bug than the one this fixes, because the user
 * concludes the feature is broken and stops pressing the key.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import type { NavAccess } from "@/lib/nav-access";
import {
  ShellContext,
  type ShellContextValue,
} from "@/app/layout/shell-context";
import { EMPTY_SHELL_PREFS } from "@/lib/preferences";
import { CommandPalette } from "./command-palette";

/** The NAV shape the shell hands the palette. Two areas the fixtures below can
 *  grant independently. */
const GROUPS = [
  { heading: "Overview", items: [{ to: "/", label: "Control Tower" }] },
  {
    heading: "Finance",
    items: [
      { to: "/finance/invoices", label: "Invoices" },
      { to: "/finance/receivables", label: "Receivables" },
    ],
  },
  {
    heading: "Warehouse",
    items: [{ to: "/wms/inventory", label: "Inventory" }],
  },
];

function shell(modules: string[], resolved = true): ShellContextValue {
  const access: NavAccess = {
    modules,
    groups: [],
    byGroup: {},
    isCeo: false,
    version: "v",
  };
  return {
    access,
    ready: resolved,
    resolved,
    prefs: EMPTY_SHELL_PREFS,
    setPrefs: () => {},
    grantNotice: null,
    dismissGrantNotice: () => {},
  };
}

function open(value: ShellContextValue) {
  return render(
    <MemoryRouter>
      <ShellContext.Provider value={value}>
        <CommandPalette open groups={GROUPS} onClose={() => {}} />
      </ShellContext.Provider>
    </MemoryRouter>,
  );
}

const labels = () =>
  within(screen.getByRole("dialog"))
    .getAllByRole("button")
    .map((b) => b.textContent?.trim() ?? "");

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = () => {};
});

describe("the palette offers only what this user can open", () => {
  it("drops a curated jump into a module the user lacks", async () => {
    // The empty-query state. `/finance` and `/operations` are two of the five
    // curated shortcuts, and a warehouse role holds neither.
    open(shell(["MOD-33", "MOD-35"]));
    const shown = labels();
    expect(shown).not.toContain("Finance & Treasury");
    expect(shown).not.toContain("Operations");
    // …and keeps what they CAN open, rather than collapsing to nothing.
    expect(shown).toContain("Warehouse");
  });

  it("drops a typed screen result into a module the user lacks", async () => {
    open(shell(["MOD-33", "MOD-35"]));
    await userEvent.type(screen.getByRole("textbox"), "invoice");
    expect(screen.queryByText("Invoices")).toBeNull();
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it("keeps a typed screen result the user CAN open", async () => {
    open(shell(["MOD-35"]));
    await userEvent.type(screen.getByRole("textbox"), "inventory");
    expect(screen.getByText("Inventory")).toBeInTheDocument();
  });

  it("drops an ACTION whose destination is closed", async () => {
    // "New invoice" and "File a tax return" are hard-coded routes into Finance.
    open(shell(["MOD-33", "MOD-35"]));
    const shown = labels();
    expect(shown).not.toContain("New invoice");
    expect(shown).not.toContain("File a tax return");
    expect(shown).not.toContain("New operation file");
  });

  it("keeps an action whose destination is open", async () => {
    open(shell(["MOD-51"]));
    expect(labels()).toContain("New invoice");
  });

  it("keeps 'Ask Praxis AI…', which is not a route at all", async () => {
    // It opens a panel, and it is gated by the TENANT's AI flag rather than by
    // a module. A route filter it does not participate in must not remove it.
    open(shell([]));
    expect(labels()).toContain("Ask Praxis AI…");
  });

  it("gives a CEO with no grant rows everything, because rbac.js does", async () => {
    const value = shell([]);
    open({ ...value, access: { ...value.access, isCeo: true } });
    expect(labels()).toContain("Finance & Treasury");
  });

  it("FILTERS NOTHING while the permissions read is unresolved", async () => {
    // The empty starting value is indistinguishable from a user with no access.
    // Over-offering for one frame is recoverable; a palette that opens empty on
    // a first login teaches the user the feature is broken.
    open(shell([], false));
    const shown = labels();
    expect(shown).toContain("Finance & Treasury");
    expect(shown).toContain("New invoice");
  });

  it("is axe-clean once filtered", async () => {
    const { container } = open(shell(["MOD-33", "MOD-35"]));
    expect(await axe(container)).toHaveNoViolations();
  });
});
