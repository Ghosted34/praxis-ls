/**
 * `DataList` must not take the page down when a list endpoint changes shape.
 *
 * Reported live, FATAL, on `/hr/trainings`:
 *
 *   TypeError: n.map is not a function     assets/data-list-*.js
 *
 * The guards were `rows === null` and `rows.length === 0`. Neither is true for
 * an OBJECT — `({}).length` is `undefined`, and `undefined === 0` is false — so
 * a `{ rows: [...], total: n }` body sailed past both and reached `rows.map()`.
 * An error boundary caught it and the screen went blank.
 *
 * `useList` has coerced against this for a while and explains why in its own
 * comment. Screens built on `useResource` get their payload back untouched, so
 * they had nothing between a changed endpoint and a white page. This is that
 * missing guard, at the one place every list screen goes through.
 *
 * It reports rather than silently rendering an empty table: "no records" would
 * be a lie about a real defect, and a lie that stays unnoticed.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataList, type Column } from "./data-list";

type Row = Record<string, unknown>;
const columns: Column<Row>[] = [
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
];
const base = {
  columns,
  error: null,
  loading: false,
  rowKey: (r: Row, i: number) => String(r.id ?? i),
};

describe("DataList · unexpected payload shapes", () => {
  it("renders rows when given an array", () => {
    render(<DataList {...base} rows={[{ id: "1", name: "Forklift safety" }]} />);
    // Table (sm+) and card (below sm) both render in jsdom, so the row text
    // appears twice — the assertion is that it rendered at all.
    expect(screen.getAllByText("Forklift safety").length).toBeGreaterThan(0);
  });

  it("shows the skeleton, not a crash, while rows are null", () => {
    const { container } = render(<DataList {...base} rows={null} />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it("shows the empty state for a genuinely empty list", () => {
    render(
      <DataList {...base} rows={[]} empty={{ title: "No trainings yet" }} />,
    );
    expect(screen.getByText("No trainings yet")).toBeInTheDocument();
  });

  it.each([
    ["a paged envelope", { rows: [{ id: "1" }], total: 1 }],
    ["a bare object", { anything: true }],
    ["a string", "not a list"],
    ["a number", 42],
  ])("reports instead of crashing on %s", (_label, payload) => {
    // The cast is the point: this is what a changed endpoint does at RUNTIME,
    // which the type system cannot stop.
    expect(() =>
      render(<DataList {...base} rows={payload as unknown as Row[]} />),
    ).not.toThrow();
    expect(screen.getByText(/unexpected shape/i)).toBeInTheDocument();
  });

  it("does not claim the list is empty when it is malformed", () => {
    render(
      <DataList
        {...base}
        rows={{ rows: [], total: 0 } as unknown as Row[]}
        empty={{ title: "No trainings yet" }}
      />,
    );
    // "No trainings yet" here would be a wrong answer about a real defect.
    expect(screen.queryByText("No trainings yet")).toBeNull();
    expect(screen.getByText(/unexpected shape/i)).toBeInTheDocument();
  });
});
