/**
 * The three surfaces that had never rendered, rendering.
 *
 * WHY THIS FILE EXISTS AT ALL. The grounding footer, the Sources tab and the
 * Record tab were fully built and shipped dead: they all derived their input
 * from markdown links in the answer, and the model does not write markdown links
 * — the system prompt tells it not to show identifiers. Nothing failed, nothing
 * threw; the footer simply never appeared, for months. That is the failure mode
 * this file is aimed at, so every case below deliberately uses an answer with NO
 * links in it — prose in exactly the plain business language the assistant is
 * instructed to write — and asserts the surface lights up anyway, from the
 * `sources` the backend derived from the reads it ran.
 *
 * `grounding.test.ts` pins the pure derivation and `tests/unit/ai-answer-sources.test.js`
 * pins the server's. This pins the join: wire shape in, pixels out.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AiTurnView } from "@/components/ai/turn";
import { AiRightPane, EMPTY_PANE, type PaneState } from "./right-pane";
import type { AiTurn } from "@/components/ai/thread";

/** An answer written the way the assistant is actually told to write: names, no links. */
const ANSWER = "Two invoices are overdue: SBX-INV-0031 (42 days) and SBX-INV-0044 (11 days).";

const turn = (extra: Partial<AiTurn> = {}): AiTurn =>
  ({ id: "t1", role: "assistant", text: ANSWER, ...extra }) as AiTurn;

/** Router for the chips' `<Link>`s, TooltipProvider for the toolbar — both are
 *  ambient at the app root (`main.tsx`), so mounting them here is not scaffolding
 *  around the component, it is the context it always runs in. */
function mount(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>,
  );
}

function renderTurn(t: AiTurn) {
  return mount(<AiTurnView turn={t} isLast confirming={null} doneActions={{}} onConfirmAction={vi.fn()} />);
}

describe("the grounding footer", () => {
  it("renders from backend sources, on an answer containing no links", () => {
    // The whole bug in one assertion: derivation from the prose finds nothing
    // here, and the footer still has to appear.
    expect(ANSWER).not.toMatch(/\]\(/);
    renderTurn(turn({ sources: [{ label: "Invoices · 2", href: "/finance/invoices", kind: "record" }] }));

    expect(screen.getByText("Based on")).toBeInTheDocument();
    const chip = screen.getByRole("link", { name: /Invoices · 2/ });
    expect(chip).toHaveAttribute("href", "/finance/invoices");
  });

  it("stays absent when the turn cited nothing, rather than drawing an empty rule", () => {
    renderTurn(turn());
    expect(screen.queryByText("Based on")).not.toBeInTheDocument();
  });

  it("lets a backend source override a link the model happened to write", () => {
    // Both describe /finance/invoices. The backend's wins because it carries the
    // permission the read was made under; prose only carries what was mentioned.
    renderTurn(
      turn({
        text: "See [the list](/finance/invoices).",
        sources: [{ label: "Invoices · 12", href: "/finance/invoices", kind: "record" }],
      }),
    );
    expect(screen.getByRole("link", { name: /Invoices · 12/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "the list" })).not.toBeInTheDocument();
  });
});

describe("the trace disclosure", () => {
  it("renders the backend's steps, collapsed, in order", async () => {
    renderTurn(turn({ trace: ["Read receivables ageing — computed", "Read final invoices (status: OVERDUE) — 2 records"] }));

    const summary = screen.getByText("Trace · 2 steps");
    expect(summary).toBeInTheDocument();
    // Collapsed by default: this is provenance for the moment you doubt an
    // answer, not something to open on a good one.
    expect(summary.closest("details")).not.toHaveAttribute("open");

    await userEvent.click(summary);
    const steps = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(steps).toEqual([
      "Read receivables ageing — computed",
      "Read final invoices (status: OVERDUE) — 2 records",
    ]);
  });

  it("stays absent without steps — an unpopulated trace must not draw a control", () => {
    renderTurn(turn());
    expect(screen.queryByText(/^Trace ·/)).not.toBeInTheDocument();
  });
});

describe("the right pane's Sources and Record tabs", () => {
  const sources = [
    { label: "Invoices · 2", href: "/finance/invoices", kind: "record" as const },
    { label: "Receivables", href: "/finance/receivables", kind: "report" as const },
  ];

  function renderPane(state: Partial<PaneState> = {}) {
    const onChange = vi.fn();
    mount(<AiRightPane state={{ ...EMPTY_PANE, tab: "sources", sources, ...state }} onChange={onChange} onClose={vi.fn()} />);
    return onChange;
  }

  it("enables the Sources tab and lists what the thread stands on", () => {
    renderPane();
    expect(screen.getByRole("tab", { name: "Sources" })).toBeEnabled();
    expect(screen.getByText(/2 references across this conversation/)).toBeInTheDocument();
    for (const s of sources) expect(screen.getByText(s.label)).toBeInTheDocument();
  });

  it("previewing a source moves to the Record tab carrying that source", async () => {
    const onChange = renderPane();
    await userEvent.click(screen.getByText("Invoices · 2"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tab: "record", record: sources[0] }));
  });

  it("resolves the citation against the screen registry, and links somewhere real", () => {
    renderPane({ tab: "record", record: sources[0] });
    // The href is the SCREEN, not a record route — the app is hub-routed and a
    // record-suffixed path would land on the catch-all redirect to "/".
    expect(screen.getByText("Invoices · 2")).toBeInTheDocument();
    expect(screen.getByText("Lives on")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Open / })).toHaveAttribute("href", "/finance/invoices");
  });
});
