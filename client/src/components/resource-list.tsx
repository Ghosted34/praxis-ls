/**
 * Generic read-only resource list — the skeleton every admin screen starts from.
 * Fetches a tenant endpoint, renders a table with real loading/empty/error
 * states. Columns are inferred from the first row when not given. Build richer
 * create/edit UIs on top per screen as they're prioritised.
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { ApiError } from "@/lib/api-client";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";

export type Column = { key: string; label: string };

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ResourceList({
  title,
  description,
  endpoint,
  columns,
}: {
  title: string;
  description?: string;
  endpoint: string;
  columns?: Column[];
}) {
  const [rows, setRows] = React.useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    tenant<Record<string, unknown>[]>(endpoint)
      .then((data) => {
        if (!live) return;
        setRows(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 403) setError("You don't have permission to view this.");
        else setError(err instanceof ApiError ? err.message : "Failed to load.");
      });
    return () => {
      live = false;
    };
  }, [endpoint]);

  const cols: Column[] =
    columns || (rows && rows[0] ? Object.keys(rows[0]).slice(0, 6).map((k) => ({ key: k, label: k })) : []);

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <LoadingRow />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here yet" hint="No records returned for this endpoint." />
      ) : (
        <Table>
          <THead>
            <TR>
              {cols.map((c) => (
                <TH key={c.key}>{c.label}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={i}>
                {cols.map((c) => (
                  <TD key={c.key} className="text-sm">
                    {fmt(r[c.key])}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </section>
  );
}
