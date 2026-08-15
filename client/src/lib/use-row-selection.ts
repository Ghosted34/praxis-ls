/**
 * Multi-row selection with shift-click ranges (Phase 5, audit F9).
 *
 * WHAT WAS MISSING. Every list screen in this app is one row, one action. An
 * operator approving forty timesheets, posting twelve journals or reassigning a
 * page of dossiers does it forty, twelve or twenty times, one modal at a time.
 * Multi-select and a bulk action are the difference between that and one
 * confirmation — and they are the single most conspicuously absent desktop
 * idiom in the product.
 *
 * TWO PROPERTIES THAT ARE NOT OBVIOUS, and are the reason this is a hook rather
 * than a `useState<Set>` in each screen:
 *
 * 1. **Selection is pruned to what is on screen.** The Set holds keys, but
 *    everything derived from it — `count`, `selectedRows`, the header state —
 *    intersects with the CURRENT rows. So if you tick eight invoices, then type
 *    in the search box until only three of them match, "Approve selected" acts
 *    on three, not eight. The alternative silently applies a bulk write to
 *    records the user cannot see, which in a finance product is not a UX
 *    wrinkle. Keys are retained rather than deleted, so clearing the filter
 *    brings the rest of the selection back — the user's intent is preserved,
 *    the action's scope is not widened.
 *
 * 2. **A range is anchored, not accumulated.** Shift-click selects from the
 *    last plainly-clicked row to this one, in the CURRENT visual order, which
 *    is what every table in every OS does. Re-sorting between two clicks
 *    therefore changes what a range means — correctly, because the user is
 *    pointing at rows on a screen, not at an abstract set.
 *
 * @example
 * const rows = shown;                       // whatever the screen renders
 * const sel = useRowSelection(rows, (r) => r.invoice_id);
 *
 * <ListPage rows={rows} selection={sel} … />
 * <BulkBar
 *   count={sel.count}
 *   onClear={sel.clear}
 *   actions={<Button onClick={() => approve(sel.selectedRows)}>Approve</Button>}
 * />
 *
 * BEST PRACTICE. Read `selectedRows`, never the raw `keys` — that is what makes
 * property 1 hold. Put the destructive bulk action last and confirm it: a bulk
 * delete is the one place in this app where a mis-click is unrecoverable at
 * forty times the usual scale.
 */
import * as React from "react";

export type RowSelection<T> = {
  /** Rows currently selected AND currently present. This is the action's scope. */
  selectedRows: T[];
  /** `selectedRows.length`. */
  count: number;
  isSelected: (key: string) => boolean;
  /** Toggle one row. `shift` extends from the last plain click. */
  toggle: (key: string, opts?: { shift?: boolean }) => void;
  /** Select or clear every row currently on screen. */
  toggleAll: () => void;
  clear: () => void;
  /** What the header checkbox should show. */
  headerState: boolean | "indeterminate";
  /** True when the screen has any rows to select — the header checkbox's enable. */
  selectable: boolean;
};

export function useRowSelection<T>(
  rows: T[] | null,
  rowKey: (row: T, i: number) => string,
): RowSelection<T> {
  const [keys, setKeys] = React.useState<ReadonlySet<string>>(() => new Set());
  const anchor = React.useRef<string | null>(null);

  // The visible order, recomputed whenever the screen's rows change. Ranges and
  // "select all" both resolve against this and nothing else.
  const present = React.useMemo(
    () => (rows ?? []).map((r, i) => rowKey(r, i)),
    [rows, rowKey],
  );

  const selectedRows = React.useMemo(
    () => (rows ?? []).filter((r, i) => keys.has(rowKey(r, i))),
    [rows, rowKey, keys],
  );

  const toggle = React.useCallback(
    (key: string, opts?: { shift?: boolean }) => {
      setKeys((prev) => {
        const next = new Set(prev);
        const from = anchor.current;

        if (opts?.shift && from && from !== key) {
          const a = present.indexOf(from);
          const b = present.indexOf(key);
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            // A range always SELECTS. Shift-clicking to unselect a span is a
            // pattern almost nothing implements and users do not expect; the
            // anchor's own state would also have to decide the range's
            // direction, which is where that idiom becomes unpredictable.
            for (let i = lo; i <= hi; i++) next.add(present[i]);
            return next;
          }
        }

        if (next.has(key)) next.delete(key);
        else next.add(key);
        anchor.current = key;
        return next;
      });
    },
    [present],
  );

  const allOnScreen = present.length > 0 && present.every((k) => keys.has(k));

  const toggleAll = React.useCallback(() => {
    setKeys((prev) => {
      const next = new Set(prev);
      const all = present.length > 0 && present.every((k) => next.has(k));
      // Deliberately scoped to the screen: "select all" over a filtered list
      // means these, and clearing it must not also drop a selection the user
      // made under a different filter.
      if (all) present.forEach((k) => next.delete(k));
      else present.forEach((k) => next.add(k));
      return next;
    });
    anchor.current = null;
  }, [present]);

  const clear = React.useCallback(() => {
    setKeys(new Set());
    anchor.current = null;
  }, []);

  const isSelected = React.useCallback((key: string) => keys.has(key), [keys]);

  return {
    selectedRows,
    count: selectedRows.length,
    isSelected,
    toggle,
    toggleAll,
    clear,
    headerState: allOnScreen
      ? true
      : selectedRows.length > 0
        ? "indeterminate"
        : false,
    selectable: present.length > 0,
  };
}
