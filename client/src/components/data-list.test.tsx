import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
