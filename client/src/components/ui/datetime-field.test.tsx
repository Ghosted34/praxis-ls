/**
 * DateTimeField — the day-first date-AND-time control.
 *
 * WHAT THIS PINS. `<input type="datetime-local">` renders its DATE part in the
 * OS locale, so a US workstation shows "09/11/2026, 02:00 PM" for the 11th of
 * September. This control reads and writes dd/mm/yyyy HH:mm while storing the
 * `YYYY-MM-DDTHH:mm` the API already took from the native control — so both
 * directions of that translation are asserted, including that an impossible
 * clock time yields no value rather than a rolled-over one.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DateTimeField } from "./datetime-field";

describe("DateTimeField", () => {
  it("renders a stored ISO date-time day-first, 24-hour", () => {
    render(
      <DateTimeField value="2026-09-11T14:00" onChange={() => {}} aria-label="At" />,
    );
    expect(screen.getByLabelText("At")).toHaveValue("11/09/2026 14:00");
  });

  it("accepts a full ISO instant from the API, not just the input shape", () => {
    render(
      <DateTimeField
        value="2026-09-11T14:00:00.000Z"
        onChange={() => {}}
        aria-label="At"
      />,
    );
    expect(screen.getByLabelText("At")).toHaveValue("11/09/2026 14:00");
  });

  it("masks as you type and hands back the ISO the API wants", async () => {
    const onChange = vi.fn();
    render(<DateTimeField value="" onChange={onChange} aria-label="At" />);

    const input = screen.getByLabelText("At");
    await userEvent.type(input, "110920261400");

    expect(input).toHaveValue("11/09/2026 14:00");
    expect(onChange).toHaveBeenLastCalledWith("2026-09-11T14:00");
  });

  it("holds back a value for a clock time that does not exist", async () => {
    const onChange = vi.fn();
    render(<DateTimeField value="" onChange={onChange} aria-label="At" />);

    // 25:00 is not a time. It must not become 01:00 the next day.
    await userEvent.type(screen.getByLabelText("At"), "110920262500");

    expect(screen.getByLabelText("At")).toHaveValue("11/09/2026 25:00");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("holds back a value for a date that does not exist", async () => {
    const onChange = vi.fn();
    render(<DateTimeField value="" onChange={onChange} aria-label="At" />);
    await userEvent.type(screen.getByLabelText("At"), "310220261400");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("reports a required field that was never filled in", () => {
    render(<DateTimeField value="" onChange={() => {}} required aria-label="At" />);
    const input = screen.getByLabelText("At") as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    expect(input.validationMessage).toBe("Enter a date and time.");
  });

  it("names a broken bound day-first, as the box reads", () => {
    render(
      <DateTimeField
        value="2026-09-11T08:00"
        onChange={() => {}}
        min="2026-09-11T09:00"
        aria-label="At"
      />,
    );
    const input = screen.getByLabelText("At") as HTMLInputElement;
    expect(input.checkValidity()).toBe(false);
    expect(input.validationMessage).toBe(
      "Choose a time on or after 11/09/2026 09:00.",
    );
  });
});
