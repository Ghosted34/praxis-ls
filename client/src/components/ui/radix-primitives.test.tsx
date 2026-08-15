/**
 * The Radix layer: the keyboard-only walkthrough of Dialog, Tabs, DropdownMenu
 * and Select that the audit's Phase 2 validation calls for, checked against the
 * WAI-ARIA Authoring Practices.
 *
 * Each block starts from the specific defect F13 measured, so a future reader
 * can tell what these are guarding rather than assuming they are library tests.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MemoryRouter } from "react-router-dom";

import { Dialog, ConfirmDialog } from "./dialog";
import { Tabs } from "./tabs";
import { DropdownMenu, DropdownItem, DropdownSeparator } from "./dropdown-menu";
import { Select } from "./select";
import { Checkbox, RadioGroup } from "./checkbox";
import { Popover } from "./popover";
import { Field } from "./modal";
import { Input } from "./input";

/* ────────────────────────────────── Dialog ───────────────────────────────── */

function DialogHarness() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open form</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New client"
        description="Creates a master-data record."
      >
        <Field label="Name">
          <Input />
        </Field>
        <button>Extra</button>
      </Dialog>
    </>
  );
}

describe("Dialog (replaces Modal — F13: no focus trap, no focus restore)", () => {
  it("is a modal dialog named by its visible title, not a duplicated aria-label", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Open form" }));

    const dialog = screen.getByRole("dialog", { name: "New client" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("Creates a master-data record.");
  });

  /**
   * THE DEFECT. The old Modal had no trap: Tab moved focus behind the dialog,
   * into controls the backdrop was hiding. Tabbing right round the dialog must
   * come back to the dialog, never reach "Open form".
   */
  it("traps Tab inside the dialog (WCAG 2.4.3)", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Open form" }));

    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("restores focus to the trigger on close — the old Modal dropped it to <body>", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open form" });
    await user.click(trigger);
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    // Radix restores focus after the content unmounts, so this settles a tick later.
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes on Escape and on the close button", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Open form" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("has no axe violations", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Open form" }));
    expect(await axe(screen.getByRole("dialog"))).toHaveNoViolations();
  });
});

describe("ConfirmDialog", () => {
  it("names the action rather than asking yes/no", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        title="Delete rate card?"
        body="It will stop applying to new quotations."
        confirmLabel="Delete rate card"
        destructive
      />,
    );
    await user.click(screen.getByRole("button", { name: "Delete rate card" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

/* ─────────────────────────────────── Tabs ────────────────────────────────── */

function TabsHarness() {
  const [tab, setTab] = React.useState("milestones");
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      label="Dossier sections"
      tabs={[
        {
          value: "milestones",
          label: "Milestones",
          content: <p>Milestone body</p>,
        },
        { value: "money", label: "Money", content: <p>Money body</p> },
        { value: "people", label: "People", content: <p>People body</p> },
      ]}
    />
  );
}

describe("Tabs (F13: 'Tabs are not tabs')", () => {
  it("exposes a real tablist / tab / tabpanel structure", () => {
    render(<TabsHarness />);
    expect(
      screen.getByRole("tablist", { name: "Dossier sections" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Milestones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Milestone body");
  });

  it("is ONE tab stop — the strip, not three separate ones", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button>before</button>
        <TabsHarness />
      </>,
    );
    await user.tab();
    await user.tab();
    expect(screen.getByRole("tab", { name: "Milestones" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("tab", { name: "Milestones" })).not.toHaveFocus();
  });

  /**
   * activationMode="manual" is deliberate: in this app a panel mount is a data
   * fetch, so automatic activation would fire a throwaway request for every tab
   * a user arrows past.
   */
  it("arrows move focus WITHOUT activating; Enter activates", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    await user.tab();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Money" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Milestones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Milestone body");

    await user.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "Money" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Money body");
  });

  it("supports Home and End", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    await user.tab();
    await user.keyboard("{End}{Enter}");
    expect(screen.getByRole("tab", { name: "People" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Home}{Enter}");
    expect(screen.getByRole("tab", { name: "Milestones" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(<TabsHarness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ─────────────────────────────── DropdownMenu ────────────────────────────── */

function MenuHarness({ onDelete = () => {} }: { onDelete?: () => void }) {
  return (
    <MemoryRouter>
      <DropdownMenu trigger={<button>Actions</button>}>
        <DropdownItem onSelect={() => {}}>Edit</DropdownItem>
        <DropdownItem to="/clients/1">Open client</DropdownItem>
        <DropdownSeparator />
        <DropdownItem destructive onSelect={onDelete}>
          Delete
        </DropdownItem>
      </DropdownMenu>
    </MemoryRouter>
  );
}

describe("DropdownMenu (F13: role='menu' with ZERO onKeyDown handlers)", () => {
  it("opens from the keyboard and exposes menu semantics", async () => {
    const user = userEvent.setup();
    render(<MenuHarness />);
    await user.tab();
    await user.keyboard("{Enter}");

    // Named by its trigger, per the WAI-ARIA menu-button pattern.
    expect(
      await screen.findByRole("menu", { name: "Actions" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("marks the trigger with aria-expanded", async () => {
    const user = userEvent.setup();
    render(<MenuHarness />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    await waitFor(() =>
      expect(trigger).toHaveAttribute("aria-expanded", "true"),
    );
  });

  /** The promise role="menu" makes and the old code never kept. */
  it("moves between items with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<MenuHarness />);
    await user.click(screen.getByRole("button", { name: "Actions" }));

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Open client" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  });

  it("activates an item with Enter", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<MenuHarness onDelete={onDelete} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onDelete).toHaveBeenCalled();
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<MenuHarness />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("has no axe violations when open", async () => {
    const user = userEvent.setup();
    render(<MenuHarness />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    const menu = await screen.findByRole("menu");
    // Scoped to the menu: a portalled fragment has no landmarks by
    // construction, so the page-level "region" rule is not meaningful here.
    expect(await axe(menu)).toHaveNoViolations();
  });
});

/* ────────────────────────────────── Select ───────────────────────────────── */

function SelectHarness() {
  const [v, setV] = React.useState("");
  return (
    <Field label="Status">
      <Select
        value={v}
        onValueChange={setV}
        placeholder="Any status"
        options={[
          { value: "OPEN", label: "Open" },
          { value: "WON", label: "Won" },
          { value: "LOST", label: "Lost" },
        ]}
      />
    </Field>
  );
}

describe("Select", () => {
  it("takes its accessible name from the surrounding Field", () => {
    render(<SelectHarness />);
    expect(
      screen.getByRole("combobox", { name: "Status" }),
    ).toBeInTheDocument();
  });

  it("opens with the keyboard and selects with Enter", async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);
    await user.tab();
    await user.keyboard("{Enter}");

    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Status" }),
      ).toHaveTextContent(/Open|Won/),
    );
  });

  it("closes on Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);
    const trigger = screen.getByRole("combobox", { name: "Status" });
    await user.click(trigger);
    await screen.findByRole("listbox");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("has no axe violations", async () => {
    const { container } = render(<SelectHarness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ──────────────────────────── Checkbox / RadioGroup ──────────────────────── */

describe("Checkbox", () => {
  it("is labelled, and the label is a click target", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox
        checked={false}
        onCheckedChange={onChange}
        label="Include resolved"
      />,
    );
    await user.click(screen.getByText("Include resolved"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("expresses the indeterminate state, which a native checkbox cannot declare", () => {
    render(
      <Checkbox
        checked="indeterminate"
        onCheckedChange={() => {}}
        label="Select all rows"
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Select all rows" }),
    ).toHaveAttribute("aria-checked", "mixed");
  });

  it("toggles with Space", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox
        checked={false}
        onCheckedChange={onChange}
        label="Include resolved"
      />,
    );
    await user.tab();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Checkbox
        checked={false}
        onCheckedChange={() => {}}
        label="Include resolved"
        hint="Adds closed flags."
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("RadioGroup", () => {
  function H() {
    const [v, setV] = React.useState("BANK");
    return (
      <Field label="Payment method" required>
        <RadioGroup
          value={v}
          onValueChange={setV}
          options={[
            { value: "BANK", label: "Bank transfer" },
            { value: "MOMO", label: "Mobile money", hint: "MTN and Orange." },
          ]}
        />
      </Field>
    );
  }

  it("is a named group with the selected option checked", () => {
    render(<H />);
    expect(
      screen.getByRole("radiogroup", { name: "Payment method" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Bank transfer" })).toBeChecked();
  });

  /**
   * Arrows move focus; Space commits. The APG allows both this and
   * selection-follows-focus; what matters is that the group is a single tab stop
   * and fully operable without a mouse, which the raw <input type="radio">
   * scatter it replaces was not consistent about.
   */
  it("moves focus with the arrow keys and commits with Space", async () => {
    const user = userEvent.setup();
    render(<H />);
    await user.tab();
    expect(screen.getByRole("radio", { name: "Bank transfer" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: /Mobile money/ })).toHaveFocus();

    await user.keyboard(" ");
    expect(screen.getByRole("radio", { name: /Mobile money/ })).toBeChecked();
  });

  it("has no axe violations", async () => {
    const { container } = render(<H />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ────────────────────────────────── Popover ──────────────────────────────── */

describe("Popover (the notification bell was a panel wearing a menu's ARIA)", () => {
  function H() {
    return (
      <Popover
        label="Notifications"
        trigger={<button aria-label="Notifications">Bell</button>}
      >
        <p>Latest</p>
        <button>Mark all read</button>
      </Popover>
    );
  }

  it("opens a labelled dialog-style panel whose contents are ordinary tab stops", async () => {
    const user = userEvent.setup();
    render(<H />);
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(
      await screen.findByRole("dialog", { name: "Notifications" }),
    ).toBeInTheDocument();
    // Nested interactive content — invalid inside a menuitem, fine here.
    expect(
      screen.getByRole("button", { name: "Mark all read" }),
    ).toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<H />);
    const trigger = screen.getByRole("button", { name: "Notifications" });
    await user.click(trigger);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
});
