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

/**
 * The Full view's charts are mocked AT THE WRAPPER SEAM (chart.tsx), with
 * the wrapper's real ConsumptionTrack / Chart shell kept — recharts itself
 * is jsdom's enemy (ResponsiveContainer wants a ResizeObserver), and mocking
 * the impl module makes the drawer triple-suspend the same dynamic import,
 * which the jsdom scheduler drops one of (all three resolve in the real
 * bundle: ROUTE_LOCAL_VENDOR keeps them out of the page chunk statically).
 * What this pins instead, and what Q15 is actually about: the drawer asks
 * the wrapper for charts, the charts appear ONCE OPENED, the timeline fetch
 * exists only because somebody asked for the picture — and no test ever had
 * to know what a d3 scale is. The wrapper-to-impl lazy seam has its own unit
 * test in components/ui/chart.test.tsx, one Suspense at a time.
 */
vi.mock("@/components/ui/chart", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/chart")>();
  return {
    ...actual,
    SeriesBars: () => <div data-testid="bars-chart" />,
    Waterfall: () => <div data-testid="waterfall-chart" />,
    Trend: () => <div data-testid="trend-chart" />,
  };
});

import * as apiClient from "@/lib/api-client";
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

const TIMELINE = {
  days: [
    { day: "2026-09-01", actual_ttc: 50000 },
    { day: "2026-09-04", actual_ttc: 69250 },
  ],
  budget_ttc: 119250,
  currency: "XAF",
  grades: null,
};

const routes = (s: unknown) => ({
  "/operations": [{ dossier_id: DOSSIER, ref: "SLAS-OPS-2026-0117" }],
  [`/costing/reconciliations/${DOSSIER}`]: s,
  [`/costing/reconciliations/${DOSSIER}/timeline`]: TIMELINE,
  "/smartcomm/colleagues": [
    { user_id: "u-2", full_name: "Alice Ngo" },
    { user_id: "u-3", full_name: "Jean Mballa" },
  ],
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


/**
 * THE PICTURE (PR 3). The ConsumptionTrack is the one visual on the sheet;
 * the Full view is three lazy charts behind a button (§6.2); the statement
 * is an export, and the operator picks its shape (Q19).
 */
describe("the picture and the statement (PR 3)", () => {
  it("renders the consumption track on the sheet, with the budget as the scale", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, { routes: routes(sheet()) });
    await pickFile(user);
    await screen.findByText("Port Charges");
    // One track, "% gone" caption — and NOT the old three-meter group it
    // replaced (MeterGroup stays in the kit, for screens that mean several
    // separate gauges on one scale; this sheet means ONE track).
    expect(await screen.findByText(/100% gone/)).toBeInTheDocument();
  });

  it("shows the three grades with their QUESTIONS (Q17)", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, { routes: routes(sheet()) });
    await pickFile(user);
    await screen.findByText("Port Charges");
    expect(screen.getByText(/Did we execute to plan\?/)).toBeInTheDocument();
    expect(screen.getByText(/Is the cash accounted for\?/)).toBeInTheDocument();
    expect(screen.getByText(/Did the file make money\?/)).toBeInTheDocument();
  });

  it("opens the Full view and the charts land lazily — the timeline fetch fires only now", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, { routes: routes(sheet()) });
    await pickFile(user);
    await screen.findByText("Port Charges");

    const tenantSpy = vi.spyOn(apiClient, "tenant");
    expect(tenantSpy.mock.calls.some(([p]) => String(p).includes("/timeline"))).toBe(false);

    await user.click(screen.getByRole("button", { name: /full view/i }));
    expect(await screen.findByText("Full view — the picture of the file")).toBeInTheDocument();
    expect(await screen.findByTestId("bars-chart")).toBeInTheDocument();
    expect(await screen.findByTestId("waterfall-chart")).toBeInTheDocument();
    // The timeline is fetched only because the drawer asked — never when the
    // sheet alone was read (Q15: the page must not pay for its own picture).
    await waitFor(() => {
      expect(tenantSpy.mock.calls.some(([p]) => String(p).includes("/timeline"))).toBe(true);
    });
    expect(await screen.findByTestId("trend-chart")).toBeInTheDocument();
    tenantSpy.mockRestore();
  });

  it("lets the operator pick the statement's format — both shapes go through the same download seam (Q19)", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, { routes: routes(sheet()) });
    await pickFile(user);
    await screen.findByText("Port Charges");
    const dlSpy = vi.spyOn(apiClient, "tenantDownload");

    await user.click(screen.getByRole("button", { name: /statement…/i }));
    await user.click(await screen.findByRole("button", { name: /PDF \(print\)/i }));
    await waitFor(() => expect(dlSpy).toHaveBeenCalled());
    const firstUrl = String(dlSpy.mock.calls.at(-1)?.[0] ?? "");
    expect(firstUrl).toContain(`statement?format=pdf`);

    await user.click(screen.getByRole("button", { name: /statement…/i }));
    await user.click(await screen.findByRole("button", { name: /Excel \(audit\)/i }));
    await waitFor(() => expect(dlSpy).toHaveBeenCalledTimes(2));
    expect(String(dlSpy.mock.calls.at(-1)?.[0] ?? "")).toContain(`statement?format=xlsx`);
    dlSpy.mockRestore();
  });

  it("posts the statement into Smart Comm, in-house only — a vault pointer, never bytes (Q19-C)", async () => {
    const user = userEvent.setup();
    renderScreen(<ReconciliationPage />, { routes: routes(sheet({ reconciliation_id: "r-1" })) });
    await pickFile(user);
    await screen.findByText("Port Charges");
    const postSpy = vi.spyOn(apiClient, "tenant");

    await user.click(screen.getByRole("button", { name: /send…/i }));
    expect(await screen.findByText("Send the statement")).toBeInTheDocument();
    // Default: the file's channel — not an email, not a DM.
    await user.click(screen.getByRole("button", { name: /^send$/i }));
    await waitFor(() => {
      const sendCall = postSpy.mock.calls.find(([p, o]) =>
        String(p).includes("/statement/send") && (o as { method?: string })?.method === "POST");
      expect(sendCall).toBeTruthy();
      expect(sendCall?.[1]).toMatchObject({ body: { target: "channel" } });
    });
    postSpy.mockRestore();
  });
});
