/**
 * Row selection, column visibility and CSV export (Phase 5).
 *
 * Each test here corresponds to a property the doc comments claim, and the
 * claims are the load-bearing part: "selection is pruned to what is on screen"
 * is a safety property of every bulk write in the app, and "hidden columns are
 * what persists" is the difference between a preference that survives a new
 * column and one that hides it from everyone forever.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRowSelection } from "@/lib/use-row-selection";
import { useColumnVisibility } from "@/lib/use-column-visibility";
import { toCsv } from "@/lib/export-csv";
import type { Column } from "@/components/data-list";

type Row = { id: string; name: string };
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id, name: `Row ${id}` }));
const key = (r: Row) => r.id;

describe("useRowSelection", () => {
  it("toggles one row at a time", () => {
    const { result } = renderHook(() => useRowSelection(rows("a", "b", "c"), key));
    act(() => result.current.toggle("b"));
    expect(result.current.count).toBe(1);
    expect(result.current.selectedRows.map(key)).toEqual(["b"]);
    act(() => result.current.toggle("b"));
    expect(result.current.count).toBe(0);
  });

  it("shift-click selects the range from the last plain click, in visual order", () => {
    const { result } = renderHook(() => useRowSelection(rows("a", "b", "c", "d", "e"), key));
    act(() => result.current.toggle("b"));
    act(() => result.current.toggle("d", { shift: true }));
    expect(result.current.selectedRows.map(key)).toEqual(["b", "c", "d"]);
  });

  it("extends a range upwards as readily as downwards", () => {
    const { result } = renderHook(() => useRowSelection(rows("a", "b", "c", "d"), key));
    act(() => result.current.toggle("d"));
    act(() => result.current.toggle("b", { shift: true }));
    expect(result.current.selectedRows.map(key)).toEqual(["b", "c", "d"]);
  });

  it("shift with no anchor behaves as a plain click", () => {
    const { result } = renderHook(() => useRowSelection(rows("a", "b"), key));
    act(() => result.current.toggle("b", { shift: true }));
    expect(result.current.selectedRows.map(key)).toEqual(["b"]);
  });

  it("PRUNES the action's scope to rows still on screen", () => {
    // The property that keeps a bulk write from touching records the user
    // filtered away and can no longer see.
    const { result, rerender } = renderHook(({ r }) => useRowSelection(r, key), {
      initialProps: { r: rows("a", "b", "c") },
    });
    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("c"));
    expect(result.current.count).toBe(2);

    rerender({ r: rows("a") }); // a filter now hides b and c
    expect(result.current.count).toBe(1);
    expect(result.current.selectedRows.map(key)).toEqual(["a"]);
  });

  it("restores a hidden selection when the filter is cleared", () => {
    // Keys are retained rather than deleted: the user's intent survives, only
    // the action's scope narrows.
    const { result, rerender } = renderHook(({ r }) => useRowSelection(r, key), {
      initialProps: { r: rows("a", "b", "c") },
    });
    act(() => result.current.toggle("c"));
    rerender({ r: rows("a") });
    expect(result.current.count).toBe(0);
    rerender({ r: rows("a", "b", "c") });
    expect(result.current.selectedRows.map(key)).toEqual(["c"]);
  });

  it("select-all covers only what is on screen, and clears only that", () => {
    const { result, rerender } = renderHook(({ r }) => useRowSelection(r, key), {
      initialProps: { r: rows("a", "b", "c") },
    });
    act(() => result.current.toggle("c"));
    rerender({ r: rows("a", "b") }); // c filtered out but still remembered

    act(() => result.current.toggleAll());
    expect(result.current.selectedRows.map(key)).toEqual(["a", "b"]);
    act(() => result.current.toggleAll()); // clears a and b
    rerender({ r: rows("a", "b", "c") });
    expect(result.current.selectedRows.map(key)).toEqual(["c"]);
  });

  it("reports the header checkbox state", () => {
    const { result } = renderHook(() => useRowSelection(rows("a", "b"), key));
    expect(result.current.headerState).toBe(false);
    act(() => result.current.toggle("a"));
    expect(result.current.headerState).toBe("indeterminate");
    act(() => result.current.toggle("b"));
    expect(result.current.headerState).toBe(true);
  });

  it("is not selectable with no rows", () => {
    const { result } = renderHook(() => useRowSelection(null, key));
    expect(result.current.selectable).toBe(false);
    expect(result.current.headerState).toBe(false);
  });
});

describe("useColumnVisibility", () => {
  const COLUMNS: Column<Row>[] = [
    { key: "id", label: "Code" },
    { key: "name", label: "Name" },
    { key: "cls", label: "Class" },
    { key: "_a", label: "" },
  ];

  beforeEach(() => localStorage.clear());

  it("shows everything by default", () => {
    const { result } = renderHook(() => useColumnVisibility("t1", COLUMNS));
    expect(result.current.columns.map((c) => c.key)).toEqual(["id", "name", "cls", "_a"]);
    expect(result.current.hiddenCount).toBe(0);
  });

  it("locks column 0 and the unlabelled actions column out of the menu", () => {
    const { result } = renderHook(() => useColumnVisibility("t2", COLUMNS));
    expect(result.current.toggles.map((t) => t.key)).toEqual(["name", "cls"]);
  });

  it("hides a column and remembers it", () => {
    const { result, unmount } = renderHook(() => useColumnVisibility("t3", COLUMNS));
    act(() => result.current.setVisible("cls", false));
    expect(result.current.columns.map((c) => c.key)).toEqual(["id", "name", "_a"]);
    expect(result.current.hiddenCount).toBe(1);
    unmount();

    const again = renderHook(() => useColumnVisibility("t3", COLUMNS));
    expect(again.result.current.columns.map((c) => c.key)).toEqual(["id", "name", "_a"]);
  });

  it("PERSISTS THE HIDDEN SET, so a new column is visible to everyone", () => {
    // The reason this stores hidden rather than visible keys: a stored
    // allow-list would hide tomorrow's column from every user who ever opened
    // this menu, and nothing would look broken enough to report.
    const { result, unmount } = renderHook(() => useColumnVisibility("t4", COLUMNS));
    act(() => result.current.setVisible("name", false));
    unmount();

    const withNewColumn: Column<Row>[] = [...COLUMNS.slice(0, 3), { key: "vat", label: "VAT" }, COLUMNS[3]];
    const again = renderHook(() => useColumnVisibility("t4", withNewColumn));
    expect(again.result.current.columns.map((c) => c.key)).toEqual(["id", "cls", "vat", "_a"]);
  });

  it("resets", () => {
    const { result } = renderHook(() => useColumnVisibility("t5", COLUMNS));
    act(() => result.current.setVisible("name", false));
    act(() => result.current.setVisible("cls", false));
    act(() => result.current.reset());
    expect(result.current.hiddenCount).toBe(0);
  });

  it("degrades to showing everything on a corrupt preference", () => {
    localStorage.setItem("praxis.cols.t6", "{not json");
    const { result } = renderHook(() => useColumnVisibility("t6", COLUMNS));
    expect(result.current.columns).toHaveLength(4);
  });

  it("re-reads when the screen swaps its storage key", () => {
    const { result, rerender } = renderHook(({ k }) => useColumnVisibility(k, COLUMNS), {
      initialProps: { k: "tabA" },
    });
    act(() => result.current.setVisible("cls", false));
    rerender({ k: "tabB" });
    expect(result.current.hiddenCount).toBe(0);
    rerender({ k: "tabA" });
    expect(result.current.hiddenCount).toBe(1);
  });
});

describe("toCsv", () => {
  const cols = [
    { header: "Code", value: (r: Record<string, unknown>) => r.code },
    { header: "Label", value: (r: Record<string, unknown>) => r.label },
  ];

  it("writes a header row and CRLF line endings", () => {
    expect(toCsv(cols, [{ code: "706", label: "Ventes" }])).toBe("Code,Label\r\n706,Ventes");
  });

  it("NEUTRALISES A FORMULA, which is the whole reason this is shared code", () => {
    // A client name of `=HYPERLINK("http://evil","Invoice")` typed into a form
    // is live code in Excel the moment someone opens the export. The apostrophe
    // ends up inside the quotes, not outside them.
    const out = toCsv(cols, [{ code: "706", label: '=HYPERLINK("http://evil","x")' }]);
    expect(out).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(out).not.toMatch(/,=HYPERLINK/);
  });

  it("neutralises every formula lead character", () => {
    for (const lead of ["=", "+", "-", "@"]) {
      expect(toCsv(cols, [{ code: `${lead}1`, label: "x" }])).toContain(`'${lead}1`);
    }
  });

  it("quotes and doubles per RFC 4180, and leaves plain values unquoted", () => {
    const out = toCsv(cols, [{ code: "a,b", label: 'say "hi"' }]);
    expect(out).toBe('Code,Label\r\n"a,b","say ""hi"""');
    expect(toCsv(cols, [{ code: "706100", label: "Ventes" }])).toContain("706100,Ventes");
  });

  it("renders null and undefined as empty, not as the words", () => {
    expect(toCsv(cols, [{ code: null, label: undefined }])).toBe("Code,Label\r\n,");
  });
});
