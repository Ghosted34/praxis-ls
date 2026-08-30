import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ErrorState,
  EmptyState,
  LoadingState,
  NotFoundState,
  MilestoneStatePill,
  ModeIcon,
  isClosed,
  milestoneState,
} from "@/components/state";
import { en, fr } from "@/lib/i18n-dict";

/**
 * The state vocabulary, pinned.
 *
 * These components exist because §3.3 says every surface must answer the same
 * four questions the same way; a test that only rendered them would not protect
 * that. What is asserted here is the set of decisions somebody could quietly
 * undo — not-found staying distinct from empty, the request id appearing only
 * where it means something, and the three milestone states staying visually
 * distinct — because each of them looks harmless as a diff.
 */

describe("not-found is not a kind of empty", () => {
  it("uses a different container and a different role", () => {
    // "No shipment matches that reference" and "this file has no stages yet"
    // are different facts. If one is ever implemented as the other, this is the
    // assertion that says so.
    const { container: empty } = render(<EmptyState title="Nothing here" />);
    const emptyBox = empty.firstElementChild as HTMLElement;
    const { container: nf } = render(<NotFoundState title="No match" />);
    const nfBox = nf.firstElementChild as HTMLElement;

    expect(emptyBox.className).toContain("border-dashed");
    expect(nfBox.className).not.toContain("border-dashed");
    expect(nfBox).toHaveAttribute("role", "status");
  });

  it("shows a hint and an action when given them", () => {
    render(
      <NotFoundState
        title="No match"
        hint="Check the reference on your documents"
        action={<button type="button">{en.common.retry}</button>}
      />,
    );
    expect(screen.getByText("Check the reference on your documents")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.common.retry })).toBeInTheDocument();
  });
});

describe("the error state", () => {
  it("prints the request id when there is one", () => {
    // The one diagnostic detail this app shows a stranger, and the reason it is
    // safe: it identifies a request in our logs and nothing about the reader.
    render(<ErrorState message="We could not load this" requestId="abc-123" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("abc-123")).toBeInTheDocument();
    expect(screen.getByText(en.states.requestRef)).toBeInTheDocument();
  });

  it("says nothing about a request id when there is none", () => {
    render(<ErrorState message="We could not load this" />);
    expect(screen.queryByText(en.states.requestRef)).not.toBeInTheDocument();
  });

  it("renders the retry the caller supplies", () => {
    // An error with no way forward is a dead end, and a dead end on a marketing
    // page is a lost enquiry.
    render(
      <ErrorState
        message="Failed"
        action={<button type="button">{en.common.retry}</button>}
      />,
    );
    expect(screen.getByRole("button", { name: en.common.retry })).toBeInTheDocument();
  });
});

describe("the loading state", () => {
  it("is a busy region around the caller's own shape", () => {
    // It cannot invent a skeleton — only the page knows what is coming — so it
    // contributes the live region and lets the page supply the blocks.
    render(
      <LoadingState label="Looking up">
        <div data-testid="shape" />
      </LoadingState>,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAttribute("aria-label", "Looking up");
    expect(screen.getByTestId("shape")).toBeInTheDocument();
  });
});

describe("milestoneState", () => {
  it("reads public_state, which is the authority", () => {
    expect(milestoneState({ public_state: "CURRENT" })).toBe("CURRENT");
    expect(milestoneState({ public_state: "COMPLETED" })).toBe("COMPLETED");
    expect(milestoneState({ public_state: "UPCOMING" })).toBe("UPCOMING");
  });

  it("falls back to the flags when the word is missing", () => {
    expect(milestoneState({ is_complete: true })).toBe("COMPLETED");
    expect(milestoneState({ is_current: true })).toBe("CURRENT");
  });

  it("answers UPCOMING for a word it does not know", () => {
    // The state that promises the least. A milestone is never stateless, and it
    // is never upgraded by a payload we did not understand.
    expect(milestoneState({ public_state: "DELAYED" })).toBe("UPCOMING");
    expect(milestoneState({})).toBe("UPCOMING");
  });
});

describe("the three states are visually distinct", () => {
  it("gives each its own tone class, not three shades of one", () => {
    const tone = (state: "COMPLETED" | "CURRENT" | "UPCOMING") => {
      const { container } = render(<MilestoneStatePill state={state} />);
      return (container.firstElementChild as HTMLElement).className;
    };
    const classes = [tone("COMPLETED"), tone("CURRENT"), tone("UPCOMING")];
    expect(new Set(classes).size).toBe(3);
  });

  it("labels them from the dictionary, in both languages", () => {
    // The portal renders the same chain; a stage that reads differently once a
    // client signs in is the inconsistency §3.3 exists to prevent.
    expect(en.states.milestone.current).toBeTruthy();
    expect(fr.states.milestone.current).toBeTruthy();
    expect(Object.keys(en.states.milestone).sort()).toEqual(
      Object.keys(fr.states.milestone).sort(),
    );
  });
});

describe("isClosed", () => {
  it("is true only when the whole file is complete", () => {
    expect(isClosed("COMPLETED")).toBe(true);
    expect(isClosed("IN_PROGRESS")).toBe(false);
    expect(isClosed("PENDING")).toBe(false);
    expect(isClosed(null)).toBe(false);
  });
});

describe("ModeIcon", () => {
  it("draws something for every mode the API can send", () => {
    for (const mode of ["SEA", "AIR", "RAIL", "ROAD", "WAREHOUSE", "CUSTOMS", "OTHER"]) {
      const { container } = render(<ModeIcon mode={mode} />);
      expect(container.querySelector("svg")).toBeTruthy();
    }
  });

  it("falls back to a neutral glyph rather than nothing", () => {
    // Service types are user-creatable; a key we do not recognise must render a
    // box, never a ship.
    const { container } = render(<ModeIcon mode="SOMETHING_NEW" />);
    expect(container.querySelector("svg")).toBeTruthy();
    const { container: none } = render(<ModeIcon mode={null} />);
    expect(none.querySelector("svg")).toBeTruthy();
  });
});
