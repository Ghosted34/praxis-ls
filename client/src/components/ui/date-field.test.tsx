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
    render(<DateField value="2026-07-03" onChange={() => {}} aria-label="Issued" />);
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
});
