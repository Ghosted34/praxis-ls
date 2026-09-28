/**
 * KPI drill-in modal — one tile, one browsable list of the rows behind it.
 *
 * Extracted from `party-360.tsx` unchanged when the corporate-entity dossier
 * grew the same drill-ins, and moved up from `features/masterdata` when record
 * screens outside master data (leads, treasury accounts, warehouse locations,
 * tax jurisdictions) grew them too — a feature importing another feature's
 * file for a shared dialog is how the chunk graph grows cycles. Every 360 now
 * opens one dialog, so a drill-in looks and behaves the same wherever it is
 * opened — including the keyboard path and the 20-row page size.
 *
 * ROWS ARE PROVIDED BY THE CALLER. The party dossier derives them from its 360
 * payload in the client; the entity drill fetches the entity's employees and
 * journal entries from their own modules. Both hand back `KpiDetailRow[]`, which
 * is why this component takes rows rather than a payload.
 *
 * A row MAY have no destination — a person on a cap table has no 360 of their
 * own, and inventing one would be a link to nowhere. `href` is therefore
 * optional, and a row without it renders its cells as plain text instead of a
 * button: the drill still answers "who are these rows", which is the question
 * the tile was asking.
 *
 * `loading` and `error` exist for the callers that FETCH their rows (the entity
 * dossier reads employees and journal entries from their own modules) — without
 * them a slow query would render as an empty list, which reads as "none exist"
 * rather than "not loaded yet".
 *
 * `paging` is for the callers whose rows are too many to hand over at once — the
 * financial dictionary's tiles count every costing line a charge has ever sat
 * on, which for a core charge is thousands. Then `rows` is ONE page, the server
 * owns the cursor, and "Showing 1–20 of 3,412" states the same total as the
 * tile that was clicked instead of the size of whatever prefix was fetched.
 *
 * `viewAll` is the way out to the module that owns the rows ("View more in
 * Costing"): the dialog answers "which ones", and the module is where you go to
 * sort, search and act on them.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { num } from "@/lib/format";
import { useIsCompact } from "@/lib/use-media-query";

/** Table chrome, local to this dialog so the extraction carries no dependency
 *  back into the party dossier. */
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>
);

/**
 * A KPI tile summarises rows that already ride on the 360 payload; the drill-in
 * turns each tile into a browsable list of those rows. The list is paginated at
 * 20 client-side — the underlying 360 collections are capped at 25 by the API,
 * so at most a second page appears; when the user needs the full list the
 * deep-link on any row jumps to that module's page.
 *
 * Each row is a plain button that navigates to the target module with a focus
 * hint (`?focus=<id>`, or for an operations file its own 360 route). The modal
 * closes on navigation so the user lands on the destination page rather than
 * the drill-in stacked over it.
 */
export type KpiDetailRow = {
  id: string;
  href?: string;
  cells: React.ReactNode[];
};
export type KpiDetailHeader = { label: string; right?: boolean };
export const KPI_PAGE_SIZE = 20;

/** Server-side paging: the caller fetches one page at a time and owns the
 *  cursor. See the file header. */
export type KpiDetailPaging = {
  page: number;
  pageSize: number;
  /** Every matching row, not this page's length. */
  total: number;
  onPageChange: (page: number) => void;
};

