import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { PageHeader, DataList, type Column } from "./data-list";
import { useRowSelection } from "@/lib/use-row-selection";
import { BulkBar } from "@/components/ui/table-controls";

/**
 * PageHeader's <h1> (audit F13).
 *
 * The heading used to render ONLY when `description` was absent — and 116 of 117
 * call sites pass one, so almost every screen in the app shipped with no h1 and a
 * flat document outline. These tests pin the fix in both branches.
 */
describe("PageHeader", () => {
  it("renders an h1 when a description is present (the common case)", () => {
    render(
      <PageHeader
        title="Invoices"
        description="Every money event posts to the ledger."
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Invoices",
    );
    expect(
      screen.getByText("Every money event posts to the ledger."),
    ).toBeInTheDocument();
  });

  it("renders an h1 when there is no description", () => {
    render(<PageHeader title="Settings" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Settings",
    );
  });

  it("renders exactly one h1 — never two competing page headings", () => {
    render(
      <PageHeader
        title="Fleet"
        description="Vehicles and dispatch."
        eyebrow={<span>Hub</span>}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <PageHeader title="Invoices" description="Ledger-backed." />,
    );
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
    render(
      <DataList
        {...base}
        rows={rows}
        error="You don't have permission to view this."
        loading={false}
      />,
    );
    expect(
      screen.getByText("You don't have permission to view this."),
    ).toBeInTheDocument();
    expect(screen.queryByText("SBX-2026-0001")).not.toBeInTheDocument();
  });

  it("shows a caller-supplied empty state rather than the generic fallback", () => {
    render(
      <DataList
        {...base}
        rows={[]}
        error={null}
        loading={false}
        empty={{
          title: "No invoices",
          hint: "Issue one from an approved costing.",
        }}
      />,
    );
    expect(screen.getByText("No invoices")).toBeInTheDocument();
    expect(
      screen.getByText("Issue one from an approved costing."),
    ).toBeInTheDocument();
  });

  it("renders rows in a real table with column headers", () => {
    render(<DataList {...base} rows={rows} error={null} loading={false} />);
    expect(
      screen.getByRole("columnheader", { name: "Reference" }),
    ).toBeInTheDocument();
    // Rows render twice (table + mobile card fallback), so scope to the table.
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("SBX-2026-0001");
    expect(table).toHaveTextContent("SBX-2026-0002");
  });

  it("populated table has no axe violations", async () => {
    const { container } = render(
      <DataList {...base} rows={rows} error={null} loading={false} />,
    );
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
  const base = {
    columns,
    rowKey: (r: Row) => r.id,
    error: null,
    loading: false,
  };

  it("exposes a real, focusable, NAMED control per row — not a clickable div", () => {
    render(<DataList {...base} rows={rows} onRowClick={() => {}} />);
    // Named by the record, because column 0 is what identifies it.
    const activator = screen.getAllByRole("button", { name: "SBX-2026-0001" });
    expect(activator.length).toBeGreaterThan(0);
  });

  it("activates by keyboard alone", async () => {
    const seen: Row[] = [];
    render(<DataList {...base} rows={rows} onRowClick={(r) => seen.push(r)} />);
    const activator = screen.getAllByRole("button", {
      name: "SBX-2026-0002",
    })[0];
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
    await userEvent.click(
      screen.getAllByRole("button", { name: "SBX-2026-0001" })[0],
    );
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
    expect(
      screen.queryByRole("button", { name: "SBX-2026-0001" }),
    ).not.toBeInTheDocument();
  });

  it("a clickable list has no axe violations", async () => {
    const { container } = render(
      <DataList {...base} rows={rows} onRowClick={() => {}} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * Keyboard row navigation (Phase 5).
 *
 * Phase 4 gave every row a real button, which fixed "cannot open a row" and
 * created "cannot get past the table" — one tab stop per row, plus row actions.
 * These assert the roving tabindex that undoes it, and — just as importantly —
 * that it did not buy that by dropping table semantics.
 */
describe("DataList keyboard row navigation", () => {
  const base = {
    columns,
    rowKey: (r: Row) => r.id,
    error: null,
    loading: false,
  };
  const many: Row[] = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    ref: `SBX-2026-000${i}`,
    status: "OPEN",
  }));

  const activators = () =>
    screen
      .getByRole("table")
      .querySelectorAll<HTMLElement>("tbody tr td:first-child button");

  it("puts exactly ONE row in the page tab order, not one per row", () => {
    render(<DataList {...base} rows={many} onRowClick={() => {}} />);
    const tabbable = [...activators()].filter((b) => b.tabIndex === 0);
    expect(activators()).toHaveLength(5);
    expect(tabbable).toHaveLength(1);
  });

  it("moves between rows with the arrow keys", async () => {
    render(<DataList {...base} rows={many} onRowClick={() => {}} />);
    const rowButtons = [...activators()];
    rowButtons[0].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(rowButtons[1]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(rowButtons[2]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(rowButtons[1]).toHaveFocus();
  });

  it("Home and End jump to the ends, and neither key runs off them", async () => {
    render(<DataList {...base} rows={many} onRowClick={() => {}} />);
    const rowButtons = [...activators()];
    rowButtons[2].focus();
    await userEvent.keyboard("{End}");
    expect(rowButtons[4]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(rowButtons[4]).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(rowButtons[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(rowButtons[0]).toHaveFocus();
  });

  it("the tab stop follows the row the user clicked into", async () => {
    // Without this, clicking row 4 then pressing ArrowDown would jump to row 1 —
    // the state would still point at wherever the keyboard last was.
    render(<DataList {...base} rows={many} onRowClick={() => {}} />);
    const rowButtons = [...activators()];
    rowButtons[3].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(rowButtons[4]).toHaveFocus();
  });

  it("stays a real table — it does NOT become a grid", () => {
    // The trade Phase 4 refused and this phase also refuses: role="grid" would
    // cost row/column position and header association in browse mode.
    render(<DataList {...base} rows={many} onRowClick={() => {}} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("leaves a non-clickable list's tab order alone", () => {
    render(<DataList {...base} rows={many} />);
    expect(activators()).toHaveLength(0);
  });
});

/**
 * Multi-row selection (Phase 5).
 *
 * SCOPED TO A BRANCH, and that is not tidiness. jsdom does not apply media
 * queries, so `hidden sm:block` and `sm:hidden` both render and every control
 * exists TWICE in the tree. An unscoped `getByRole("checkbox", …)` therefore
 * threw "found multiple elements" the moment the card branch gained its own
 * checkbox — which is the test suite correctly noticing that the phone gap was
 * being closed, not a flake to route around.
 *
 * Both branches are asserted deliberately: the table checkbox and the card
 * checkbox are different code paths for the same capability, and the whole
 * reason this block grew is that only one of them existed.
 */
describe("DataList selection", () => {
  const base = {
    columns,
    rowKey: (r: Row) => r.id,
    error: null,
    loading: false,
  };

  function Harness({ clickable }: { clickable?: (r: Row) => void } = {}) {
    const sel = useRowSelection(rows, (r: Row) => r.id);
    return (
      <DataList {...base} rows={rows} selection={sel} onRowClick={clickable} />
    );
  }

  /** The `hidden sm:block` half — a real <table>. */
  const table = () =>
    within(screen.getByRole("table").closest("div.hidden") as HTMLElement);
  /** The `sm:hidden` half — the phone cards. */
  const cards = () =>
    within(document.querySelector("div.sm\\:hidden") as HTMLElement);

  it("adds a checkbox column NAMED BY THE RECORD, not 'row 2'", () => {
    render(<Harness />);
    expect(
      table().getByRole("checkbox", { name: "Select SBX-2026-0001" }),
    ).toBeInTheDocument();
    expect(
      table().getByRole("checkbox", { name: /select all rows/i }),
    ).toBeInTheDocument();
  });

  it("select-all ticks every row, and untick clears them", async () => {
    render(<Harness />);
    const all = table().getByRole("checkbox", { name: /select all rows/i });
    await userEvent.click(all);
    expect(
      table().getByRole("checkbox", { name: "Select SBX-2026-0001" }),
    ).toBeChecked();
    expect(
      table().getByRole("checkbox", { name: "Select SBX-2026-0002" }),
    ).toBeChecked();
    await userEvent.click(all);
    expect(
      table().getByRole("checkbox", { name: "Select SBX-2026-0001" }),
    ).not.toBeChecked();
  });

  it("reports MIXED when only some rows are selected", async () => {
    render(<Harness />);
    await userEvent.click(
      table().getByRole("checkbox", { name: "Select SBX-2026-0001" }),
    );
    // aria-checked="mixed" is a fact a tick glyph cannot express.
    expect(
      table().getByRole("checkbox", { name: /select all rows/i }),
    ).toHaveAttribute("aria-checked", "mixed");
  });

  it("clicking a checkbox does not also fire the row's navigation", async () => {
    const seen: Row[] = [];
    render(<Harness clickable={(r) => seen.push(r)} />);
    await userEvent.click(
      table().getByRole("checkbox", { name: "Select SBX-2026-0001" }),
    );
    expect(seen).toHaveLength(0);
  });

  it("adds no checkbox anywhere when the screen does not ask for one", () => {
    render(<DataList {...base} rows={rows} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  /* ── the phone half, which did not exist before ────────────────────────── */

  it("THE CARD LIST SELECTS TOO — it was table-only", () => {
    // The checkbox lived in a <th>, so multi-select simply did not exist below
    // 640px: forty records meant forty taps and no bulk action.
    render(<Harness />);
    expect(
      cards().getByRole("checkbox", { name: "Select SBX-2026-0001" }),
    ).toBeInTheDocument();
  });

  it("the card list has its own select-all, since it has no header row", async () => {
    render(<Harness />);
    const all = cards().getByRole("checkbox", { name: "Select all" });
    await userEvent.click(all);
    expect(
      cards().getByRole("checkbox", { name: "Select SBX-2026-0002" }),
    ).toBeChecked();
  });

  it("selecting a card does not also open the record", async () => {
    const seen: Row[] = [];
    render(<Harness clickable={(r) => seen.push(r)} />);
    await userEvent.click(
      cards().getByRole("checkbox", { name: "Select SBX-2026-0001" }),
    );
    expect(seen).toHaveLength(0);
  });

  it("the two branches share one selection — they are views, not copies", async () => {
    render(<Harness />);
    await userEvent.click(
      cards().getByRole("checkbox", { name: "Select SBX-2026-0001" }),
    );
    expect(
      table().getByRole("checkbox", { name: "Select SBX-2026-0001" }),
    ).toBeChecked();
  });

  it("a selectable table has no axe violations", async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * BulkBar (Phase 5) — the thing a selection is FOR.
 */
describe("BulkBar", () => {
  it("announces the selection rather than appearing silently", () => {
    render(
      <BulkBar
        count={3}
        noun="invoice"
        onClear={() => {}}
        actions={<button>Approve</button>}
      />,
    );
    const bar = screen.getByRole("status");
    expect(bar).toHaveAttribute("aria-live", "polite");
    expect(bar).toHaveTextContent("3 invoices selected");
  });

  it("uses the singular for one, and an irregular plural when given one", () => {
    const { rerender } = render(
      <BulkBar count={1} noun="invoice" onClear={() => {}} actions={null} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 invoice selected");
    rerender(
      <BulkBar
        count={2}
        noun="entry"
        nounPlural="entries"
        onClear={() => {}}
        actions={null}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("2 entries selected");
  });

  it("UNMOUNTS at zero rather than hiding", () => {
    // A live region that stays mounted announces its own emptiness on every
    // selection change.
    render(
      <BulkBar
        count={0}
        onClear={() => {}}
        actions={<button>Approve</button>}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
