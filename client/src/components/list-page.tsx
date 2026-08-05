/**
 * ListPage — container + header + toolbar + DataList + states, composed once.
 *
 * WHY (audit F5, the root-cause finding). `doc/FE_DESIGN_RULES.md` told every
 * new engineer that "the default list screen is `<ResourceList>`" and that
 * "write-capable lists use `<CrudResource>`". `crud-resource.tsx` never
 * existed; `resource-list.tsx` existed with ZERO call sites (deleted in PR1).
 * So the documented on-ramp pointed at a deleted component and a dead one, and
 * every screen hand-rolled `useList` + `DataList` + a bespoke Modal form
 * instead. Twenty-four feature areas each paved their own road. That is the
 * cause of most other findings in the audit, and this is the road.
 *
 * WHAT IT OWNS, so a screen stops re-deciding it:
 *   - the page container and its width (F3)
 *   - the header, its `<h1>` and its primary action (F13)
 *   - the four states — loading / error / empty / populated — routed to the
 *     right primitive every time (F10: five loading idioms, 28 ad-hoc
 *     "Loading…" strings; F11: 11 screens with no empty state)
 *   - the toolbar slot, so filters sit in the same place on every screen
 *   - pagination, when the endpoint pages (F8)
 *
 * WHAT IT DELIBERATELY DOES NOT OWN: data fetching and forms. It takes a
 * `useList` result rather than a path, because half the list screens in this
 * app derive their rows (filtering, joining an id→name map, merging two
 * endpoints) and a component that fetched for them would be immediately
 * escaped. `<CrudResource>`'s promise of a declarative `fields` spec is exactly
 * the abstraction that was documented, never built, and would not have fitted
 * these screens.
 *
 * @example  // the whole screen
 * export function ClientsPage() {
 *   const { rows, error, loading, reload } = useList<Client>("/clients");
 *   const [q, setQ] = React.useState("");
 *   const [open, setOpen] = React.useState(false);
 *   const shown = React.useMemo(
 *     () => (rows ?? []).filter((r) => r.name.toLowerCase().includes(q.toLowerCase())),
 *     [rows, q],
 *   );
 *
 *   return (
 *     <ListPage
 *       title="Clients"
 *       description="Every party you invoice. Credit limits come from the master record."
 *       action={<Button onClick={() => setOpen(true)}>New client</Button>}
 *       toolbar={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" className="max-w-xs" />}
 *       columns={columns}
 *       rows={shown}
 *       error={error}
 *       loading={loading}
 *       rowKey={(r) => r.client_id}
 *       empty={{ title: "No clients yet", hint: "Add the first one to start quoting.",
 *                action: <Button onClick={() => setOpen(true)}>New client</Button> }}
 *       filtered={!!q}
 *       emptyFiltered={{ title: "No clients match", hint: "Try a different search.",
 *                        action: <Button variant="outline" onClick={() => setQ("")}>Clear search</Button> }}
 *     >
 *       <ClientForm open={open} onClose={() => setOpen(false)} onSaved={reload} />
 *     </ListPage>
 *   );
 * }
 *
 * BEST PRACTICE. Pass BOTH empties. A brand-new list and a filtered-to-nothing
 * list are different situations and want different actions — offering "New
 * client" to someone who just mistyped a search is unhelpful, and it is the
 * single most common thing screens get wrong here. Write `description` as what
 * the screen is FOR, not what it contains ("Every party you invoice" beats
 * "List of clients"). Keep `action` to one primary control; put the rest in a
 * `DropdownMenu`.
 */
import * as React from "react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader, DataList, type Column } from "@/components/data-list";
import { EmptyState } from "@/components/ui/states";
import { Pagination } from "@/components/ui/pagination";
import { BulkBar } from "@/components/ui/table-controls";
import type { PageWidth } from "@/lib/layout";
import type { Density } from "@/lib/density";
import type { RowSelection } from "@/lib/use-row-selection";

export type ListPageEmpty = {
  title: string;
  hint?: string;
  /** A primary control. No empty state in the app offered one before (F11). */
  action?: React.ReactNode;
};

