/**
 * THE ONE VISUAL (§6.2) and the lazy seam it rides on.
 *
 * These tests pin three properties the rest of the PR leans on:
 *
 *   1. THE CONSUMPTION TRACK SAYS THE STATE IN TEXT. "100% gone" is a fact on
 *      the track, an overrun draws past the track's end and reads "over
 *      budget" — the same state the legend carries in words, so the colour is
 *      never the only signal (§3.4's rule that a pill's tone and a chart's
 *      hue are emphasis, not meaning).
 *   2. THE WRAPPER RENDERS THE IMPLEMENTATION THROUGH A REAL DYNAMIC IMPORT.
 *      One Suspense at a time — jsdom drops one boundary off a triple-opened
 *      identical import, which is a test environment fact, not a product fact
 *      (the real bundle fences recharts into its own chunk via
 *      ROUTE_LOCAL_VENDOR + check:bundle).
 *   3. THE ENVIRONMENT RULE: every visual here resolves their colour from a
 *      CSS variable — no hex literal can be in a chart file (check:palette's
 *      chart rule), and this test's job is not to re-assert that (it scans
 *      the source), only to keep the public API accepting text + numbers,
 *      never style props.
 *
 * `chart-impl` is mocked at the module seam — the point under test is the
 * wrapper, not recharts, and ResponsiveContainer wants a ResizeObserver that
 * jsdom does not implement.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
// The app root wraps TooltipProvider (main.tsx) — so does this unit.
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/components/ui/chart-impl", () => ({
  __esModule: true,
  SeriesBarsChart: ({
    data,
    onPointClick,
  }: {
    data: Array<{ label: string; values: Record<string, number> }>;
    onPointClick?: (point: { label: string; values: Record<string, number> }, index: number) => void;
  }) => (
    <button data-testid="bars-impl" onClick={() => onPointClick?.(data[0], 0)}>
      Mock bar
    </button>
  ),
  WaterfallChart: () => <div data-testid="waterfall-impl" />,
  TrendChart: () => <div data-testid="trend-impl" />,
}));

import { Chart, ConsumptionTrack, SeriesBars, Waterfall, Trend } from "@/components/ui/chart";

const RENDER_LABELS = {
  labels: { budget: "Budget", disbursed: "Disbursed", actual: "Actual" },
  values: { budget: "119 250", disbursed: "119 250", actual: "119 250" },
};

describe("the consumption track (§6.2)", () => {
  const renderTrack = (props: Parameters<typeof ConsumptionTrack>[0]) =>
    render(<TooltipProvider><ConsumptionTrack {...props} /></TooltipProvider>);

  it("reads budget as the scale and says how much of it is gone", () => {
    renderTrack({ budget: 119250, disbursed: 119250, actual: 119250, ...RENDER_LABELS });
    expect(screen.getByText("100% gone")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining("100% of the budget is gone"));
  });

  it("an overrun is a state — text and budget-edge marker, not a bigger bar", () => {
    renderTrack({ budget: 100, disbursed: 100, actual: 112, ...RENDER_LABELS });
    expect(screen.getByText(/112% — over budget/)).toBeInTheDocument();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("over budget");
  });

  it("a zero budget does not invent a percentage", () => {
    renderTrack({ budget: 0, disbursed: 0, actual: 0, ...RENDER_LABELS });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("the tooltip text is the caller's words, never a number the track formatted", () => {
    const { container } = renderTrack({ budget: 100, disbursed: 100, actual: 50, ...RENDER_LABELS });
    expect(container.textContent).toContain("Budget · 119 250");
    expect(container.textContent).toContain("Disbursed · 119 250");
    expect(container.textContent).toContain("Actual · 119 250");
  });
});

describe("the Chart shell", () => {
  it("is a labelled figure — the caption is required, the role is stated", () => {
    render(
      <Chart title="Spend by line" description="three series per line" ariaLabel="budget against disbursed against actual" height={200}>
        <div>inside</div>
      </Chart>,
    );
    expect(screen.getByText("Spend by line")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "budget against disbursed against actual");
  });
});

describe("the lazy seam — one Suspense at a time", () => {
  it("SeriesBars resolves the impl through the wrapper's dynamic import", async () => {
    render(
      <SeriesBars
        data={[{ label: "Port", values: { budget: 10, actual: 12 } }]}
        series={[{ key: "budget", label: "Budget", tone: "neutral" }, { key: "actual", label: "Actual", tone: "ok" }]}
      />,
    );
    // The fallback lives first — the lazy promise has to flush — then the impl.
    expect(await screen.findByTestId("bars-impl")).toBeInTheDocument();
  });

  it("forwards a tapped bar's exact point to an interactive chart", async () => {
    const onPointClick = vi.fn();
    render(
      <SeriesBars
        data={[{ label: "JBS Praxis", values: { blocked: 2 } }]}
        series={[{ key: "blocked", label: "Blocked", tone: "warn" }]}
        selectedLabel="JBS Praxis"
        onPointClick={onPointClick}
      />,
    );

    fireEvent.click(await screen.findByTestId("bars-impl"));
    expect(onPointClick).toHaveBeenCalledWith(
      { label: "JBS Praxis", values: { blocked: 2 } },
      0,
    );
  });

  it("Waterfall resolves through the same seam, its labels declared by the caller", async () => {
    render(<Waterfall data={[{ label: "Budget", kind: "total", value: 100 }]} />);
    expect(await screen.findByTestId("waterfall-impl")).toBeInTheDocument();
  });

  it("Trend resolves too", async () => {
    render(<Trend data={[{ label: "01/09", value: 10, benchmark: 100 }]} />);
    expect(await screen.findByTestId("trend-impl")).toBeInTheDocument();
  });
});
