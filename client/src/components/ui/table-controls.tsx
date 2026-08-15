/**
 * ColumnsMenu and BulkBar — the two controls that turn a list into a desktop
 * table (Phase 5, audit F9).
 *
 * They live together because they are the same story from two sides: one
 * decides what a wide table SHOWS, the other decides what a multi-row selection
 * DOES. Both are opt-in per screen, and neither changes a screen that has not
 * asked for it.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownCheckboxItem,
  DropdownLabel,
  DropdownItem,
  DropdownSeparator,
} from "@/components/ui/dropdown-menu";
import type { ColumnVisibility } from "@/lib/use-column-visibility";

/**
 * The column-visibility menu. Put it in a `ListPage`'s `toolbar`, next to the
 * filters — hiding a column is a filter on the other axis, and it belongs where
 * the user is already narrowing what they are looking at.
 *
 * @example
 * const cols = useColumnVisibility("finance.invoices", COLUMNS);
 * <ListPage columns={cols.columns} toolbar={<><Search…/><ColumnsMenu state={cols} /></>} … />
 */
export function ColumnsMenu<T>({
  state,
  className,
}: {
  state: ColumnVisibility<T>;
  className?: string;
}) {
  const { toggles, setVisible, reset, hiddenCount } = state;
  if (toggles.length === 0) return null;

  return (
    <DropdownMenu
      trigger={
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5", className)}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            aria-hidden
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16M15 4v16" />
          </svg>
          Columns
          {/* The count is the whole point of the affordance: a table missing
              four columns must say so, or the next person to use this browser
              profile reports the data as missing. */}
          {hiddenCount > 0 && (
            <span className="rounded-full bg-secondary px-1.5 text-micro font-semibold text-muted-foreground">
              {toggles.length - hiddenCount}/{toggles.length}
            </span>
          )}
        </Button>
      }
    >
      <DropdownLabel>
        <span className="micro">Columns shown</span>
      </DropdownLabel>
      {toggles.map((t) => (
        <DropdownCheckboxItem
          key={t.key}
          checked={t.visible}
          onCheckedChange={(v) => setVisible(t.key, v)}
        >
          {t.label}
        </DropdownCheckboxItem>
      ))}
      {hiddenCount > 0 && (
        <>
          <DropdownSeparator />
          <DropdownItem onSelect={reset}>Show all columns</DropdownItem>
        </>
      )}
    </DropdownMenu>
  );
}

/**
 * The bulk action bar — what a multi-row selection is FOR.
 *
 * IT ANNOUNCES ITSELF. `role="status"` with `aria-live="polite"`: a bar that
 * appears silently at the foot of the viewport is invisible to a screen-reader
 * user, who would tick four rows and have no indication that anything can now
 * be done with them. The count is the message ("4 rows selected"), so it
 * re-announces as the selection changes — politely, so it queues behind
 * whatever the user is reading rather than interrupting a row label mid-word.
 *
 * IT IS STICKY, NOT FIXED. `sticky bottom-4` keeps it inside the page's own
 * scroll container and inside the content column, so it cannot cover the last
 * table row the way the draggable FAB covered the bottom-right of every screen
 * (F9, and the reason that FAB is gone from desktop this phase).
 *
 * @example
 * <BulkBar
 *   count={sel.count}
 *   onClear={sel.clear}
 *   actions={<>
 *     <Button size="sm" variant="outline" onClick={() => exportRows(sel.selectedRows)}>Export</Button>
 *     <Button size="sm" onClick={() => approve(sel.selectedRows)}>Approve</Button>
 *   </>}
 * />
 *
 * BEST PRACTICE. Name the noun, not the row count alone — "4 invoices" beats
 * "4 selected" when three tables are open in a hub. Confirm anything
 * destructive: a bulk mistake is the usual one multiplied by the selection.
 */
export function BulkBar({
  count,
  noun = "row",
  nounPlural,
  onClear,
  actions,
  className,
}: {
  count: number;
  /** Singular form, e.g. "invoice". */
  noun?: string;
  /** Plural, when a trailing "s" is wrong — "entry" → "entries". */
  nounPlural?: string;
  onClear: () => void;
  actions: React.ReactNode;
  className?: string;
}) {
  // Rendering nothing at zero rather than hiding with CSS: an empty live region
  // that stays mounted announces its own emptiness on every selection change.
  if (count === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "animate-fade-in sticky bottom-4 z-20 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border bg-popover px-4 py-2.5 shadow-[var(--shadow-l)]",
        className,
      )}
    >
      <span className="text-sm font-semibold text-foreground">
        {count} {count === 1 ? noun : (nounPlural ?? `${noun}s`)} selected
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
    </div>
  );
}