export function ListPage<T extends Record<string, unknown>>({
  title,
  description,
  eyebrow,
  action,
  tabs,
  toolbar,
  kpis,
  columns,
  rows,
  error,
  loading,
  rowKey,
  onRowClick,
  empty,
  emptyFiltered,
  filtered,
  pagination,
  width = "wide",
  selection,
  bulkActions,
  bulkNoun,
  bulkNounPlural,
  density,
  sticky,
  freezeFirstColumn,
  maxHeight,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  /** Breadcrumb or hub crumb above the title. */
  eyebrow?: React.ReactNode;
  /** One primary control, right of the header. */
  action?: React.ReactNode;
  /**
   * A hub's tab bar — `<HubTabs/>` — which must sit DIRECTLY under the header.
   *
   * `TabbedHub` publishes its strip on context and relies on each page to draw
   * it in the right place, with an `inlineTabs` escape hatch for hubs whose
   * pages forgot (audit F7 calls this the one genuine anti-pattern in the
   * component architecture: whether a hub's tabs appear depends on a convention
   * no type signature enforces). A named slot at least makes the position part
   * of the scaffold rather than of each screen's layout.
   */
  tabs?: React.ReactNode;
  /** Filters and search. Sits between the KPIs and the table. */
  toolbar?: React.ReactNode;
  /** A `<KpiRow>`, above the toolbar. */
  kpis?: React.ReactNode;
  columns: Column<T>[];
  rows: T[] | null;
  error: string | null;
  loading: boolean;
  rowKey: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
  /** Shown when the list is genuinely empty. Give this a CREATE action. */
  empty: ListPageEmpty;
  /** Shown when filters hid everything. Give this a CLEAR action. */
  emptyFiltered?: ListPageEmpty;
  /** True when a filter or search term is active. */
  filtered?: boolean;
  pagination?: React.ComponentProps<typeof Pagination>;
  width?: PageWidth;
  /**
   * Multi-row selection, from `useRowSelection` (Phase 5). Adds the checkbox
   * column and, with `bulkActions`, the bar that gives the selection a purpose.
   * A selection with nothing to do with it is a checkbox column that wastes
   * 40px on every screen — so pass both or neither.
   */
  selection?: RowSelection<T>;
  /** Controls for the selected rows. Rendered in a `BulkBar` under the table. */
  bulkActions?: React.ReactNode;
  /** What the selected rows ARE — "invoice", not "row". */
  bulkNoun?: string;
  bulkNounPlural?: string;
  /** Pin a row density, overriding the user's preference. Rarely correct. */
  density?: Density;
  /** Keep column headings visible while the body scrolls. Bounds table height. */
  sticky?: boolean;
  /** Keep the record's identity visible while scrolling a wide table right. */
  freezeFirstColumn?: boolean;
  /** Only meaningful with `sticky`. Defaults to 70vh. */
  maxHeight?: string;
  /** Modals, drawers and anything else the screen owns. */
  children?: React.ReactNode;
}) {
  // The distinction the audit says every screen misses: nothing here yet vs
  // nothing matches. Falls back to `empty` when a screen has no filters.
  const showFilteredEmpty = filtered && rows !== null && rows.length === 0 && !!emptyFiltered;

  return (
    <PageContainer width={width}>
      <PageHeader title={title} description={description} eyebrow={eyebrow} action={action} />

      {tabs}
      {kpis}
      {toolbar && <div className="mb-4 flex flex-wrap items-center justify-between gap-3">{toolbar}</div>}

      {showFilteredEmpty ? (
        <EmptyState title={emptyFiltered.title} hint={emptyFiltered.hint} action={emptyFiltered.action} />
      ) : (
        <DataList<T>
          columns={columns}
          rows={rows}
          error={error}
          loading={loading}
          rowKey={rowKey}
          onRowClick={onRowClick}
          empty={empty}
          selection={selection}
          density={density}
          sticky={sticky}
          freezeFirstColumn={freezeFirstColumn}
          maxHeight={maxHeight}
        />
      )}

      {/* Sits between the table and the pager, inside the content column, so it
          can never cover the last row — the failure mode of the fixed overlay
          this app used to reach for (F9). */}
      {selection && bulkActions && (
        <BulkBar
          count={selection.count}
          noun={bulkNoun}
          nounPlural={bulkNounPlural}
          onClear={selection.clear}
          actions={bulkActions}
        />
      )}

      {/* Hidden while loading or errored: a pager under a skeleton is noise, and
          under an error message it implies there is a page 2 to reach. */}
      {pagination && !loading && !error && rows !== null && rows.length > 0 && <Pagination {...pagination} />}

      {children}
    </PageContainer>
  );
}
