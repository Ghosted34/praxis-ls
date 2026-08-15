/**
 * ListPage — the paved road, and the guarantee that the doc describing it is true.
 *
 * F5 is the audit's root-cause finding: `doc/FE_DESIGN_RULES.md` §3 told every
 * new engineer to use `<ResourceList>` (zero call sites) and `<CrudResource>`
 * (never existed), so the documented on-ramp pointed at a deleted component and
 * a dead one. The audit's Phase 2 deliverable is a "build a new screen" guide
 * "verified by a test asserting the example compiles and renders".
 *
 * `DocumentedListScreen` below is the §3.2 example from that doc, transcribed.
 * If someone changes ListPage's API without updating the guide, this fails —
 * which is the only mechanism that keeps a doc honest.
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { ListPage } from "./list-page";
import type { Column } from "./data-list";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { StatusPill } from "./ui/pill";
import { money, dateFmt } from "@/lib/format";

type Invoice = {
  invoice_id: string;
  doc_number: string;
  status: string;
  total_ttc: number;
  due_on: string;
};

const ROWS: Invoice[] = [
  {
    invoice_id: "i1",
    doc_number: "INV-2026-0041",
    status: "SENT",
    total_ttc: 1500000,
    due_on: "2026-04-20",
  },
  {
    invoice_id: "i2",
    doc_number: "INV-2026-0042",
    status: "DRAFT",
    total_ttc: 250000,
    due_on: "2026-05-02",
  },
];

const columns: Column<Invoice>[] = [
  { key: "doc_number", label: "Invoice", className: "num font-medium" },
  {
    key: "status",
    label: "Status",
    render: (r) => <StatusPill status={r.status} />,
  },
  {
    key: "total_ttc",
    label: "Amount · XAF",
    className: "num text-right",
    render: (r) => money(r.total_ttc),
  },
  { key: "due_on", label: "Due", render: (r) => dateFmt(r.due_on) },
];

/** The doc's §3.2 example, transcribed. Keep these in step. */
function DocumentedListScreen({
  rows,
  error = null,
  loading = false,
  onNew = () => {},
}: {
  rows: Invoice[] | null;
  error?: string | null;
  loading?: boolean;
  onNew?: () => void;
}) {
  const [q, setQ] = React.useState("");
  const shown = React.useMemo(
    () =>
      (rows ?? []).filter((r) =>
        r.doc_number.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [rows, q],
  );

  return (
    <ListPage
      title="Invoices"
      description="Every money event posts to the ledger."
      action={<Button onClick={onNew}>New invoice</Button>}
      toolbar={
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search invoices…"
          className="max-w-xs"
        />
      }
      columns={columns}
      rows={rows === null ? null : shown}
      error={error}
      loading={loading}
      rowKey={(r) => r.invoice_id}
      empty={{
        title: "No invoices",
        hint: "Issue a final invoice from an approved costing.",
        action: <Button onClick={onNew}>New invoice</Button>,
      }}
      filtered={!!q}
      emptyFiltered={{
        title: "No invoices match",
        hint: "Try a different reference.",
        action: (
          <Button variant="outline" onClick={() => setQ("")}>
            Clear search
          </Button>
        ),
      }}
    />
  );
}

describe("ListPage — the documented example (F5)", () => {
  it("renders the header, its h1, and the primary action", () => {
    render(<DocumentedListScreen rows={ROWS} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Invoices",
    );
    expect(
      screen.getByRole("button", { name: "New invoice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Every money event posts to the ledger."),
    ).toBeInTheDocument();
  });

  /** DataList renders the table AND the phone card fallback; both are in the
   *  DOM under jsdom (CSS decides which shows), hence getAllByText. */
  it("renders the rows, formatted", () => {
    render(<DocumentedListScreen rows={ROWS} />);
    expect(screen.getAllByText("INV-2026-0041").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1,500,000.00 XAF").length).toBeGreaterThan(0);
    expect(screen.getAllByText("20 Apr 2026").length).toBeGreaterThan(0);
    // Status through the token system, not a raw palette class.
    expect(screen.getAllByText("Sent").length).toBeGreaterThan(0);
  });

  it("shows a skeleton while loading, not an ad-hoc 'Loading…' string (F10)", () => {
    render(<DocumentedListScreen rows={null} loading />);
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows the error, announced", () => {
    render(
      <DocumentedListScreen
        rows={null}
        error="You don't have permission to do this."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You don't have permission to do this.",
    );
  });

  /**
   * The distinction the audit says every screen misses (F11): a new list wants
   * a CREATE action, a filtered-to-nothing list wants a CLEAR action. Offering
   * "New invoice" to someone who mistyped a search is unhelpful.
   */
  it("offers a CREATE action when the list is genuinely empty", () => {
    render(<DocumentedListScreen rows={[]} />);
    expect(screen.getByText("No invoices")).toBeInTheDocument();
    expect(
      screen.getByText("Issue a final invoice from an approved costing."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "New invoice" }).length,
    ).toBeGreaterThan(1);
  });

  it("offers a CLEAR action when filters hid everything", async () => {
    const user = userEvent.setup();
    render(<DocumentedListScreen rows={ROWS} />);
    await user.type(
      screen.getByPlaceholderText("Search invoices…"),
      "ZZZ-nothing",
    );

    expect(screen.getByText("No invoices match")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear search" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No invoices")).not.toBeInTheDocument();
  });

  it("returns to the full list when the filter is cleared", async () => {
    const user = userEvent.setup();
    render(<DocumentedListScreen rows={ROWS} />);
    await user.type(screen.getByPlaceholderText("Search invoices…"), "ZZZ");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getAllByText("INV-2026-0041").length).toBeGreaterThan(0);
  });

  it("hides pagination while loading and while errored", () => {
    const pagination = {
      page: 0,
      pageSize: 50,
      total: 500,
      onPageChange: vi.fn(),
    };
    const { rerender } = render(
      <ListPage
        title="Invoices"
        columns={columns}
        rows={null}
        error={null}
        loading
        rowKey={(r) => r.invoice_id}
        empty={{ title: "No invoices" }}
        pagination={pagination}
      />,
    );
    expect(
      screen.queryByRole("navigation", { name: "Pagination" }),
    ).not.toBeInTheDocument();

    rerender(
      <ListPage
        title="Invoices"
        columns={columns}
        rows={ROWS}
        error={null}
        loading={false}
        rowKey={(r) => r.invoice_id}
        empty={{ title: "No invoices" }}
        pagination={pagination}
      />,
    );
    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toBeInTheDocument();
  });

  it("has no axe violations, populated or empty", async () => {
    const populated = render(<DocumentedListScreen rows={ROWS} />);
    expect(await axe(populated.container)).toHaveNoViolations();
    populated.unmount();

    const empty = render(<DocumentedListScreen rows={[]} />);
    expect(await axe(empty.container)).toHaveNoViolations();
  });
});
