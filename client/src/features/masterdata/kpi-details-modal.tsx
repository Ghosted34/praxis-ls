/**
 * KPI drill-in modal — one tile, one browsable list of the rows behind it.
 *
 * Extracted from `party-360.tsx` unchanged when the corporate-entity dossier
 * grew the same drill-ins (the tiles and the party masters are the two places a
 * number on screen is the entry point to a list rather than a fact). The party
 * dossier and the entity dossier now share one dialog, so a drill-in looks and
 * behaves the same wherever it is opened — including the keyboard path and the
 * 20-row page size.
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
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingRow } from "@/components/ui/states";

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
}) {
  const navigate = useNavigate();
  const [page, setPage] = React.useState(0);
  // Reset the page cursor whenever the row set changes underneath — otherwise a
  // filter that shortens the list would leave the modal stranded on page 3.
  React.useEffect(() => {
    setPage(0);
  }, [rows.length, title]);

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / KPI_PAGE_SIZE));
  const start = page * KPI_PAGE_SIZE;
  const pageRows = rows.slice(start, start + KPI_PAGE_SIZE);

  function open_(href?: string) {
    if (!href) return;
    onClose();
    navigate(href);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
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
              {total > KPI_PAGE_SIZE && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="micro">
                    Showing {start + 1}–
                    {Math.min(start + KPI_PAGE_SIZE, total)} of {total}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
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
                      onClick={() => setPage((p) => p + 1)}
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
    </Modal>
  );
}
