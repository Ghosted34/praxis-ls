/**
 * The offline UI.
 *
 * Two things are worth pinning here and neither is cosmetic:
 *
 *   1. `ScreenError` must show the CONNECTION screen only when the connection
 *      is actually down, and otherwise show the server's own message unchanged.
 *      Getting this backwards hides real errors behind a game.
 *   2. Every generated puzzle is solvable and none starts solved. An unwinnable
 *      board turns the distraction back into the frustration it was meant to
 *      relieve, and it is exactly the kind of defect that only shows up on the
 *      one random seed nobody tried by hand.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe } from "jest-axe";
import { ScreenError } from "./screen-error";
import { SupplyChainPuzzle } from "./supply-chain-puzzle";
import {
  buildGrid,
  freshGrid,
  connectedFromSource,
  isSolved,
} from "./puzzle-grid";
import {
  reportUnreachable,
  probeNow,
  __resetConnectionForTests,
} from "@/lib/connection";

beforeEach(() => {
  __resetConnectionForTests();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  );
});

afterEach(() => {
  __resetConnectionForTests();
  vi.unstubAllGlobals();
});

describe("ScreenError", () => {
  it("shows the server's own message while the connection is fine", () => {
    render(<ScreenError message="You don't have permission to do this." />);

    expect(
      screen.getByText("You don't have permission to do this."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Can't reach the server/),
    ).not.toBeInTheDocument();
  });

  it("shows the connection screen once the connection is down", () => {
    reportUnreachable();
    render(
      <ScreenError message="Something went wrong." what="Corporate entities" />,
    );

    expect(screen.getByText("Can't reach the server")).toBeInTheDocument();
    expect(
      screen.getByText(/Corporate entities couldn't load/),
    ).toBeInTheDocument();
    // The generic string the user complained about is gone, not merely reworded.
    expect(screen.queryByText("Something went wrong.")).not.toBeInTheDocument();
  });

  it("always offers a manual retry, never only the automatic poll", () => {
    reportUnreachable();
    const onRetry = vi.fn();
    render(<ScreenError message="x" onRetry={onRetry} />);

    expect(
      screen.getByRole("button", { name: /retry connection/i }),
    ).toBeInTheDocument();
  });

  it("keeps the puzzle behind an opt-in, and remembers the choice", () => {
    reportUnreachable();
    const { unmount } = render(<ScreenError message="x" />);

    // A finance director looking at a failed register should not be met by a
    // game they did not ask for.
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /beat the downtime/i }));
    expect(screen.getByRole("grid")).toBeInTheDocument();
    unmount();

    render(<ScreenError message="x" />);
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("re-runs the screen's fetch when the connection comes back", async () => {
    // THE REGRESSION THIS PINS. The auto-retry used to live inside
    // `ConnectionLost`, which unmounts the instant the status flips — so the
    // effect never ran, and the screen fell back to a red box still telling the
    // user they were offline, on a working connection, until they clicked
    // something.
    reportUnreachable();
    const onRetry = vi.fn();
    render(
      <ScreenError message="x" what="Corporate entities" onRetry={onRetry} />,
    );
    expect(screen.getByText("Can't reach the server")).toBeInTheDocument();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200 } as Response),
    );
    await act(async () => {
      await probeNow();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations while offline", async () => {
    reportUnreachable();
    const { container } = render(
      <ScreenError message="x" what="Corporate entities" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("the puzzle generator", () => {
  it("produces a solvable board every time", () => {
    // The generator derives the tiles FROM a path, so the un-rotated board is
    // the solution by construction. Asserting that directly is stronger than
    // any sampling of the rendered grid — and it is what makes an unwinnable
    // board impossible rather than merely unlikely.
    for (let i = 0; i < 300; i++) {
      const grid = buildGrid().map((row) =>
        row.map((cell) => ({ ...cell, rot: 0 })),
      );
      expect(isSolved(connectedFromSource(grid))).toBe(true);
    }
  });

  it("never hands the player a board that is already finished", () => {
    for (let i = 0; i < 300; i++) {
      expect(isSolved(connectedFromSource(freshGrid()))).toBe(false);
    }
  });
});

describe("SupplyChainPuzzle", () => {
  it("renders a full grid and counts a rotation as a move", () => {
    render(<SupplyChainPuzzle />);

    expect(screen.getAllByRole("gridcell")).toHaveLength(16);
    expect(screen.getByText("0 moves")).toBeInTheDocument();

    const tile = screen
      .getAllByRole("gridcell")
      .find((el) => !(el as HTMLButtonElement).disabled) as HTMLElement;
    fireEvent.click(tile);
    expect(screen.getByText("1 move")).toBeInTheDocument();
  });

  it("locks the warehouse and the truck", () => {
    render(<SupplyChainPuzzle />);
    expect(screen.getByRole("gridcell", { name: "Warehouse" })).toBeDisabled();
    expect(
      screen.getByRole("gridcell", { name: "Delivery truck" }),
    ).toBeDisabled();
  });

  it("puts exactly one tile in the tab order", () => {
    // Sixteen tab stops between the puzzle and the Retry button would make an
    // optional distraction an obstacle for the keyboard user trying to reach
    // the control that actually fixes their problem.
    render(<SupplyChainPuzzle />);
    const focusable = screen
      .getAllByRole("gridcell")
      .filter((el) => el.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<SupplyChainPuzzle />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
