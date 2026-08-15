/**
 * DataList + PageHeader — the beautified list scaffold every wired screen composes.
 * The page owns data (via `useList`) and KPIs/forms; this renders the header, the
 * four states (skeleton / error / empty / table), and per-column custom cells
 * (status pills, money, row actions). Design-system only — no raw colour.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { cell } from "@/lib/format";
import { useRovingRows } from "@/lib/use-roving-rows";
import type { Density } from "@/lib/density";
import type { RowSelection } from "@/lib/use-row-selection";

export type Column<T> = {
  key: string;
  /**
   * Visible column heading. Pass `""` for a column that carries no heading —
   * conventionally the trailing row-actions cell (`key: "_a"`). An empty label
   * still gets an accessible name; see `headerLabel` below.
   */
  label: string;
  /**
   * Accessible name for a column whose `label` is intentionally blank.
   * Defaults to "Actions", which is what every such column in this app is.
   */
  srLabel?: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
};

/**
 * The heading a screen reader announces for a column.
 *
 * WHY THIS ISN'T JUST `c.label` (found by the Phase 4 axe gate, on its first
 * run). Every list screen in the app ends with `{ key: "_a", label: "" }` — the
 * row-actions cell — which rendered a literally empty `<th>`. axe calls that
 * `empty-table-header`, and the user-facing consequence is precise: navigating
 * that table by column, a screen reader announces the buttons in the last cell
 * with no idea what column they are in, because the header it would read is
 * blank. On a table where that column holds "Approve" and "Reject", that is not
 * cosmetic.
 *
 * The heading is visually hidden rather than shown: the column deliberately has
 * no visible title, and adding one would change every table's layout. `sr-only`
 * is the correct tool for exactly this — a name that must exist for AT and must
 * not exist on screen.
 */
function headerLabel<T>(c: Column<T>): React.ReactNode {
  if (c.label) return c.label;
  return <span className="sr-only">{c.srLabel ?? "Actions"}</span>;
}

