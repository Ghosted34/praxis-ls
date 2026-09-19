/**
 * C-PR-03 (audit #2) — the currency picker never dead-ends.
 *
 * The list shows a live RESULT COUNT so a user knows how many currencies
 * scrolling/searching exposes, and the whole filtered catalogue is rendered
 * (scrollable) rather than truncated behind a non-interactive "N more".
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SmartCurrencyPicker } from "./smart-currency-picker";
import { currencies } from "@shared";

function Harness() {
  return <SmartCurrencyPicker value="" onChange={() => {}} />;
}

describe("SmartCurrencyPicker — discoverability", () => {
  it("shows a result count describing the complete list", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Currency/i }));
    const total = currencies.CATALOGUE.length;
    expect(
      await screen.findByText(new RegExp(`${total} currencies available`, "i")),
    ).toBeInTheDocument();
  });

  it("filters by country and keeps the count honest, never a dead-end", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Currency/i }));
    const search = await screen.findByLabelText(/Search currency or country/i);
    await user.type(search, "Holland"); // country search → EUR
    const listbox = await screen.findByRole("listbox");
    // EUR is reachable (the classic "Holland finds EUR" case), and the count line
    // reflects the matches rather than hiding them behind a static label.
    expect(within(listbox).getByRole("option", { name: /EUR/ })).toBeInTheDocument();
    expect(screen.getByText(/match · scroll for all/i)).toBeInTheDocument();
  });
});