export function KpiDetailsModal({
  open,
  onClose,
  title,
  description,
  headers,
  rows,
  emptyLabel,
  moreHint,
  loading,
  error,
  paging,
  viewAll,
  size = "xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  headers: KpiDetailHeader[];
  rows: KpiDetailRow[];
  emptyLabel: string;
  /** Optional note under the header — used to say "showing most recent 25". */
  moreHint?: string;
  /** Rows are being fetched. Suppresses the empty state until the answer is in. */
  loading?: boolean;
  /** The fetch failed, as a ready-to-render message. */
  error?: string | null;
  /** `rows` is one server page — see `KpiDetailPaging`. Omit and `rows` is the
   *  whole list, paged here. */
  paging?: KpiDetailPaging;
  /** A footer link to the module that owns these rows. */
  viewAll?: { label: string; href: string };
  /** `wide` for a table of six or more columns — the dialog's own size for a
   *  body that is a wide table (see `dialog.tsx`). */
  size?: "xl" | "wide";
}) {
  const navigate = useNavigate();
  const [localPage, setLocalPage] = React.useState(0);
  // Reset the page cursor whenever the row set changes underneath — otherwise a
  // filter that shortens the list would leave the modal stranded on page 3.
  // (A server-paged caller owns its own cursor; this one is then unused.)
  React.useEffect(() => {
    setLocalPage(0);
  }, [rows.length, title]);

  const pageSize = paging ? paging.pageSize : KPI_PAGE_SIZE;
  // `max` with the page length: an endpoint that stopped sending its total must
  // still read as the rows on screen, never as "0 of 0" above twenty rows.
  const total = paging ? Math.max(paging.total, rows.length) : rows.length;
  const page = paging ? paging.page : localPage;
  const setPage = paging ? paging.onPageChange : setLocalPage;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = page * pageSize;
  const pageRows = paging ? rows : rows.slice(start, start + pageSize);

  function open_(href?: string) {
    if (!href) return;
    onClose();
    navigate(href);
  }

  // Below `md` a row is a CARD, not a table row. The table is five or six
  // columns of numbers — at 390px it either scrolls sideways past the one column
  // the reader wanted, or (what it did) squeezes every column until
  // "CST-2026-0199" breaks over three lines. A card gives the first cell the
  // whole width as its title and lists the rest as label · value pairs, which
  // is how a phone reads a record anyway.
  const compact = useIsCompact();

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={size}
      title={title}
      description={description}
    >
      {error ? (
        <ErrorState message={error} />
      ) : loading ? (
        <LoadingRow label="Loading…" />
      ) : (
        <>
          {moreHint && <p className="mb-2 micro">{moreHint}</p>}
          {total === 0 ? (
            <div className="rounded-lg border px-3 py-6 text-center micro">
              {emptyLabel}
            </div>
          ) : (
            <>
              {compact ? (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border">
                  {pageRows.map((r) => (
                    <li key={r.id}>
                      <KpiDetailCard row={r} headers={headers} onOpen={open_} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        {headers.map((h, i) => (
                          <Th key={i} r={h.right}>
                            {h.label}
                          </Th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pageRows.map((r) => (
                        // The row itself carries the pointer click (a `<tr onClick>`
                        // is fine — it isn't one of the static elements the a11y rule
                        // guards against). Keyboard reaches the row via the first
                        // cell's `<button>`, the same row-activator pattern
                        // data-list.tsx uses so a screen-reader user has one focus
                        // stop per row rather than one per cell.
                        <tr
                          key={r.id}
                          className={
                            r.href
                              ? "cursor-pointer transition-colors hover:bg-muted/60 focus-within:bg-muted/60"
                              : "transition-colors"
                          }
                          onClick={() => open_(r.href)}
                        >
                          {r.cells.map((c, i) => (
                            <Td key={i} r={headers[i]?.right}>
                              {i === 0 && r.href ? (
                                <button
                                  type="button"
                                  className="text-left text-primary-ink underline underline-offset-2 hover:opacity-80 focus-visible:outline-none"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    open_(r.href);
                                  }}
                                >
                                  {c}
                                </button>
                              ) : (
                                c
                              )}
                            </Td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {total > pageSize && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="micro">
                    Showing {start + 1}–{Math.min(start + pageSize, total)} of{" "}
                    {num(total)}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page === 0}
                      onClick={() => setPage(Math.max(0, page - 1))}
                    >
                      Previous
                    </Button>
                    <span className="micro">
                      Page {page + 1} / {totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
      {/* Not on an error: a refusal is usually a missing grant on that very
          module, and a link into it would only be refused again. */}
      {viewAll && !error && (
        <div className="mt-3 flex justify-end border-t pt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => open_(viewAll.href)}
          >
            {viewAll.label}
          </Button>
        </div>
      )}
    </Modal>
  );
}

/**
 * One row as a phone card: the first cell is the title, every other cell a
 * label · value pair under it. A row with a destination is ONE button — the
 * whole card is the tap target, as a 44px-tall row on a phone should be — and
 * everything inside it is a `<span>`, so the button holds phrasing content only.
 */
function KpiDetailCard({
  row,
  headers,
  onOpen,
}: {
  row: KpiDetailRow;
  headers: KpiDetailHeader[];
  onOpen: (href?: string) => void;
}) {
  const [first, ...cells] = row.cells;
  // Pairs with their header, then drop the empty ones: in a table a blank cell
  // holds its column, but in a card it is a label with nothing after it — a
  // ledger line's untouched Credit side read as "Credit" and then silence.
  const rest = cells
    .map((c, i) => ({ c, header: headers[i + 1] }))
    .filter(
      ({ c }) => c !== "" && c !== null && c !== undefined && c !== false,
    );
  const body = (
    <>
      <span
        className={
          row.href
            ? "block font-medium text-primary-ink"
            : "block font-medium text-foreground"
        }
      >
        {first}
      </span>
      {rest.length > 0 && (
        <span className="mt-1.5 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          {rest.map(({ c, header }, i) => (
            <React.Fragment key={i}>
              <span className="text-muted-foreground">{header?.label}</span>
              <span
                className={
                  header?.right
                    ? "num min-w-0 text-foreground"
                    : "min-w-0 text-foreground"
                }
              >
                {c}
              </span>
            </React.Fragment>
          ))}
        </span>
      )}
    </>
  );
  if (!row.href) return <div className="px-3 py-2.5">{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(row.href)}
      className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
    >
      {body}
    </button>
  );
}
