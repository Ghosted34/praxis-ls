/**
 * The petty-cash count sheet.
 *
 * What is worth guarding here is the control, not the layout: the total must be
 * derived from the denominations rather than typed, because a count sheet whose
 * arithmetic is done by the person being counted is not a control at all — and
 * a variance must be visible as a variance rather than rounded into the noise.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { CashCountSheet } from "./cash-count-sheet";

const COUNTS = [
  {
    cash_count_id: "c1",
    counted_on: "2026-05-02",
    currency: "XAF",
    denominations: [{ note: 10000, qty: 14 }],
    counted_total: "150000.00",
    ledger_balance: "155000.00",
    difference: "-5000.00",
    over_float_limit: false,
    variance_reason: null,
    status: "DRAFT",
    attested_at: null,
  },
];

const render = (counts: unknown = COUNTS, floatLimit: number | null = null) =>
  renderScreen(
    <CashCountSheet accountId="t1" currency="XAF" floatLimit={floatLimit} />,
    { routes: { "/reconciliation/cash-counts": counts } },
  );

describe("Treasury · petty-cash count sheet", () => {
  it("derives the total from the denominations instead of accepting a typed figure", async () => {
    const user = userEvent.setup();
    render([]);

    await user.type(await screen.findByLabelText(/quantity of 10000/i), "14");
    await user.type(screen.getByLabelText(/quantity of 5000/i), "3");

    // 14 × 10 000 + 3 × 5 000 = 155 000.
    await waitFor(() => expect(screen.getByText(/155[  ,]?000/)).toBeInTheDocument());

    // There is no control that lets someone state a total directly.
    expect(screen.queryByLabelText(/counted total/i)).not.toBeInTheDocument();
  });

  it("will not record an empty count", async () => {
    render([]);
    expect(await screen.findByRole("button", { name: /record this count/i })).toBeDisabled();
  });

  it("shows a shortfall as a shortfall", async () => {
    render();
    // -5 000 against the books, rendered in the variance column.
    await waitFor(() => expect(screen.getByText(/-5[  ,]?000/)).toBeInTheDocument());
  });

  it("offers Attest while a count is a draft, and the sheet only once it is not", async () => {
    render();
    expect(await screen.findByRole("button", { name: /attest/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /issue sheet/i })).not.toBeInTheDocument();
  });

  it("offers the count sheet once the custodian has attested", async () => {
    render([{ ...COUNTS[0], status: "ATTESTED", attested_at: "2026-05-02" }]);
    expect(await screen.findByRole("button", { name: /issue sheet/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^attest$/i })).not.toBeInTheDocument();
  });

  it("warns when the float has drifted above its limit", async () => {
    const user = userEvent.setup();
    render([], 100000);
    await user.type(await screen.findByLabelText(/quantity of 10000/i), "14");
    expect(await screen.findByText(/over the float limit/i)).toBeInTheDocument();
  });

  it("explains what the screen is for when nothing has been counted yet", async () => {
    render([]);
    expect(await screen.findByText(/no counts recorded yet/i)).toBeInTheDocument();
  });
});
