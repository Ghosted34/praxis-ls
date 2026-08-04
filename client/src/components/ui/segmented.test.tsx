/**
 * Segmented / Chips — the four merged copies (F6/A3), and the keyboard support
 * none of them had.
 *
 * All four originals were a bare `<div>` of `<button>`s. Only one set
 * `aria-pressed`, so on the other three a screen-reader user could not tell
 * which filter was active; none was arrow-key navigable, so a keyboard user
 * tabbed through every option to reach the last. These tests pin the WAI-ARIA
 * radio group behaviour that replaced that.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Segmented } from "./segmented";
import { Chips } from "./chips";

const OPTIONS = [
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

function Harness({ variant }: { variant?: "inset" | "solid" }) {
  const [v, setV] = React.useState("open");
  return <Segmented label="Deal status" variant={variant} value={v} options={OPTIONS} onChange={setV} />;
}

describe("Segmented", () => {
  it("exposes itself as a named radio group, not three loose buttons", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Deal status" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("marks the selected option checked (two of the four copies exposed nothing)", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "Open" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Won" })).not.toBeChecked();
  });

  it("is ONE tab stop — a roving tabindex, not three", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>before</button>
        <Harness />
        <button>after</button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "before" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("radio", { name: "Open" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
  });

  it("moves selection with the arrow keys and wraps", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Won" })).toBeChecked();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Open" })).toBeChecked();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Lost" })).toBeChecked();
  });

  it("supports Home and End", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    await user.keyboard("{End}");
    expect(screen.getByRole("radio", { name: "Lost" })).toBeChecked();
    await user.keyboard("{Home}");
    expect(screen.getByRole("radio", { name: "Open" })).toBeChecked();
  });

  it("selects on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Segmented label="Deal status" value="open" options={OPTIONS} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Lost" }));
    expect(onChange).toHaveBeenCalledWith("lost");
  });

  it("skips a disabled option when arrowing", async () => {
    const user = userEvent.setup();
    function D() {
      const [v, setV] = React.useState("open");
      return (
        <Segmented
          label="Deal status"
          value={v}
          onChange={setV}
          options={[OPTIONS[0], { ...OPTIONS[1], disabled: true }, OPTIONS[2]]}
        />
      );
    }
    render(<D />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Lost" })).toBeChecked();
  });

  it.each(["inset", "solid"] as const)("has no axe violations (%s variant)", async (variant) => {
    const { container } = render(<Harness variant={variant} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Chips", () => {
  const CHIPS = [
    { value: "", label: "All", count: 12 },
    { value: "open", label: "Open", count: 4 },
    { value: "closed", label: "Closed", count: 8 },
  ];

  it("is a named radio group with the active chip checked", () => {
    render(<Chips label="Filter by status" value="" options={CHIPS} onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Filter by status" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /All/ })).toBeChecked();
  });

  it("renders counts alongside labels", () => {
    render(<Chips label="Filter by status" value="" options={CHIPS} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /Open/ })).toHaveTextContent("4");
  });

  it("moves selection with arrow keys", async () => {
    const user = userEvent.setup();
    function H() {
      const [v, setV] = React.useState("");
      return <Chips label="Filter by status" value={v} options={CHIPS} onChange={setV} />;
    }
    render(<H />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Open/ })).toBeChecked();
  });

  it("has no axe violations", async () => {
    const { container } = render(<Chips label="Filter by status" value="" options={CHIPS} onChange={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
