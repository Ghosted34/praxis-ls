/**
 * The open-record bond: `<IndexRow>` and `<SplitPane activeKind>`.
 *
 * WHY THESE ASSERTIONS. The defect this pair fixes was not a crash and no test
 * could have caught it by exercising behaviour — every one of the sixteen 360
 * screens "worked", clicked, fetched and rendered. What was broken was whether
 * a person could SEE which record was open, and the failing state was
 * `bg-primary/10`: a class that compiles to NO CSS at all, because `primary` is
 * an opaque `var(--primary)` with no `<alpha-value>` slot for the `/10` to go
 * in. The markup looked correct and the row had no ground.
 *
 * So the assertions are about the two things that can actually be regressed
 * back: the accessibility state (`aria-current`, which was absent on all
 * thirteen and is what a screen reader has instead of a rail), and the presence
 * of a REAL ground plus the accent rail rather than a wash. A test that only
 * checked "renders children" would have passed against the broken version.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { IndexRow } from "@/components/ui/index-row";
import { SplitPane } from "@/components/ui/split-pane";

describe("IndexRow", () => {
  it("MARKS THE OPEN ROW IN THE ACCESSIBILITY TREE — absent before this", async () => {
    render(
      <>
        <IndexRow selected onClick={vi.fn()}>
          Project &amp; Break-bulk
        </IndexRow>
        <IndexRow selected={false} onClick={vi.fn()}>
          Warehousing
        </IndexRow>
      </>,
    );
    expect(
      screen.getByRole("button", { name: "Project & Break-bulk" }),
    ).toHaveAttribute("aria-current", "true");
    // Not "false" — an unselected row must be absent from the state, not
    // announced as "not current" on every row the reader passes.
    expect(
      screen.getByRole("button", { name: "Warehousing" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("gives the open row a real ground AND the accent rail, not a tint", () => {
    render(
      <IndexRow selected onClick={vi.fn()}>
        Open one
      </IndexRow>,
    );
    const row = screen.getByRole("button");
    // The surface step — `.index-row-open` is --accent with the tenant's
    // --primary at 15% over it, which is the only combination that steps
    // clearly from --background in BOTH themes (see index.css).
    expect(row.className).toContain("index-row-open");
    // …and the rail, which is what survives a tenant repainting the surfaces.
    expect(row.className).toContain("before:bg-primary");
    // The class that rendered NOTHING is gone for good. Any `/NN` on a core
    // token is silently dropped by Tailwind (only ok/warn/bad/brand-* declare
    // `<alpha-value>`), so a ground expressed that way is not a faint ground —
    // it is no ground. Reach for color-mix in index.css instead.
    expect(row.className).not.toMatch(
      /\b(bg|text|border)-(primary|accent|muted|card)\/\d+/,
    );
  });

  it("leaves the closed row without a rail", () => {
    render(
      <IndexRow selected={false} onClick={vi.fn()}>
        Closed one
      </IndexRow>,
    );
    expect(screen.getByRole("button").className).toContain(
      "before:bg-transparent",
    );
  });

  it("is a button, so it opens from the keyboard", async () => {
    const onClick = vi.fn();
    render(
      <IndexRow selected={false} onClick={onClick}>
        Row
      </IndexRow>,
    );
    await userEvent.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalled();
  });

  it("takes LAYOUT from the caller without losing its own state classes", () => {
    render(
      <IndexRow selected onClick={vi.fn()} className="flex-col gap-0.5">
        Stacked
      </IndexRow>,
    );
    const row = screen.getByRole("button");
    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("index-row-open");
  });

  it("has no axe violations in either state", async () => {
    const { container } = render(
      <div>
        <IndexRow selected onClick={vi.fn()}>
          A
        </IndexRow>
        <IndexRow selected={false} onClick={vi.fn()}>
          B
        </IndexRow>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("SplitPane — the pane's half of the bond", () => {
  const renderPane = (props: Partial<React.ComponentProps<typeof SplitPane>>) =>
    render(
      <SplitPane storageKey="bond-test" label="Index width" {...props}>
        {[<div key="a">Index</div>, <div key="b">Detail</div>]}
      </SplitPane>,
    );

  it("names the KIND of record the pane holds", () => {
    renderPane({ activeKind: "Service type", active: true });
    expect(screen.getByText("Service type")).toBeInTheDocument();
  });

  it("says nothing when no record is open", () => {
    renderPane({ activeKind: "Service type", active: false });
    expect(screen.queryByText("Service type")).not.toBeInTheDocument();
  });

  it("keeps the rail's gutter reserved while the pane is empty", () => {
    // Otherwise the detail content jumps 16px sideways the first time a record
    // is opened, which is a worse tell than the one this feature adds.
    const { container } = renderPane({
      activeKind: "Service type",
      active: false,
    });
    const detail = container.querySelector(".lg\\:pl-4");
    expect(detail).not.toBeNull();
  });

  it("draws the SAME accent rail the open row carries", () => {
    const { container } = renderPane({
      activeKind: "Service type",
      active: true,
    });
    const railed = container.querySelector('[class*="before:from-primary"]');
    expect(railed).not.toBeNull();
  });

  it("is inert on a screen that never opted in", () => {
    const { container } = renderPane({});
    expect(container.querySelector(".lg\\:pl-4")).toBeNull();
  });
});
