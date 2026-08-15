/**
 * InlineEdit and SplitPane (Phase 5).
 *
 * Both replace an idiom that is mouse-only by construction, so the keyboard
 * assertions are the point of the file rather than an extra. The app has already
 * shipped two drag handles that had to be retro-fitted for the keyboard (the FAB
 * and the sales kanban); these are the tests that stop the third.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { InlineEdit } from "@/components/ui/inline-edit";
import { SplitPane } from "@/components/ui/split-pane";
import { clearActionError, useActionError } from "@/lib/action-error";

describe("InlineEdit", () => {
  beforeEach(() => clearActionError());

  it("shows the value as a control named by the FIELD and its content", () => {
    render(
      <InlineEdit
        label="Service name"
        value="Customs clearance"
        onSave={vi.fn()}
      />,
    );
    // Not "Edit" — activating a control should not be a leap of faith.
    expect(
      screen.getByRole("button", {
        name: "Service name, Customs clearance, edit",
      }),
    ).toBeInTheDocument();
  });

  it("edits and commits with Enter", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEdit label="Service name" value="Old" onSave={onSave} />);
    await userEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox", { name: "Service name" });
    await userEvent.clear(input);
    await userEvent.type(input, "New{Enter}");
    expect(onSave).toHaveBeenCalledWith("New");
  });

  it("is reachable and operable by keyboard alone", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEdit label="Service name" value="Old" onSave={onSave} />);
    screen.getByRole("button").focus();
    await userEvent.keyboard("{Enter}");
    const input = screen.getByRole("textbox", { name: "Service name" });
    expect(input).toHaveFocus();
    await userEvent.keyboard("{Control>}a{/Control}Renamed{Enter}");
    expect(onSave).toHaveBeenCalledWith("Renamed");
  });

  it("ESCAPE reverts, and the blur that follows does not re-commit it", async () => {
    // Blur fires after the key handler every time, so an Escape that only reset
    // state would still be saved a moment later by the blur path.
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineEdit label="Service name" value="Original" onSave={onSave} />,
    );
    await userEvent.click(screen.getByRole("button"));
    const input = screen.getByRole("textbox", { name: "Service name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Abandoned{Escape}");
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Original/ }),
    ).toBeInTheDocument();
  });

  it("commits on blur — clicking away saves rather than discarding", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <>
        <InlineEdit label="Service name" value="Old" onSave={onSave} />
        <button>Elsewhere</button>
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Service name/ }));
    const input = screen.getByRole("textbox", { name: "Service name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Typed");
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Typed"));
  });

  it("sends nothing when the value did not change", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEdit label="Service name" value="Same" onSave={onSave} />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.keyboard("{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reverts rather than sending an empty required value", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <InlineEdit label="Service name" required value="Kept" onSave={onSave} />,
    );
    await userEvent.click(screen.getByRole("button"));
    await userEvent.clear(
      screen.getByRole("textbox", { name: "Service name" }),
    );
    await userEvent.keyboard("{Enter}");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Kept/ })).toBeInTheDocument();
  });

  it("REVERTS AND REPORTS when the save fails — it does not stay optimistic", async () => {
    // A name that reads as saved but is not is how two people end up looking at
    // different data and neither of them knows.
    function Banner() {
      const msg = useActionError();
      return <p data-testid="banner">{msg ?? ""}</p>;
    }
    const onSave = vi.fn().mockRejectedValue(new Error("nope"));
    render(
      <>
        <InlineEdit label="Service name" value="Original" onSave={onSave} />
        <Banner />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Service name/ }));
    const input = screen.getByRole("textbox", { name: "Service name" });
    await userEvent.clear(input);
    await userEvent.type(input, "Doomed{Enter}");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Original/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("banner")).not.toBeEmptyDOMElement();
  });

  it("tracks an external change while it is not being edited", async () => {
    const { rerender } = render(
      <InlineEdit label="Name" value="First" onSave={vi.fn()} />,
    );
    rerender(<InlineEdit label="Name" value="Refreshed" onSave={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Refreshed/ }),
    ).toBeInTheDocument();
  });

  it("has no axe violations in either state", async () => {
    const { container } = render(
      <InlineEdit label="Service name" value="Customs" onSave={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button"));
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("SplitPane", () => {
  beforeEach(() => localStorage.clear());

  const renderPane = (
    props: Partial<React.ComponentProps<typeof SplitPane>> = {},
  ) =>
    render(
      <SplitPane
        storageKey="test"
        label="Index width"
        defaultSize={280}
        min={200}
        max={480}
        {...props}
      >
        {[<div key="a">Index</div>, <div key="b">Detail</div>]}
      </SplitPane>,
    );

  it("is a real separator with a value and a range, not a bare div", () => {
    renderPane();
    const sep = screen.getByRole("separator", { name: "Index width" });
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-valuenow", "280");
    expect(sep).toHaveAttribute("aria-valuemax", "480");
    expect(sep).toHaveAttribute("aria-controls");
  });

  it("RESIZES BY KEYBOARD — the assertion this component exists for", async () => {
    renderPane();
    const sep = screen.getByRole("separator");
    sep.focus();
    expect(sep).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(sep).toHaveAttribute("aria-valuenow", "296");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(sep).toHaveAttribute("aria-valuenow", "264");
  });

  it("Home and End go to the limits and stop there", async () => {
    renderPane();
    const sep = screen.getByRole("separator");
    sep.focus();
    await userEvent.keyboard("{End}");
    expect(sep).toHaveAttribute("aria-valuenow", "480");
    await userEvent.keyboard("{ArrowRight}");
    expect(sep).toHaveAttribute("aria-valuenow", "480");
    await userEvent.keyboard("{Home}");
    expect(sep).toHaveAttribute("aria-valuenow", "200");
    await userEvent.keyboard("{ArrowLeft}");
    expect(sep).toHaveAttribute("aria-valuenow", "200");
  });

  it("Enter collapses and restores the width it had", async () => {
    renderPane();
    const sep = screen.getByRole("separator");
    sep.focus();
    await userEvent.keyboard("{ArrowRight}"); // 296
    await userEvent.keyboard("{Enter}");
    expect(sep).toHaveAttribute("aria-valuenow", "0");
    await userEvent.keyboard("{Enter}");
    expect(sep).toHaveAttribute("aria-valuenow", "296");
  });

  it("remembers the width per screen", async () => {
    const { unmount } = renderPane();
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowRight}");
    unmount();

    renderPane();
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "296",
    );
  });

  it("does not adopt another screen's width", () => {
    localStorage.setItem("praxis.split.other", "420");
    renderPane();
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "280",
    );
  });

  it("ignores a corrupt stored width instead of collapsing to nothing", () => {
    localStorage.setItem("praxis.split.test", "not-a-number");
    renderPane();
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "280",
    );
  });

  it("renders both panes", () => {
    renderPane();
    expect(screen.getByText("Index")).toBeInTheDocument();
    expect(screen.getByText("Detail")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = renderPane();
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * Focus restoration on exit — the other half of the defect the keyboard test
 * above found. Both directions unmount the element focus is on.
 */
describe("InlineEdit focus handoff", () => {
  it("returns focus to the control after a keyboard commit", async () => {
    render(
      <InlineEdit
        label="Name"
        value="A"
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const open = screen.getByRole("button");
    open.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Control>}a{/Control}B{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Name/ })).toHaveFocus(),
    );
  });

  it("returns focus to the control after Escape", async () => {
    render(<InlineEdit label="Name" value="A" onSave={vi.fn()} />);
    screen.getByRole("button").focus();
    await userEvent.keyboard("{Enter}{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Name/ })).toHaveFocus(),
    );
  });

  it("does NOT yank focus back when the user clicked away", async () => {
    // Commit-on-blur means the user is already somewhere else; stealing focus
    // back would be the component fighting them.
    render(
      <>
        <InlineEdit
          label="Name"
          value="A"
          onSave={vi.fn().mockResolvedValue(undefined)}
        />
        <button>Elsewhere</button>
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Name/ }));
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    await userEvent.click(elsewhere);
    await waitFor(() => expect(elsewhere).toHaveFocus());
  });
});
