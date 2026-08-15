/**
 * Column visibility, persisted per screen (Phase 5, audit F9).
 *
 * WHY. A costing sheet or a trial balance carries fifteen columns because
 * somebody, somewhere, needs all fifteen. Nobody needs all fifteen at once. The
 * alternative to letting the operator hide the ones they are not using is the
 * one this app currently ships: scroll sideways, or design the table for the
 * union of every reader and serve none of them well.
 *
 * WHAT IT PERSISTS, and why only that. localStorage holds the HIDDEN keys, not
 * the visible ones. That is the difference between a preference that survives a
 * new column being added to the screen and one that silently hides it: a stored
 * allow-list would mean tomorrow's "VAT" column is invisible to everyone who
 * ever touched this menu, and nobody would report it as a bug because nothing
 * looks broken. New columns appear; hidden ones stay hidden.
 *
 * Keys that no longer exist in the spec are ignored rather than pruned, so
 * renaming a column back does not surprise the user with a hidden one.
 *
 * WHAT CANNOT BE HIDDEN. Column 0 and the row-actions column. Column 0 is the
 * record's identity — it is what `RowActivator` turns into the row's keyboard
 * control and what a frozen column pins — so hiding it produces a table of
 * numbers belonging to nothing. The actions column is not data.
 *
 * @example
 * const cols = useColumnVisibility("finance.invoices", COLUMNS);
 * <ListPage columns={cols.columns} toolbar={<ColumnsMenu state={cols} />} … />
 */
import * as React from "react";
import type { Column } from "@/components/data-list";

const PREFIX = "praxis.cols.";

export type ColumnVisibility<T> = {
  /** The spec, filtered. Pass this to `DataList` / `ListPage`. */
  columns: Column<T>[];
  /** Every column that may be toggled, with its current state. */
  toggles: { key: string; label: string; visible: boolean }[];
  setVisible: (key: string, visible: boolean) => void;
  /** Show everything again. */
  reset: () => void;
  /** How many are hidden — the badge on the menu trigger. */
  hiddenCount: number;
};

function read(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : [],
    );
  } catch {
    // A corrupt or unreadable preference must degrade to "show everything",
    // never to a blank table.
    return new Set();
  }
}

function write(key: string, hidden: ReadonlySet<string>) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify([...hidden]));
  } catch {
    /* preference is still applied for this session */
  }
}

export function useColumnVisibility<T>(
  /** Stable per screen, e.g. "finance.invoices". Changing it resets everyone. */
  storageKey: string,
  columns: Column<T>[],
): ColumnVisibility<T> {
  const [hidden, setHidden] = React.useState<ReadonlySet<string>>(() =>
    read(storageKey),
  );

  // A screen that swaps its column spec (a hub whose tab changes the table)
  // must re-read under the new key rather than carry the old one's hidden set.
  React.useEffect(() => {
    setHidden(read(storageKey));
  }, [storageKey]);

  const setVisible = React.useCallback(
    (key: string, visible: boolean) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (visible) next.delete(key);
        else next.add(key);
        write(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const reset = React.useCallback(() => {
    setHidden(() => {
      const next = new Set<string>();
      write(storageKey, next);
      return next;
    });
  }, [storageKey]);

  // Locked: column 0 (the record's identity) and any column with no heading,
  // which by this app's convention is the row-actions cell.
  const lockable = React.useCallback(
    (c: Column<T>, i: number) => i === 0 || !c.label,
    [],
  );

  const shown = React.useMemo(
    () => columns.filter((c, i) => lockable(c, i) || !hidden.has(c.key)),
    [columns, hidden, lockable],
  );

  const toggles = React.useMemo(
    () =>
      columns
        .filter((c, i) => !lockable(c, i))
        .map((c) => ({
          key: c.key,
          label: c.label,
          visible: !hidden.has(c.key),
        })),
    [columns, hidden, lockable],
  );

  return {
    columns: shown,
    toggles,
    setVisible,
    reset,
    hiddenCount: toggles.filter((t) => !t.visible).length,
  };
}
