/**
 * The other three surfaces that were still offering the whole application.
 *
 * The ⌘K palette has its own file because it is the widest of them; these are
 * the rest of the sweep, and they are grouped because they are one bug in three
 * places — a hard-coded list of destinations written before the shell knew what
 * a grant was.
 *
 *   SETTINGS HUB      twenty-four cards, including IAM, the module catalogue,
 *                     payment gateways and portal access.
 *   APP LAUNCHER      twelve tiles on the landing screen, four of them Finance.
 *   QUICK ACTIONS     Messages, in the title bar, the icon rail AND the touch
 *                     cluster — so one unfiltered entry is three ways to a 403.
 *
 * Each one also gets the negative: nothing is filtered while the permissions
 * read is unresolved, because the empty starting value is indistinguishable
 * from a user who genuinely has nothing, and a Settings page that renders as a
 * bare heading for a second on every first login is a worse bug than the one
 * being fixed.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import type { NavAccess } from "@/lib/nav-access";
import { ShellContext, type ShellContextValue } from "@/app/layout/shell-context";
import { EMPTY_SHELL_PREFS } from "@/lib/preferences";

vi.mock("@/app/auth/auth-context", async () => {
  const actual = await vi.importActual<typeof import("@/app/auth/auth-context")>("@/app/auth/auth-context");
  return { ...actual, useAuth: () => ({ user: { user_id: "u-1", ai_enabled: false }, status: "authed" as const }) };
});

import { SettingsHub } from "./settings-hub";
import { AppLauncher } from "@/features/dashboard/components/app-launcher";
import { useQuickActions } from "@/components/quick-actions";

function shell(modules: string[], resolved = true): ShellContextValue {
  const access: NavAccess = { modules, groups: [], byGroup: {}, isCeo: false, version: "v" };
  return { access, ready: resolved, resolved, prefs: EMPTY_SHELL_PREFS, setPrefs: () => {}, grantNotice: null, dismissGrantNotice: () => {} };
}

function mount(ui: React.ReactElement, value: ShellContextValue) {
  return render(
    <MemoryRouter>
      <ShellContext.Provider value={value}>{ui}</ShellContext.Provider>
    </MemoryRouter>,
  );
}

/** A warehouse role — no IAM (MOD-67), no settings (MOD-70), no finance. */
const WAREHOUSE = ["MOD-33", "MOD-34", "MOD-35", "MOD-36", "MOD-37", "MOD-38"];

describe("the settings hub offers only the editors you can open", () => {
  it("drops a card into a module the user lacks", () => {
    mount(<SettingsHub />, shell(WAREHOUSE));
    expect(screen.queryByText("IAM & Security")).toBeNull();
    expect(screen.queryByText("Module Catalogue")).toBeNull();
  });

  it("keeps a card the user can open", () => {
    mount(<SettingsHub />, shell([...WAREHOUSE, "MOD-67"]));
    expect(screen.getByText("IAM & Security")).toBeInTheDocument();
  });

  it("drops a section whose cards are all gone, rather than leaving a bare heading", () => {
    // The same rule `buildRibbon` applies to an empty family: a heading over
    // nothing tells the user something is there and then refuses to say what.
    mount(<SettingsHub />, shell(WAREHOUSE));
    expect(screen.queryByText("Administration")).toBeNull();
  });

  it("never collapses to a bare heading, even for a user with no grants at all", () => {
    // WHY THIS CANNOT GO EMPTY TODAY, which is worth pinning rather than
    // assuming: "My Appearance" is registered with `module_key: null` — it is
    // the personal typography screen, deliberately ungated, and the shell's
    // account menu already points every user at it. So the filtered grid always
    // keeps at least that one card.
    //
    // The empty branch in the component is still there for the day that stops
    // being true; it is not reachable from the current registry, and a test
    // that forced it would be testing a fixture rather than the screen.
    mount(<SettingsHub />, shell([]));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("My Appearance")).toBeInTheDocument();
    expect(screen.queryByText("IAM & Security")).toBeNull();
  });

  it("filters nothing while the permissions read is unresolved", () => {
    mount(<SettingsHub />, shell([], false));
    expect(screen.getByText("IAM & Security")).toBeInTheDocument();
  });

  it("is axe-clean once filtered", async () => {
    const { container } = mount(<SettingsHub />, shell(WAREHOUSE));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("the Control Tower launcher offers only the apps you can open", () => {
  it("drops the finance tiles from a warehouse role", () => {
    mount(<AppLauncher onBrowseAll={() => {}} />, shell(WAREHOUSE));
    expect(screen.queryByText("Invoicing")).toBeNull();
    expect(screen.queryByText("OHADA ledger")).toBeNull();
    expect(screen.queryByText("Tax centre")).toBeNull();
    expect(screen.getByText("Warehouse")).toBeInTheDocument();
  });

  it("keeps them for a role that holds the grant", () => {
    mount(<AppLauncher onBrowseAll={() => {}} />, shell([...WAREHOUSE, "MOD-51"]));
    expect(screen.getByText("Invoicing")).toBeInTheDocument();
  });

  it("filters nothing while the permissions read is unresolved", () => {
    mount(<AppLauncher onBrowseAll={() => {}} />, shell([], false));
    expect(screen.getByText("Invoicing")).toBeInTheDocument();
  });
});

describe("quick actions", () => {
  function Probe() {
    const actions = useQuickActions();
    return <ul>{actions.map((a) => <li key={a.key}>{a.label}</li>)}</ul>;
  }

  it("drops Messages when Smart Comms is not this user's", () => {
    mount(<Probe />, shell(WAREHOUSE));
    expect(screen.queryByText("Messages")).toBeNull();
  });

  it("keeps Help, which is ungated on purpose — the way out is not behind a grant", () => {
    mount(<Probe />, shell([]));
    expect(screen.getByText("Help")).toBeInTheDocument();
  });

  it("keeps Messages for a user who holds Smart Comms", () => {
    mount(<Probe />, shell(["MOD-64"]));
    expect(screen.getByText("Messages")).toBeInTheDocument();
  });
});
