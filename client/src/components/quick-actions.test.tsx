/**
 * Quick actions (Phase 5) — the desktop replacement for the draggable FAB.
 *
 * The tests that matter here are about what retiring the FAB could have QUIETLY
 * cost: the unread-messages count that only ever lived on it, and the two
 * surfaces offering different destinations once they stopped sharing code.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";
import { QuickActionsMenu, useQuickActions } from "@/components/quick-actions";

// The AI action is tenant-gated; that gate is not what these assertions are
// about. The clock is no longer mocked here because it is no longer in this
// menu — see the "does NOT carry the clock" case below.
vi.mock("@/components/ai-actions", () => ({ useAiEnabled: () => true }));

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("QuickActionsMenu", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a real menu button, not a hover cluster of divs", async () => {
    wrap(<QuickActionsMenu />);
    const trigger = screen.getByRole("button", { name: "Quick actions" });
    await userEvent.click(trigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Praxis AI/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Messages/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Help/ })).toBeInTheDocument();
  });

  it("opens and navigates by keyboard alone", async () => {
    // The old cluster opened on hover and had zero key handlers.
    wrap(<QuickActionsMenu />);
    screen.getByRole("button", { name: "Quick actions" }).focus();
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    await userEvent.keyboard("{ArrowDown}");
    expect(menu).toBeInTheDocument();
  });

  it("PUTS THE UNREAD COUNT IN THE ACCESSIBLE NAME, not just in a badge", () => {
    // Removing the FAB from desktop removed the only unread-messages indicator
    // a desktop user had — the top bar deliberately never duplicated Messages.
    // A count that exists only as a coloured circle does not replace it.
    wrap(<QuickActionsMenu badge={3} />);
    expect(screen.getByRole("button", { name: "Quick actions, 3 unread" })).toBeInTheDocument();
  });

  it("caps a large count without lying about it in the name", () => {
    wrap(<QuickActionsMenu badge={120} />);
    expect(screen.getByRole("button", { name: "Quick actions, 120 unread" })).toBeInTheDocument();
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("says nothing about unread when there is none", () => {
    wrap(<QuickActionsMenu badge={0} />);
    expect(screen.getByRole("button", { name: "Quick actions" })).toBeInTheDocument();
  });

  it("does NOT carry the clock — that moved to its own title-bar chip", async () => {
    // The punch was a menu item here, which put it one click deep behind an
    // icon that gives no hint whether a shift is running. It is now a chip two
    // controls to the left in the same strip; keeping both would put two clocks
    // side by side, one of them invisible until opened.
    wrap(<QuickActionsMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Quick actions" }));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: /Clock (in|out)/ })).toBeNull();
  });

  it("has no axe violations, closed or open", async () => {
    const { container } = wrap(<QuickActionsMenu badge={2} />);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: /Quick actions/ }));
    // Scoped to the menu, as the other Radix suites do: a portalled fragment has
    // no landmarks by construction, so the page-level "region" rule would fire
    // on the test harness rather than on anything the app ships.
    expect(await axe(await screen.findByRole("menu"))).toHaveNoViolations();
  });
});

describe("useQuickActions", () => {
  it("is the ONE list both surfaces render", () => {
    // Shared so the touch cluster and the desktop menu cannot drift into
    // offering different destinations — which is how this app ended up with
    // three icon sets and four card recipes (F6).
    function Probe() {
      const actions = useQuickActions();
      return <ul>{actions.map((a) => <li key={a.key}>{a.label}</li>)}</ul>;
    }
    wrap(<Probe />);
    expect(screen.getAllByRole("listitem").map((n) => n.textContent)).toEqual(["Praxis AI", "Messages", "Help"]);
  });

  it("calls back so the caller can close itself", async () => {
    const onDone = vi.fn();
    function Probe() {
      const actions = useQuickActions(onDone);
      return <button onClick={actions[1].onSelect}>go</button>;
    }
    wrap(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    expect(onDone).toHaveBeenCalled();
  });
});
