import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { PageHeader, DataList, type Column } from "./data-list";

/**
 * PageHeader's <h1> (audit F13).
 *
 * The heading used to render ONLY when `description` was absent — and 116 of 117
 * call sites pass one, so almost every screen in the app shipped with no h1 and a
 * flat document outline. These tests pin the fix in both branches.
 */
describe("PageHeader", () => {
  it("renders an h1 when a description is present (the common case)", () => {
    render(<PageHeader title="Invoices" description="Every money event posts to the ledger." />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Invoices");
    expect(screen.getByText("Every money event posts to the ledger.")).toBeInTheDocument();
  });

  it("renders an h1 when there is no description", () => {
    render(<PageHeader title="Settings" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
  });

  it("renders exactly one h1 — never two competing page headings", () => {
    render(<PageHeader title="Fleet" description="Vehicles and dispatch." eyebrow={<span>Hub</span>} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(<PageHeader title="Invoices" description="Ledger-backed." />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

type Row = { id: string; ref: string; status: string };
const columns: Column<Row>[] = [
  { key: "ref", label: "Reference" },
  { key: "status", label: "Status" },
];
const rows: Row[] = [
  { id: "1", ref: "SBX-2026-0001", status: "OPEN" },
  { id: "2", ref: "SBX-2026-0002", status: "CLOSED" },
];

describe("DataList states", () => {
  const base = { columns, rowKey: (r: Row) => r.id };

  it("shows a loading skeleton with an accessible status role", () => {
    render(<DataList {...base} rows={null} error={null} loading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows the error state in preference to rows", () => {
    render(<DataList {...base} rows={rows} error="You don't have permission to view this." loading={false} />);
    expect(screen.getByText("You don't have permission to view this.")).toBeInTheDocument();
    expect(screen.queryByText("SBX-2026-0001")).not.toBeInTheDocument();
  });

  it("shows a caller-supplied empty state rather than the generic fallback", () => {
    render(
      <DataList
        {...base}
        rows={[]}
        error={null}
        loading={false}
        empty={{ title: "No invoices", hint: "Issue one from an approved costing." }}
      />,
    );
    expect(screen.getByText("No invoices")).toBeInTheDocument();
    expect(screen.getByText("Issue one from an approved costing.")).toBeInTheDocument();
  });

  it("renders rows in a real table with column headers", () => {
    render(<DataList {...base} rows={rows} error={null} loading={false} />);
    expect(screen.getByRole("columnheader", { name: "Reference" })).toBeInTheDocument();
    // Rows render twice (table + mobile card fallback), so scope to the table.
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("SBX-2026-0001");
    expect(table).toHaveTextContent("SBX-2026-0002");
  });

  it("populated table has no axe violations", async () => {
    const { container } = render(<DataList {...base} rows={rows} error={null} loading={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * Row activation (audit F9, F13).
 *
 * `onRowClick` was attached to a `<tr>` and, on phones, to a bare `<div>` — no
 * role, no tabIndex, no key handler. The primary navigation gesture on most list
 * screens in this product worked for the mouse and for nothing else. F13 counted
 * 23 such handlers across 16 files; this component is the one that multiplied
 * across every screen, so it is the one worth pinning.
 */
describe("DataList row activation", () => {
  const base = { columns, rowKey: (r: Row) => r.id, error: null, loading: false };

  it("exposes a real, focusable, NAMED control per row — not a clickable div", () => {
    render(<DataList {...base} rows={rows} onRowClick={() => {}} />);
    // Named by the record, because column 0 is what identifies it.
    const activator = screen.getAllByRole("button", { name: "SBX-2026-0001" });
    expect(activator.length).toBeGreaterThan(0);
  });

  it("activates by keyboard alone", async () => {
    const seen: Row[] = [];
    render(<DataList {...base} rows={rows} onRowClick={(r) => seen.push(r)} />);
    const activator = screen.getAllByRole("button", { name: "SBX-2026-0002" })[0];
    activator.focus();
    expect(activator).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(seen).toHaveLength(1);
    expect(seen[0].ref).toBe("SBX-2026-0002");
  });

  it("fires the row handler exactly ONCE on a mouse click, not twice", async () => {
    // The activator sits inside the row, so without stopPropagation a click on it
    // would bubble to the row's own handler and navigate twice.
    const seen: Row[] = [];
    render(<DataList {...base} rows={rows} onRowClick={(r) => seen.push(r)} />);
    await userEvent.click(screen.getAllByRole("button", { name: "SBX-2026-0001" })[0]);
    expect(seen).toHaveLength(1);
  });

  it("keeps table semantics — the row is still a row, not a button", () => {
    render(<DataList {...base} rows={rows} onRowClick={() => {}} />);
    // The tempting fix was <tr role="button">, which would have cost row/column
    // position and header association on a 200-row table.
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").length).toBe(rows.length + 1); // + header
  });

  it("adds no buttons when the list is not clickable", () => {
    render(<DataList {...base} rows={rows} />);
    expect(screen.queryByRole("button", { name: "SBX-2026-0001" })).not.toBeInTheDocument();
  });

  it("a clickable list has no axe violations", async () => {
    const { container } = render(<DataList {...base} rows={rows} onRowClick={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
