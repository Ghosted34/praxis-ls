/**
 * Budget Reconciliation — what the sheet must not lose.
 *
 * WHAT THESE PIN, and why each is a defect waiting to happen.
 *
 * 1. THE PRE-FILL IS A HYPOTHESIS, NOT AN ANSWER. An untouched line shows what
 *    was disbursed — "we gave you 119 250, is that what you spent?" — and the
 *    sheet says so. A regression that rendered it as a confirmed actual would be
 *    invisible: the number is right, the claim about it is not.
 *
 * 2. THE FOOTER MOVES AS YOU TYPE. The legacy's `calculateTotals()` re-footed on
 *    every keystroke and it is the one thing about that screen worth copying. A
 *    footer that waits for the server reads as a frozen page.
 *
 * 3. A LINE CANNOT BE INVENTED HERE. Owner decision Q11: no spend on an
 *    operations file without an approved costing. The sheet has to say where the
 *    fix is, not offer an "add line" button.
 *
 * 4. THE + IS THE PROOF AFFORDANCE. A line that owes a receipt and has none
 *    shows it; one that has two shows the count. Losing that is losing the whole
 *    of the owner's "we probably just get a + for each line".
 *
 * 5. NO APPROVED COSTING IS A SENTENCE, NOT AN EMPTY TABLE.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { ReconciliationPage } from "./reconciliation";

const DOSSIER = "d-1";

const line = (over: Record<string, unknown> = {}) => ({
  costing_line_id: "cl-1",
  line_id: null,
  line_no: 1,
  label: "Port Charges",
  item_code: "PORT_CHARGES",
  is_disbursement: true,
  qty: 1,
  unit_cost: 100000,
  net: 100000,
  vat: 19250,
  budget_ttc: 119250,
  committed: 119250,
  pending: 0,
  disbursed: 119250,
  actual_ttc: 119250,
  actual_source: "DERIVED",
  variance: 0,
  returned_amount: 0,
  outstanding: 0,
  justification_required: false,
  document_count: 0,
  funded: true,
  over_budget: false,
  reason_required: false,
  reason_missing: false,
  proof_missing: false,
  documents: [],
  ...over,
});

const sheet = (over: Record<string, unknown> = {}) => ({
  dossier_id: DOSSIER,
  reconciliation_id: null,
  status: "OPEN",
  revision: 1,
  can_reconcile: true,
  blocked_reason: null,
  lines: [line()],
  documents: [],
  allowance: { amount: 1000, percent: 2 },
  blockers: [],
  totals: {
    budget_ttc: 119250, committed: 119250, disbursed: 119250, actual_ttc: 119250,
    returned: 0, outstanding: 0, variance: 0, lines: 1, lines_over_budget: 0,
    reasons_missing: 0, proofs_missing: 0, actual_ht: 100000, margin_ht: null,
  },
  grades: {
    execution: { key: "PENDING", label: "Awaiting inputs", percent: null },
    accountability: { key: "ACCOUNTED", label: "Fully accounted for", amount: 0 },
    commercial: { key: "NO_QUOTE", label: "No accepted quotation", percent: null },
  },
  ...over,
});

/** Pick the file, which is what makes the sheet fetch. SearchSelect is a
 *  combobox behind a trigger button, so this is two clicks. */
async function pickFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /operations file/i }));
  await user.click(await screen.findByText("SLAS-OPS-2026-0117"));
}

const routes = (s: unknown) => ({
  "/operations": [{ dossier_id: DOSSIER, ref: "SLAS-OPS-2026-0117" }],
  [`/costing/reconciliations/${DOSSIER}`]: s,
});

describe("the sheet", () => {
  it("pre-fills an untouched line with what was disbursed, and says nobody confirmed it", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, { routes: routes(sheet()) });
    await pickFile(user);

    const row = (await screen.findByText("Port Charges")).closest("tr")!;
    expect(within(row).getByLabelText(/actual spent/i)).toHaveValue(119250);
    // The claim about the number, not the number.
    expect(within(row).getByText(/not confirmed/i)).toBeInTheDocument();
  });

  it("re-foots the total as the actual is typed, with no round trip", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, { routes: routes(sheet()) });
    await pickFile(user);

    const input = within((await screen.findByText("Port Charges")).closest("tr")!)
      .getByLabelText(/actual spent/i);
    await user.clear(input);
    await user.type(input, "131250");

    // The footer's Actual cell has moved without anything being saved.
    await waitFor(() => {
      const foot = screen.getByText("Total").closest("tr")!;
      expect(within(foot).getByText(/131,250|131 250/)).toBeInTheDocument();
    });
  });

  it("offers a + on a line that owes a receipt and has none", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, {
      routes: routes(sheet({
        lines: [line({ line_id: "rl-1", justification_required: true, proof_missing: true })],
      })),
    });
    await pickFile(user);
    const row = (await screen.findByText("Port Charges")).closest("tr")!;
    expect(within(row).getByLabelText(/attach proof/i)).toBeInTheDocument();
  });

  it("shows the count once evidence is attached, because a second document is normal", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, {
      routes: routes(sheet({
        lines: [line({ line_id: "rl-1", justification_required: true, document_count: 2 })],
      })),
    });
    await pickFile(user);
    const row = (await screen.findByText("Port Charges")).closest("tr")!;
    expect(within(row).getByRole("button", { name: "2" })).toBeInTheDocument();
  });

  it("points at the costing instead of offering to add a line (Q11)", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, { routes: routes(sheet()) });
    await pickFile(user);

    expect(await screen.findByText(/the costing is the budget/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add line/i })).not.toBeInTheDocument();
  });

  it("explains itself when the file has no approved budget", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, {
      routes: routes(sheet({
        can_reconcile: false,
        blocked_reason: "This file has no costing yet. The costing is the budget, so there is nothing to reconcile against.",
        lines: [],
      })),
    });
    await pickFile(user);
    expect(await screen.findByText(/no approved budget on this file/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing to reconcile against/i)).toBeInTheDocument();
  });

  it("names what is outstanding before Finance can be asked", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, {
      routes: routes(sheet({
        lines: [line({ line_id: "rl-1", justification_required: true, proof_missing: true, over_budget: true, reason_required: true, reason_missing: true, actual_ttc: 131250, variance: -12000 })],
        totals: { ...sheet().totals, reasons_missing: 1, proofs_missing: 1 },
      })),
    });
    await pickFile(user);
    expect(await screen.findByText(/before this can go to finance/i)).toBeInTheDocument();
    expect(screen.getByText(/need a supporting document/i)).toBeInTheDocument();
    expect(screen.getByText(/over budget and need a reason/i)).toBeInTheDocument();
  });

  it("stops offering the editor once the sheet is with Finance", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, {
      routes: routes(sheet({ status: "SUBMITTED", reconciliation_id: "r-1" })),
    });
    await pickFile(user);
    await screen.findByText("Port Charges");
    expect(screen.queryByLabelText(/actual spent/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settle/i })).toBeInTheDocument();
  });
});