// Canonical implementation lives in lib/format.ts (deduped at the 2026-07-18
// merge); re-exported here so existing `import { cell } from "@/components/data-list"`
// callers are unaffected.
export { cell };

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b pb-3">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="mt-1 h-7 w-1 shrink-0 rounded-full bg-primary"
        />
        <div className="min-w-0">
          {eyebrow && <div className="micro mb-1">{eyebrow}</div>}
          {/*
            The <h1> is now unconditional (audit F13). It used to render only
            when `description` was absent — and 116 of 117 call sites pass one,
            so in practice almost every screen in the app shipped with NO h1 at
            all and a flat document outline.

            The visual intent is preserved: inside a hub the tab bar already
            names the screen, so the title stays visually small (`micro`) and the
            description carries the visual weight. It is still a real h1 for
            assistive tech and document structure — `sr-only` is deliberately NOT
            used, because the title is genuinely useful context on screen too.
          */}
          {description ? (
            <>
              <h1 className="micro mb-1">{title}</h1>
              <p className="max-w-prose text-base font-medium leading-snug text-foreground">
                {description}
              </p>
            </>
          ) : (
            <h1 className="font-display text-h2 leading-tight">{title}</h1>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/**
 * The keyboard-reachable half of a click-anywhere row (audit F9, F13).
 *
 * THE DEFECT. `onRowClick` was attached to a `<tr>` and, on phones, to a plain
 * `<div>` — with no `role`, no `tabIndex` and no key handler. So the primary
 * navigation gesture on most list screens in the product existed for the mouse
 * only. F13 counted 23 of these across 16 files; this component is the one that
 * multiplied across every screen.
 *
 * WHY NOT `role="button"` ON THE ROW. It would work for the keyboard and destroy
 * the table: a `<tr role="button">` stops being a row, so a screen-reader user
 * loses row/column position, header association and "row 4 of 120" — a bad trade
 * on a 200-row shipment table, where the grid semantics ARE the usability.
 *
 * WHAT THIS DOES INSTEAD. The first column's content becomes a real `<button>`.
 * The row keeps `<tr>` semantics and its click-anywhere convenience; keyboard
 * and screen-reader users get an ordinary, labelled, focusable control in the
 * cell that already identifies the record ("SBX-OPS-2026-0142"). One activator
 * per row, in reading order, named by the thing it opens.
 *
 * This is why `onRowClick` rows must put something identifying in column 0 —
 * which every screen already does, because that is also what a human scans.
 */
function RowActivator({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // Stop the row's own handler from firing a second time on a mouse click.
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      // `align-middle` for the same reason `.status` carries it (index.css): a
      // <button> is an inline-block and aligns on the TEXT BASELINE, so its box
      // hangs below the baseline and the line box grows by however far the
      // current font's descender drops — making row height a function of the
      // typeface. The pill was the element actually pushing the 32px row to
      // 34.5px once --font-body was fixed to load Inter; this one's negative
      // margins were keeping it just inside the tolerance. Pinned anyway,
      // because with a fifteen-font picker "just inside" is a property of the
      // font that happens to be selected, not of the layout.
      className="-mx-1 -my-0.5 rounded px-1 py-0.5 text-left align-middle hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

export function DataList<T extends Record<string, unknown>>({
  columns,
  rows,
  error,
  loading,
  empty,
  rowKey,
  onRowClick,
  selection,
  selectionLabel,
  density,
  sticky,
  freezeFirstColumn,
  maxHeight,
  highlightRowKey,
}: {
  columns: Column<T>[];
  rows: T[] | null;
  error: string | null;
  loading: boolean;
  /** `action` is the F11 fix: no empty state in the app offered a primary
   *  control, which is what turns an empty table into an onboarding step. */
  empty?: { title: string; hint?: string; action?: React.ReactNode };
  rowKey: (row: T, i: number) => string;
  /**
   * Click-anywhere row navigation. The first column becomes a real button so
   * this is reachable without a mouse — see `RowActivator`. It also switches on
   * keyboard row navigation (`useRovingRows`), because it is the thing that
   * created the one-tab-stop-per-row problem that hook exists to undo.
   */
  onRowClick?: (row: T) => void;
  /** From `useRowSelection`. Prepends a checkbox column and a select-all header. */
  selection?: RowSelection<T>;
  /** How a row names itself in the checkbox's accessible name. Defaults to
   *  column 0's rendered text, which is the record's identity on every screen. */
  selectionLabel?: (row: T) => string;
  /** Pin a row density for this table, overriding the user's preference. */
  density?: Density;
  /** Keep the headings visible while the body scrolls. Bounds the height. */
  sticky?: boolean;
  /** Keep the record's identity visible while scrolling a wide table right. */
  freezeFirstColumn?: boolean;
  maxHeight?: string;
  /**
   * Draw a ring around the row whose `rowKey(...)` matches this string, and
   * mark it with `data-row-key` so the caller can scroll it into view. Used by
   * `?focus=<id>` deep-links from the party-360 KPI drill-in and elsewhere.
   * Undefined means no highlight.
   */
  highlightRowKey?: string | null;
}) {
  const shiftRef = React.useRef(false);
  const roving = useRovingRows(rows?.length ?? 0, !!onRowClick);

  if (error) return <ErrorState message={error} />;
  if (loading || rows === null) return <SkeletonTable cols={columns.length} />;
  if (rows.length === 0)
    return (
      <EmptyState
        title={empty?.title || "Nothing here yet"}
        // "No records returned." was the default — a developer's sentence that
        // tells an operator nothing (F11). Still a fallback, but every screen
        // should be passing real copy.
        hint={empty?.hint || "No records returned."}
        action={empty?.action}
      />
    );

  const rowName = (r: T, i: number) =>
    selectionLabel?.(r) ??
    String(columns[0] ? (r[columns[0].key] ?? rowKey(r, i)) : rowKey(r, i));

  return (
    <>
      {/* Table — sm and up. Below that it would overflow, so we swap to cards. */}
      <div className="hidden sm:block">
        <Table
          density={density}
          sticky={sticky}
          freezeFirstColumn={freezeFirstColumn}
          maxHeight={maxHeight}
        >
          <THead>
            <TR>
              {selection && (
                <TH className="w-10">
                  <Checkbox
                    // The primitive offsets its box by 2px to sit on a text
                    // label's baseline; in a cell there is no visible label to
                    // align to, so the offset is just a nudge off centre.
                    // `tap-24` is the WCAG 2.2 §2.5.8 minimum: a 16px box is a
                    // 16px target. 44 would overlap the neighbouring rows in a
                    // 28px compact row, so the table takes the normative floor
                    // and the card (a finger, and room) takes 44.
                    className="[&>button]:mt-0 [&>button]:tap-24"
                    checked={selection.headerState}
                    onCheckedChange={selection.toggleAll}
                    disabled={!selection.selectable}
                    // A visible "Select all" heading would take a column's worth
                    // of width to say what the control already says. sr-only is
                    // the same trade `headerLabel` makes for the actions column.
                    label={
                      <span className="sr-only">
                        Select all rows on this page
                      </span>
                    }
                  />
                </TH>
              )}
              {columns.map((c) => (
                <TH key={c.key}>{headerLabel(c)}</TH>
              ))}
            </TR>
          </THead>
          <TBody
            ref={roving.bodyRef}
            onKeyDown={roving.onKeyDown}
            onFocus={roving.onFocus}
          >
            {rows.map((r, i) => {
              const key = rowKey(r, i);
              const selected = selection?.isSelected(key) ?? false;
              const focused = highlightRowKey && key === highlightRowKey;
              return (
                <TR
                  key={key}
                  data-row-key={key}
                  className={cn(
                    onRowClick && "cursor-pointer",
                    // Selected rows need a persistent ground, not just a ticked
                    // box: on a scrolled table the checkbox column may be the
                    // part that is off screen.
                    selected &&
                      "bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]",
                    // A deep-link brought the user here to look at THIS row.
                    // The ring survives a re-render (unlike a transient scroll
                    // flash) so it still reads as "you're here" if the table
                    // repaints from a background refresh.
                    focused &&
                      "outline outline-2 outline-primary bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]",
                  )}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {selection && (
                    // Capture phase: React's bubble-phase onClick on this cell
                    // would run AFTER the checkbox's own handler, so the shift
                    // state would arrive one click late. Capture reads the
                    // modifier before the toggle needs it.
                    <TD
                      className="w-10"
                      onClickCapture={(e) => {
                        shiftRef.current = e.shiftKey;
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        className="[&>button]:mt-0 [&>button]:tap-24"
                        checked={selected}
                        onCheckedChange={() =>
                          selection.toggle(key, { shift: shiftRef.current })
                        }
                        label={
                          <span className="sr-only">
                            Select {rowName(r, i)}
                          </span>
                        }
                      />
                    </TD>
                  )}
                  {columns.map((c, ci) => {
                    const val = c.render ? c.render(r) : cell(r[c.key]);
                    return (
                      <TD key={c.key} className={c.className}>
                        {onRowClick && ci === 0 ? (
                          <RowActivator onClick={() => onRowClick(r)}>
                            {val}
                          </RowActivator>
                        ) : (
                          val
                        )}
                      </TD>
                    );
                  })}
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>

      {/* Card fallback — phones. Each row becomes a label/value card; unlabelled
          columns (e.g. row actions) render full-width at the foot of the card. */}
      <div className="animate-fade-up space-y-2 sm:hidden">
        {/*
          Select-all, for the card list.
          The table's lives in a <th>; a card list has no header row, so without
          this the only way to select forty records on a phone is forty taps.
          It is `sm:hidden` by virtue of its container, so the two never both
          render.
        */}
        {selection && (
          <div className="flex items-center justify-between rounded-[var(--radius)] border bg-card px-3 py-2">
            <Checkbox
              className="[&>button]:tap-44 [&>button]:mt-0"
              checked={selection.headerState}
              onCheckedChange={selection.toggleAll}
              disabled={!selection.selectable}
              label={<span className="text-sm">Select all</span>}
            />
            {selection.count > 0 && (
              <span className="micro">{selection.count} selected</span>
            )}
          </div>
        )}
        {rows.map((r, i) => {
          const key = rowKey(r, i);
          const selected = selection?.isSelected(key) ?? false;
          const focused = highlightRowKey && key === highlightRowKey;
          return (
            // Same reasoning as the table branch: the card keeps click-anywhere,
            // and column 0 carries the real control. The card itself cannot BE a
            // button — unlabelled columns render row actions inside it, and a
            // button containing buttons is invalid HTML that no AT handles well.
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
            <div
              key={key}
              data-row-key={key}
              className={cn(
                "lux-card p-3",
                onRowClick && "cursor-pointer",
                selected &&
                  "bg-[color-mix(in_srgb,var(--primary)_8%,var(--card))]",
                focused &&
                  "ring-2 ring-primary bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))]",
              )}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
            >
              <div className="flex items-start gap-3">
                {selection && (
                  // The checkbox sits OUTSIDE the column loop rather than as a
                  // pseudo-column: a card is not a row, and threading it through
                  // the label/value pairs would have given it a "" label cell.
                  <span
                    role="presentation"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      className="[&>button]:tap-44"
                      checked={selected}
                      // No shift-range on touch: there is no shift key, and a
                      // long-press range is an idiom this app does not use
                      // anywhere else. Tap-to-toggle plus Select all covers it.
                      onCheckedChange={() => selection.toggle(key)}
                      label={
                        <span className="sr-only">Select {rowName(r, i)}</span>
                      }
                    />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {columns.map((c, ci) => {
                    const raw = c.render ? c.render(r) : cell(r[c.key]);
                    const val =
                      onRowClick && ci === 0 ? (
                        <RowActivator onClick={() => onRowClick(r)}>
                          {raw}
                        </RowActivator>
                      ) : (
                        raw
                      );
                    return c.label ? (
                      <div
                        key={c.key}
                        className="flex items-baseline justify-between gap-3 py-0.5"
                      >
                        <span className="micro shrink-0">{c.label}</span>
                        <span className="min-w-0 text-right text-sm">
                          {val}
                        </span>
                      </div>
                    ) : (
                      <div
                        key={c.key}
                        className="mt-2 flex flex-wrap justify-end gap-2"
                      >
                        {val}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
