/**
 * Callout + RowActions — the two primitives Phase 4 extracted.
 *
 * Both exist because the audit's F6 mechanism ("the same UI reimplemented
 * instead of shared") was still producing copies: five hand-rolled result
 * banners built out of raw `emerald`/`rose`, and fourteen copies of the same
 * row-action wrapper — two of which had even been given local names in separate
 * feature folders, invisible to each other.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { Callout } from "./callout";
import { RowActions } from "./row-actions";

describe("Callout", () => {
  it("announces the outcome — the async arrival signal F13 found missing", () => {
    render(<Callout tone="ok">Queued 42 messages.</Callout>);
    const box = screen.getByRole("status");
    expect(box).toHaveTextContent("Queued 42 messages.");
  });

  /**
   * A failed hash verification should interrupt; a "Saved." should not. The
   * audit counted three live regions in ~40,000 lines and no arrival signal for
   * any async result — this is the distinction that makes one worth adding.
   */
  it("interrupts for failures and stays polite for successes", () => {
    const { unmount } = render(<Callout tone="ok">Saved.</Callout>);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    unmount();

    render(<Callout tone="bad">Hash mismatch.</Callout>);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-live",
      "assertive",
    );
  });

  it("warns assertively too — a warning nobody hears is the audit's own theme", () => {
    render(<Callout tone="warn">Rate limit close.</Callout>);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-live",
      "assertive",
    );
  });

  /**
   * WCAG §1.4.1: colour is never the only carrier. Each tone ships a glyph, and
   * the glyph is aria-hidden because the TEXT is what says what happened —
   * announcing "check mark" adds nothing to "Saved."
   */
  it("does not carry meaning by colour alone, and does not announce the glyph", () => {
    const { container } = render(
      <Callout tone="ok" title="Verified">
        No tampering.
      </Callout>,
    );
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg).toHaveAttribute("aria-hidden");
    expect(screen.getByRole("status")).toHaveTextContent("Verified");
  });

  it("renders an action when one is given", async () => {
    const onRetry = vi.fn();
    render(
      <Callout
        tone="bad"
        title="Test failed"
        action={<button onClick={onRetry}>Retry</button>}
      >
        The key was rejected.
      </Callout>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("has no axe violations in any tone", async () => {
    for (const tone of ["ok", "warn", "bad", "info"] as const) {
      const { container, unmount } = render(
        <Callout tone={tone} title="Result">
          Something happened.
        </Callout>,
      );
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });
});

describe("RowActions", () => {
  /**
   * THE JOB. In a table whose rows navigate on click, the action buttons must
   * not also trigger the row — "Delete" that opens the record instead is worse
   * than no shortcut at all.
   */
  it("stops a button click from reaching the row's handler", async () => {
    const onRow = vi.fn();
    const onDelete = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <div onClick={onRow}>
        <RowActions>
          <button onClick={onDelete}>Delete</button>
        </RowActions>
      </div>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onRow).not.toHaveBeenCalled();
  });

  it("leaves its children as ordinary buttons in the tab order", async () => {
    render(
      <RowActions>
        <button>Edit</button>
        <button>Archive</button>
      </RowActions>,
    );
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <RowActions>
        <button>Edit</button>
      </RowActions>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
