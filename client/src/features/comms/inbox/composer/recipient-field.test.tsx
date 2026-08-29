/**
 * The address field, from the keyboard.
 *
 * This is the most-used control in the composer and the one where a mistake is
 * least recoverable — the wrong address on an invoice — and until now the
 * suggestion list could only be reached with a mouse. No arrow keys, no Enter,
 * no Escape, and no roles, so a screen reader announced a plain text input with
 * eight unannounced results underneath it.
 *
 * Every test here is about a key, because the mouse path already worked.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { RecipientField } from "./recipient-field";
import { renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

/** Two addresses the record itself supplies, so no search has to resolve. */
const EXTRA = [
  { name: "Camrail SARL", email: "ops@camrail.cm", note: "Client on file" },
  { name: "Camrail Billing", email: "billing@camrail.cm", note: "Client on file" },
];

function Field({ onChange = vi.fn() }: { onChange?: (v: string) => void }) {
  const [v, setV] = React.useState("cam");
  return (
    <RecipientField
      id="to"
      value={v}
      extra={EXTRA}
      onChange={(next) => { setV(next); onChange(next); }}
    />
  );
}

describe("the recipient picker is a combobox", () => {
  it("announces itself as one, with the list it controls", async () => {
    renderScreen(<Field />, {});
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await waitFor(() => expect(input).toHaveAttribute("aria-expanded", "true"));
    expect(input).toHaveAttribute("aria-controls", "to-listbox");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("ARROW KEYS MOVE THE SELECTION, and focus stays in the text field", async () => {
    renderScreen(<Field />, {});
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await screen.findByRole("listbox");

    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "to-opt-0");
    // The caret has to survive, so the option is never focused — the active
    // descendant is what tells a screen reader which row is current.
    expect(input).toHaveFocus();
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", "to-opt-1");
  });

  it("wraps at both ends rather than stopping", async () => {
    renderScreen(<Field />, {});
    await userEvent.click(screen.getByRole("combobox"));
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-activedescendant", "to-opt-1");
  });

  it("Enter takes the highlighted row", async () => {
    const onChange = vi.fn();
    renderScreen(<Field onChange={onChange} />, {});
    await userEvent.click(screen.getByRole("combobox"));
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("ops@camrail.cm, ");
  });

  it("ENTER WITH NOTHING HIGHLIGHTED IS LEFT TO THE FORM", async () => {
    // Swallowing it unconditionally would break sending from the keyboard,
    // which is the thing this field sits in front of.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderScreen(
      <form onSubmit={onSubmit}>
        <Field />
        <button type="submit">send</button>
      </form>,
      {},
    );
    await userEvent.click(screen.getByRole("combobox"));
    await screen.findByRole("listbox");
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalled();
  });

  it("Escape closes the list without choosing anything", async () => {
    const onChange = vi.fn();
    renderScreen(<Field onChange={onChange} />, {});
    await userEvent.click(screen.getByRole("combobox"));
    await screen.findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("has no accessibility violations with the list open", async () => {
    const { container } = renderScreen(<Field />, {});
    await userEvent.click(screen.getByRole("combobox"));
    await screen.findByRole("listbox");
    expect(await axe(container)).toHaveNoViolations();
  });
});
