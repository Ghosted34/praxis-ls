/**
 * Quick actions — the shared list, and the one thing retiring a surface can
 * quietly cost.
 *
 * The `QuickActionsMenu` these tests used to cover is gone: a burst icon in the
 * title bar named nothing, and it put Messages in the header while the icon
 * rail already carried Messages. What must NOT go with it is the unread count
 * it was the only home for on desktop — that assertion now lives in
 * `app/layout/icon-rail.test.tsx`, on the rail cell that inherited it.
 *
 * What is left here is the list itself, which is shared precisely so the touch
 * cluster and the rail cannot drift into offering different destinations.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useQuickActions } from "@/components/quick-actions";

// The AI action is tenant-gated; that gate is not what these assertions are
// about.
vi.mock("@/components/ai-actions", () => ({ useAiEnabled: () => true }));

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("useQuickActions", () => {
  it("is the ONE list both surfaces render", () => {
    // Shared so the touch cluster and the icon rail cannot drift into offering
    // different destinations — which is how this app ended up with three icon
    // sets and four card recipes (F6).
    function Probe() {
      const actions = useQuickActions();
      return (
        <ul>
          {actions.map((a) => (
            <li key={a.key}>{a.label}</li>
          ))}
        </ul>
      );
    }
    wrap(<Probe />);
    expect(screen.getAllByRole("listitem").map((n) => n.textContent)).toEqual([
      "Praxis AI",
      "Messages",
      "Help",
    ]);
  });

  it("keys Messages as `msg`, which is what the rail badges", () => {
    // The rail decides which cell carries the unread count by key. A rename
    // here would silently take the badge off Messages and put it nowhere —
    // exactly the failure this whole change is fixing.
    function Probe() {
      const actions = useQuickActions();
      return <span data-testid="keys">{actions.map((a) => a.key).join(",")}</span>;
    }
    wrap(<Probe />);
    expect(screen.getByTestId("keys").textContent).toBe("ai,msg,help");
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
