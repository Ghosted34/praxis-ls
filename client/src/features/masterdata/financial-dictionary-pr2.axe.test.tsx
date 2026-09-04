/**
 * Accessibility gate for the three PR2 surfaces the screen register cannot
 * reach.
 *
 * WHY A SEPARATE FILE. `screens.axe.test.tsx` renders each screen in its four
 * states and scans the tree it gets. For the Financial Dictionary 360 that tree
 * is the OVERVIEW tab — a tab panel only mounts when it is selected, so the
 * Spend chart, the rate timeline and the import modal are never in the scanned
 * DOM no matter how complete the fixtures are. Adding fixtures for
 * `/spend` and `/rate-history` makes those paths resolvable; it does not make
 * them scanned. This does.
 *
 * The three trees here are also the ones most likely to fail a scan: an inline
 * SVG chart (needs a role and a real label, or it is an unlabelled graphic), a
 * data table with a caption and scoped headers, and a modal with a file input
 * that is visually hidden but must keep its accessible name.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
  apiError,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { SpendTab, CostEvolutionTab } from "./financial-dictionary-spend";
import { DictImportModal } from "./financial-dictionary-import";

const SPEND = {
  item: {
    dictionary_item_id: "di1",
    code: "#R001",
    label_fr: "Frais de transit",
    label_en: "Transit fee",
    currency: "XAF",
    direction: "REVENUE",
  },
  period: { from: "2025-09-01", to: "2026-08-09", swapped: false },
  months: [
    {
      month: "2026-06",
      estimated: 120000,
      estimated_count: 1,
      committed: 100000,
      committed_count: 1,
      actual: 90000,
      actual_count: 2,
    },
    // A genuinely empty month — the dense-axis case. It must render as a zero
    // row, not be dropped.
    {
      month: "2026-07",
      estimated: 0,
      estimated_count: 0,
      committed: 0,
      committed_count: 0,
      actual: 0,
      actual_count: 0,
    },
    {
      month: "2026-08",
      estimated: 60000,
      estimated_count: 1,
      committed: 55000,
      committed_count: 1,
      actual: 50000,
      actual_count: 1,
    },
  ],
  totals: {
    estimated: 180000,
    committed: 155000,
    actual: 140000,
    estimated_count: 2,
    committed_count: 2,
    actual_count: 3,
    headline: 140000,
    variance_committed_actual: 15000,
    variance_estimated_actual: 40000,
  },
  documents: [
    {
      lens: "actual",
      doc_type: "cost_entry",
      doc_id: "ce1",
      doc_number: null,
      status: "validated",
      dossier_id: "d1",
      dossier_ref: "SBX-2026-0007",
      amount: 50000,
      currency: "XAF",
      doc_date: "2026-08-02",
      label: "Transit",
    },
    {
      lens: "committed",
      doc_type: "purchase_order",
      doc_id: "po1",
      doc_number: "PO-2026-001",
      status: "ISSUED_LOCKED",
      dossier_id: "d1",
      dossier_ref: "SBX-2026-0007",
      amount: 55000,
      currency: null,
      doc_date: "2026-08-01",
      label: "Transit fee",
    },
  ],
};

const POINTS = [
  {
    expense_rate_id: "er1",
    rate: 100000,
    currency: "XAF",
    effective_from: "2026-01-01",
    effective_to: "2026-05-31",
    in_force: false,
    superseded: true,
    note: null,
  },
  {
    expense_rate_id: "er2",
    rate: 120000,
    currency: "XAF",
    effective_from: "2026-06-01",
    effective_to: null,
    in_force: true,
    superseded: false,
    note: "Annual review",
  },
];
const RATES = {
  item: {
    dictionary_item_id: "di1",
    code: "#R001",
    label_fr: "Frais de transit",
    label_en: "Transit fee",
    currency: "XAF",
    provider_kind: "SHIPPING_LINE",
  },
  series: [
    {
      key: "rp1|ct1",
      rate_provider_id: "rp1",
      provider_kind: "SHIPPING_LINE",
      provider_name: "MAERSK",
      container_type_ref_id: "ct1",
      container_type_code: "FT20",
      container_type_name: "20'",
      currency: "XAF",
      points: POINTS,
      current: POINTS[1],
      trend: {
        first: 100000,
        last: 120000,
        delta: 20000,
        delta_pct: 20,
        direction: "up" as const,
        points: 2,
      },
    },
  ],
  trend: {
    first: 100000,
    last: 120000,
    delta: 20000,
    delta_pct: 20,
    direction: "up" as const,
    points: 2,
  },
};

describe("Financial dictionary — Spend tab", () => {
  it("populated state is axe clean", async () => {
    const { container } = renderScreen(<SpendTab id="di1" />, {
      routes: { "/financial-dictionary/di1/spend": SPEND },
    });
    // Both drill-in rows sit on the same dossier, so this is getAllBy — the
    // dossier ref repeating across documents is the normal case, not an error.
    await waitFor(() =>
      expect(screen.getAllByText(/SBX-2026-0007/).length).toBe(2),
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the chart carries a real accessible label, and the same numbers are in a table", async () => {
    renderScreen(<SpendTab id="di1" />, {
      routes: { "/financial-dictionary/di1/spend": SPEND },
    });
    // The chart is role="img" — without a label it is an unlabelled graphic, and
    // a screen-reader user gets nothing from the whole panel.
    const chart = await screen.findByRole("img", { name: /Spend by month/ });
    expect(chart.getAttribute("aria-label")).toMatch(/2026-06: actual 90000/);
    // The table is the accessible version of the chart, not decoration: every
    // month in the window is a row, including the empty one.
    expect(screen.getByText("2026-07")).toBeTruthy();
  });

  it("loading state is axe clean", async () => {
    const { container } = renderScreen(<SpendTab id="di1" />, {
      pending: true,
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("error state renders an error, not an all-clear empty state", async () => {
    const { container } = renderScreen(<SpendTab id="di1" />, {
      routes: {
        "/financial-dictionary/di1/spend": apiError(
          403,
          "No permission for MOD-12.read",
        ),
      },
    });
    // A 403 must reach the user as an error, NOT be swallowed into an empty
    // state that reads as "no spend" — the Control Tower shipped exactly that
    // (Addendum 6, defect 4). Since F-GAP-09 `errMsg` passes the server's
    // sentence through rather than rewriting it, so assert on that sentence and
    // on the fact that the empty state is absent.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No permission for MOD-12.read");
    expect(screen.queryByText(/No spend in this period/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an unrecognised doc_type degrades to plain text instead of crashing the tab", async () => {
    // `doc_type` crosses a trust boundary — the TS union is a compile-time
    // claim, not a runtime guarantee. Indexing a plain object with it meant an
    // unknown value called `undefined(...)` and took down the whole tab, and
    // "constructor" resolved through the prototype chain to `Object`.
    const odd = {
      ...SPEND,
      documents: [
        {
          ...SPEND.documents[0],
          doc_type: "constructor",
          doc_id: "x1",
          doc_number: null,
        },
        {
          ...SPEND.documents[0],
          doc_type: "supplier_invoice",
          doc_id: "x2",
          doc_number: "SI-9",
        },
      ],
    };
    const { container } = renderScreen(<SpendTab id="di1" />, {
      routes: { "/financial-dictionary/di1/spend": odd },
    });
    // Renders, with a generic label and no link, rather than throwing.
    await waitFor(() => expect(screen.getByText("SI-9")).toBeTruthy());
    expect(screen.getByText("SI-9").closest("a")).toBeNull();
    // The "constructor" row is present too — as a generic label, not an
    // invocation of Object and not a blank row. (Scoped to cells: the column
    // header is also the word "Document".)
    const cells = screen.getAllByRole("cell").map((c) => c.textContent ?? "");
    expect(cells.some((t) => t.startsWith("Document"))).toBe(true);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a period with no movement says so instead of drawing an empty chart", async () => {
    const empty = {
      ...SPEND,
      months: [
        {
          month: "2026-08",
          estimated: 0,
          estimated_count: 0,
          committed: 0,
          committed_count: 0,
          actual: 0,
          actual_count: 0,
        },
      ],
      totals: {
        ...SPEND.totals,
        estimated: 0,
        committed: 0,
        actual: 0,
        headline: 0,
      },
      documents: [],
    };
    const { container } = renderScreen(<SpendTab id="di1" />, {
      routes: { "/financial-dictionary/di1/spend": empty },
    });
    await waitFor(() =>
      expect(screen.getByText(/No spend in this period/)).toBeTruthy(),
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Financial dictionary — Cost & evolution tab", () => {
  it("populated state is axe clean and the timeline is labelled", async () => {
    const { container } = renderScreen(<CostEvolutionTab id="di1" />, {
      routes: { "/financial-dictionary/di1/rate-history": RATES },
    });
    await waitFor(() => expect(screen.getByText(/MAERSK/)).toBeTruthy());
    expect(
      screen.getByRole("img", { name: /Rate history in XAF/ }),
    ).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("an item with no rate cards gets an empty state that says what to do", async () => {
    const { container } = renderScreen(<CostEvolutionTab id="di1" />, {
      routes: {
        "/financial-dictionary/di1/rate-history": {
          ...RATES,
          series: [],
          trend: {
            first: null,
            last: null,
            delta: null,
            delta_pct: null,
            direction: "flat" as const,
            points: 0,
          },
        },
      },
    });
    await waitFor(() => expect(screen.getByText(/No rate cards/)).toBeTruthy());
    expect(await axe(container)).toHaveNoViolations();
  });

  it("error state is axe clean", async () => {
    const { container } = renderScreen(<CostEvolutionTab id="di1" />, {
      routes: {
        "/financial-dictionary/di1/rate-history": apiError(
          500,
          "Upstream failure",
        ),
      },
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBeTruthy();
    expect(screen.queryByText(/No rate cards/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Financial dictionary — import modal", () => {
  it("the opened modal is axe clean and the hidden file input keeps its name", async () => {
    const { container } = renderScreen(
      <DictImportModal open onClose={() => {}} onImported={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Download template/)).toBeTruthy(),
    );
    // Visually hidden (sr-only) but NOT hidden from the accessibility tree — the
    // Upload button clicks it, and a nameless input is unusable by keyboard.
    expect(
      screen.getByLabelText(/Upload a filled dictionary template/),
    ).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders nothing when closed", () => {
    const { container } = renderScreen(
      <DictImportModal open={false} onClose={() => {}} onImported={() => {}} />,
    );
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });
});
