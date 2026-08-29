/**
 * The address field, from the keyboard — and with more than one address in it.
 *
 * This is the most-used control in the composer and the one where a mistake is
 * least recoverable — the wrong address on an invoice — and until now the
 * suggestion list could only be reached with a mouse. No arrow keys, no Enter,
 * no Escape, and no roles, so a screen reader announced a plain text input with
 * eight unannounced results underneath it.
 *
 * The second half of the file is about the second address. The row was one text
 * input holding a comma-separated string, and the comma was the whole mechanism
 * — nothing on screen said another recipient was possible, and a row typed
 * without it came back from the server as `VALIDATION_ERROR: cc` AFTER the send
 * was pressed. What is pinned here is that every ordinary way of adding one
 * works (Enter, comma, semicolon, Tab, leaving the field, a paste), that the
 * result is a chip you can see and remove, and that an address which is not one
 * is said so in the composer rather than by a mail server.
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

function Field({
  onChange = vi.fn(),
  initial = "",
}: { onChange?: (v: string) => void; initial?: string }) {
  const [v, setV] = React.useState(initial);
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
    expect(onChange).toHaveBeenCalledWith("ops@camrail.cm");
    expect(screen.getByRole("button", { name: /remove ops@camrail\.cm/i })).toBeInTheDocument();
  });

  it("ENTER WITH NOTHING HIGHLIGHTED AND NOTHING TYPED IS LEFT TO THE FORM", async () => {
    // Swallowing it unconditionally would break sending from the keyboard,
    // which is the thing this field sits in front of. Enter on TEXT is a
    // different question and is answered below: it adds the address.
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderScreen(
      <form onSubmit={onSubmit}>
        <Field />
        <button type="submit">send</button>
      </form>,
      {},
    );
    await userEvent.click(screen.getByRole("combobox"));
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

/* ── The second address ───────────────────────────────────────────────────── */

describe("adding more than one address", () => {
  const type = (text: string) => userEvent.type(screen.getByRole("combobox"), text);

  it("ENTER ADDS THE TYPED ADDRESS AS A CHIP — this is the reported bug", async () => {
    // "even when i add an email in copy there is no way i can add a second
    // one... no plus button nothing". There is now: the address becomes a chip
    // and the field is ready for the next one.
    const onChange = vi.fn();
    renderScreen(<Field onChange={onChange} />, {});
    await type("ops@camrail.cm{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("ops@camrail.cm");
    await type("billing@camrail.cm{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("ops@camrail.cm, billing@camrail.cm");
    expect(screen.getByRole("button", { name: /remove ops@camrail\.cm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove billing@camrail\.cm/i })).toBeInTheDocument();
  });

  it("so do a comma and a semicolon, and so does leaving the field", async () => {
    const onChange = vi.fn();
    renderScreen(
      <>
        <Field onChange={onChange} />
        <button type="button">elsewhere</button>
      </>,
      {},
    );
    await type("a@b.cm,c@d.cm;e@f.cm");
    expect(onChange).toHaveBeenLastCalledWith("a@b.cm, c@d.cm, e@f.cm");
    // The last one is still in the input — the caret is in it — until the
    // field is left, which is how most people finish an address.
    await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(screen.getByRole("button", { name: /remove e@f\.cm/i })).toBeInTheDocument();
  });

  it("A SPACE BETWEEN TWO ADDRESSES SEPARATES THEM, a space in a name does not", async () => {
    // The likeliest shape behind the production notice: no visible way to add a
    // second address, and two typed into the field anyway.
    const onChange = vi.fn();
    renderScreen(<Field onChange={onChange} />, {});
    await type("ops@camrail.cm billing@camrail.cm{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("ops@camrail.cm, billing@camrail.cm");
    await type("Jean Dupont{Enter}");
    expect(screen.getByRole("button", { name: /remove Jean Dupont/i })).toBeInTheDocument();
    expect(screen.getByText(/"Jean Dupont" is not an email address/i)).toBeInTheDocument();
  });

  it("keeps a pasted display name in one piece", async () => {
    // `"Dupont, Jean" <j@acme.cm>` is one recipient. Splitting on every comma
    // makes it two, both of them broken.
    const onChange = vi.fn();
    renderScreen(<Field onChange={onChange} />, {});
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.paste('"Dupont, Jean" <j@acme.cm>, x@y.cm');
    expect(onChange).toHaveBeenLastCalledWith('"Dupont, Jean" <j@acme.cm>, x@y.cm');
    await userEvent.tab();
    expect(screen.getByRole("button", { name: /remove "Dupont, Jean" <j@acme\.cm>/i })).toBeInTheDocument();
  });

  it("a chip can be removed, and the row it reports loses it", async () => {
    const onChange = vi.fn();
    renderScreen(<Field onChange={onChange} initial="a@b.cm, c@d.cm" />, {});
    await userEvent.click(screen.getByRole("button", { name: /remove a@b\.cm/i }));
    expect(onChange).toHaveBeenLastCalledWith("c@d.cm");
    expect(screen.queryByRole("button", { name: /remove a@b\.cm/i })).toBeNull();
  });

  it("BACKSPACE PUTS THE LAST ONE BACK IN THE FIELD rather than deleting it", async () => {
    // A mistyped address is corrected far more often than it is retyped.
    renderScreen(<Field initial="ops@camrail.cm" />, {});
    const input = screen.getByRole("combobox");
    await userEvent.click(input);
    await userEvent.keyboard("{Backspace}");
    expect(input).toHaveValue("ops@camrail.cm");
    expect(screen.queryByRole("button", { name: /remove ops@camrail\.cm/i })).toBeNull();
  });

  it("SAYS WHICH ADDRESS IS NOT ONE, in the composer, before anything is sent", async () => {
    // The whole of the server's answer was `VALIDATION_ERROR: cc` — no address,
    // no reason, and only after the send was pressed.
    renderScreen(<Field />, {});
    await type("jean dupont{Enter}");
    expect(screen.getByText(/"jean dupont" is not an email address/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });

  it("does not offer a suggestion that is already a chip", async () => {
    renderScreen(<Field initial="ops@camrail.cm" />, {});
    await userEvent.click(screen.getByRole("combobox"));
    await screen.findByRole("listbox");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("billing@camrail.cm");
  });

  it("has no accessibility violations with chips and an invalid one", async () => {
    // With the label the composer puts beside it: a combobox whose only name
    // came from its placeholder is a finding of its own, and not this one.
    const { container } = renderScreen(
      <>
        <label htmlFor="to">Cc</label>
        <Field initial="a@b.cm, jean dupont" />
      </>,
      {},
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
