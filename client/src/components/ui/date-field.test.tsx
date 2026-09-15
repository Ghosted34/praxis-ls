/**
 * DateField — the day-first date control.
 *
 * WHAT THIS PINS. A native `<input type="date">` renders in the OS locale, which
 * for a US-configured machine is month-first and cannot be overridden from HTML.
 * This control exists so a Central-African operator reads and writes dd/mm/yyyy
 * everywhere, while the value stored and sent to the API stays ISO YYYY-MM-DD.
 * Both directions of that translation are the whole point, so both are asserted
 * here — including that a real-looking but impossible date (31/02) yields no ISO
 * rather than a silently rolled-over one.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DateField } from "./date-field";

describe("DateField", () => {
  it("renders a stored ISO value day-first", () => {
    render(
      <DateField value="2026-07-03" onChange={() => {}} aria-label="Issued" />,
    );
    expect(screen.getByLabelText("Issued")).toHaveValue("03/07/2026");
  });

  it("formats the slashes as you type and hands back ISO", async () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} aria-label="Issued" />);

    const input = screen.getByLabelText("Issued");
    await userEvent.type(input, "03072026");

    expect(input).toHaveValue("03/07/2026");
    expect(onChange).toHaveBeenLastCalledWith("2026-07-03");
  });

  it("holds back an ISO value until the day-first date is real", async () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} aria-label="Issued" />);

    // 31 February is not a date — the control must not round it over to March.
    await userEvent.type(screen.getByLabelText("Issued"), "31022026");

    expect(screen.getByLabelText("Issued")).toHaveValue("31/02/2026");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("reports an incomplete required field rather than submitting empty", () => {
    // Validation lives on the VISIBLE text box, not on the hidden native input
    // that lends the calendar: a hidden control that fails constraint
    // validation blocks submit with the browser's own "not focusable" error and
    // no message the operator can act on — the form just stops.
    render(<DateField value="" onChange={() => {}} required aria-label="Issued" />);
    const input = screen.getByLabelText("Issued") as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    expect(input.validationMessage).toBe("Enter a date.");
  });

  it("names the bound it broke, day-first, rather than just refusing", () => {
    render(
      <DateField value="2026-07-03" onChange={() => {}} min="2026-08-01" aria-label="Issued" />,
    );
    const input = screen.getByLabelText("Issued") as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    // dd/mm/yyyy in the message too — a control that reads day-first and then
    // explains itself month-first is the same defect wearing a different hat.
    expect(input.validationMessage).toBe("Choose a date on or after 01/08/2026.");
  });

  it("accepts a date inside the bounds", () => {
    render(
      <DateField
        value="2026-07-03"
        onChange={() => {}}
        min="2026-01-01"
        max="2026-12-31"
        aria-label="Issued"
      />,
    );
    expect((screen.getByLabelText("Issued") as HTMLInputElement).checkValidity()).toBe(true);
  });

  it("rejects a date typed past the upper bound", async () => {
    render(<DateField value="" onChange={() => {}} max="2026-07-31" aria-label="Issued" />);
    const input = screen.getByLabelText("Issued") as HTMLInputElement;
    await userEvent.type(input, "01082026");
    expect(input.checkValidity()).toBe(false);
    expect(input.validationMessage).toBe("Choose a date on or before 31/07/2026.");
  });

  it("carries a name and onBlur, so a react-hook-form field spread works on it", async () => {
    // `<DateField {...field} />` is how every RHF-driven date field binds; that
    // spread hands over name/onBlur/ref, and dropping any of them breaks
    // validation-on-touch silently.
    const onBlur = vi.fn();
    render(
      <DateField
        value=""
        onChange={() => {}}
        name="entry_date"
        onBlur={onBlur}
        aria-label="Issued"
      />,
    );
    const input = screen.getByLabelText("Issued");
    expect(input).toHaveAttribute("name", "entry_date");
    await userEvent.click(input);
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalled();
  });
});
