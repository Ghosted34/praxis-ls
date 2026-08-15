/**
 * Field — the 565-site label association fix (audit F4).
 *
 * This is the contract test the audit asked for. Every assertion here maps to a
 * measured "0" in the baseline table: 0 of 565 fields associated, 0
 * aria-required against 189 `required` props, 0 aria-invalid, 0
 * aria-describedby in ~40,000 lines.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Field, Select } from "./modal";
import { Input } from "./input";

describe("Field — label association (F4)", () => {
  it("gives the control an accessible name from the label", () => {
    render(
      <Field label="Client">
        <Input />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Client" })).toBeInTheDocument();
  });

  it("focuses the control when the label is clicked", async () => {
    const user = userEvent.setup();
    render(
      <Field label="Payment due">
        <Input />
      </Field>,
    );
    await user.click(screen.getByText("Payment due"));
    expect(screen.getByRole("textbox", { name: "Payment due" })).toHaveFocus();
  });

  it("associates a <select> too, not just text inputs", () => {
    render(
      <Field label="Currency">
        <Select>
          <option value="XAF">XAF</option>
        </Select>
      </Field>,
    );
    expect(
      screen.getByRole("combobox", { name: "Currency" }),
    ).toBeInTheDocument();
  });

  it("mints a unique id per field, so two fields on a form never collide", () => {
    render(
      <>
        <Field label="First">
          <Input />
        </Field>
        <Field label="Second">
          <Input />
        </Field>
      </>,
    );
    const a = screen.getByRole("textbox", { name: "First" });
    const b = screen.getByRole("textbox", { name: "Second" });
    expect(a.id).not.toBe(b.id);
    expect(a.id).toBeTruthy();
  });

  it("respects an id the control already owns instead of overwriting it", () => {
    render(
      <Field label="Reference">
        <Input id="my-own-id" />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Reference" });
    expect(input).toHaveAttribute("id", "my-own-id");
    expect(screen.getByText("Reference")).toHaveAttribute("for", "my-own-id");
  });
});

describe("Field — ARIA state (0 occurrences in the whole client before this)", () => {
  it("sets aria-required when required (189 sites rendered a red asterisk and nothing else)", () => {
    render(
      <Field label="Amount" required>
        <Input />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveAttribute(
      "aria-required",
      "true",
    );
  });

  it("does not set aria-required when the field is optional", () => {
    render(
      <Field label="Notes">
        <Input />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Notes" })).not.toHaveAttribute(
      "aria-required",
    );
  });

  it("hides the decorative asterisk from assistive tech", () => {
    render(
      <Field label="Amount" required>
        <Input />
      </Field>,
    );
    // The name is the label, not "Amount *".
    expect(screen.getByRole("textbox", { name: "Amount" })).toBeInTheDocument();
  });

  it("sets aria-invalid and points aria-describedby at the error", () => {
    render(
      <Field label="Amount" error="Must be greater than zero.">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Amount" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Must be greater than zero.");
  });

  it("points aria-describedby at the hint when there is no error", () => {
    render(
      <Field label="Amount" hint="Excluding TVA.">
        <Input />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Amount" });
    expect(input).toHaveAccessibleDescription("Excluding TVA.");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("prefers the error over the hint when both are set", () => {
    render(
      <Field
        label="Amount"
        hint="Excluding TVA."
        error="Must be greater than zero."
      >
        <Input />
      </Field>,
    );
    expect(
      screen.getByRole("textbox", { name: "Amount" }),
    ).toHaveAccessibleDescription("Must be greater than zero.");
  });

  it("preserves an aria-describedby the control already had", () => {
    render(
      <>
        <span id="external">See the tax schedule.</span>
        <Field label="Amount" error="Required.">
          <Input aria-describedby="external" />
        </Field>
      </>,
    );
    const desc = screen
      .getByRole("textbox", { name: "Amount" })
      .getAttribute("aria-describedby")!;
    expect(desc).toContain("external");
    expect(desc.split(" ").length).toBe(2);
  });
});

describe("Field — non-native and composite controls", () => {
  /**
   * htmlFor cannot associate a <label> with a <div>, so a Segmented or a
   * SearchSelect would have stayed unnamed if association were htmlFor-only.
   * aria-labelledby is what covers them.
   */
  it("names a non-labelable widget via aria-labelledby", () => {
    render(
      <Field label="Ticket view">
        <div role="radiogroup" />
      </Field>,
    );
    expect(
      screen.getByRole("radiogroup", { name: "Ticket view" }),
    ).toBeInTheDocument();
  });

  it("wraps multiple children in a labelled group rather than leaving them loose", () => {
    render(
      <Field label="Validity window" hint="Both dates required.">
        <Input />
        <Input />
      </Field>,
    );
    const group = screen.getByRole("group", { name: "Validity window" });
    expect(group).toBeInTheDocument();
    expect(group).toHaveAccessibleDescription("Both dates required.");
  });
});

describe("Field — axe", () => {
  it.each([
    ["plain", <Input key="a" />],
    ["required", <Input key="b" />],
  ])("has no violations (%s)", async (kind, child) => {
    const { container } = render(
      <Field label="Client" required={kind === "required"}>
        {child}
      </Field>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations with an error", async () => {
    const { container } = render(
      <Field label="Amount" required error="Must be greater than zero.">
        <Input />
      </Field>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
