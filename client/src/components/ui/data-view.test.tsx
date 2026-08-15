/**
 * DataView — the replacement for the three raw-JSON dumps in audit A4.
 *
 * The portal case is the one that matters commercially: `portal/pages.tsx:200`
 * rendered `<pre>{JSON.stringify(...)}</pre>` on the surface a tenant's own
 * CUSTOMERS see. These tests assert the fallback is now readable and that
 * internal column names never reach it unformatted.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { DataView } from "./data-view";
import { fieldLabel } from "@/lib/format";

describe("fieldLabel", () => {
  it("humanises raw database columns (A4: headers read `total_ttc`, `client_id`)", () => {
    expect(fieldLabel("total_ttc")).toBe("Total TTC");
    expect(fieldLabel("client_id")).toBe("Client");
    expect(fieldLabel("created_at")).toBe("Created");
    expect(fieldLabel("legal_name")).toBe("Legal name");
  });

  it("preserves OHADA/statutory acronyms instead of sentence-casing them", () => {
    expect(fieldLabel("montant_ht")).toBe("Montant HT");
    expect(fieldLabel("tva_rate")).toBe("TVA rate");
    expect(fieldLabel("niu")).toBe("NIU");
    expect(fieldLabel("coa_code")).toBe("COA code");
  });

  it("handles camelCase and leaves an unknown single word alone", () => {
    expect(fieldLabel("totalAmount")).toBe("Total amount");
    expect(fieldLabel("reference")).toBe("Reference");
  });
});

describe("DataView", () => {
  it("renders an array of objects as a table with humanised headers", () => {
    render(<DataView data={[{ client_id: "c1", total_ttc: 1500 }]} />);
    expect(
      screen.getByRole("columnheader", { name: "Client" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Total TTC" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();
  });

  it("unions keys across rows, so a column missing from row 0 is not dropped", () => {
    render(<DataView data={[{ a: 1 }, { a: 2, b: 3 }]} />);
    expect(screen.getByRole("columnheader", { name: "A" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "B" })).toBeInTheDocument();
  });

  it("renders a bare object as a labelled field list, NOT as JSON", () => {
    render(<DataView data={{ report_key: "ageing", total_ttc: 42 }} />);
    expect(screen.getByText("Report key")).toBeInTheDocument();
    expect(screen.getByText("Total TTC")).toBeInTheDocument();
    // The defect being fixed: no braces, no quotes, no null.
    expect(screen.queryByText(/[{}]/)).not.toBeInTheDocument();
  });

  it("shows an empty state for null instead of the string 'null'", () => {
    render(<DataView data={null} emptyTitle="This report returned no rows" />);
    expect(
      screen.getByText("This report returned no rows"),
    ).toBeInTheDocument();
    expect(screen.queryByText("null")).not.toBeInTheDocument();
  });

  it("shows an empty state for an empty array", () => {
    render(<DataView data={[]} emptyTitle="Nothing to show" />);
    expect(screen.getByText("Nothing to show")).toBeInTheDocument();
  });

  it("formats values through smartCell — ISO dates read as dates, not timestamps", () => {
    render(<DataView data={[{ created_at: "2026-03-21T10:30:00Z" }]} />);
    expect(screen.getByText(/21 Mar 2026/)).toBeInTheDocument();
  });

  it("renders an array of scalars as a list", () => {
    render(<DataView data={["alpha", "beta"]} />);
    expect(screen.getByText("alpha, beta")).toBeInTheDocument();
  });

  it("has no axe violations in the table form", async () => {
    const { container } = render(
      <DataView data={[{ client_id: "c1", total_ttc: 1500 }]} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations in the field-list form", async () => {
    const { container } = render(<DataView data={{ report_key: "ageing" }} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
