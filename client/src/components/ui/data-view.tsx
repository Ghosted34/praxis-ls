/**
 * DataView — renders an arbitrary API payload as something a person can read.
 *
 * WHY THIS EXISTS (audit A4). Three screens dumped unformatted JSON into the UI
 * whenever a payload did not match an expected shape:
 *
 *   - `features/vault/pages.tsx:61`  — the fallback renderer for EVERY catalogue
 *     report, so any report returning a non-array shape showed raw JSON.
 *   - `features/portal/pages.tsx:200` — the same, on the EXTERNAL CLIENT PORTAL.
 *     That is the surface a tenant's own customers see.
 *   - `features/governance/pages.tsx:118` — audit-ledger values.
 *
 * `<pre>{JSON.stringify(data, null, 2)}</pre>` is a debugging tool. Shipping it
 * as a customer-facing fallback tells the reader the software does not know what
 * it is showing them — and on the portal it leaks internal field names to people
 * outside the tenant.
 *
 * The same finding notes that even the WORKING path was rough: report columns
 * were inferred with `Object.keys()` and printed raw, so headers read
 * `total_ttc` and `client_id`. Headers go through `fieldLabel` here.
 *
 * WHAT IT RENDERS
 *   array of objects  → a table, columns unioned across rows, headers humanised
 *   array of scalars  → a comma list
 *   object            → a two-column definition list
 *   scalar            → the value, formatted by `smartCell`
 *   null / undefined  → an empty state, not "null"
 *
 * Values go through `smartCell`, so ISO timestamps become readable dates, UUIDs
 * shorten to 8 characters, and nested objects become "k: v" pairs rather than
 * more JSON.
 *
 * @example
 * <DataView data={report.data} emptyTitle="This report returned no rows" />
 *
 * BEST PRACTICE. Reach for this only where the shape is genuinely unknown at
 * build time — report viewers, audit values, portal previews. Anywhere you know
 * the columns, write them out with `<DataList>`: a hand-written header and an
 * explicit `money()` or `dateFmt()` will always beat inference.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { fieldLabel, smartCell } from "@/lib/format";
import { EmptyState } from "@/components/ui/states";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function DataView({
  data,
  emptyTitle = "No data",
  emptyHint,
  className,
}: {
  data: unknown;
  emptyTitle?: string;
  emptyHint?: string;
  className?: string;
}) {
  const body = React.useMemo(() => {
    if (data === null || data === undefined || data === "") return null;

    if (Array.isArray(data)) {
      if (data.length === 0) return null;

      if (data.every(isRecord)) {
        const rows = data as Record<string, unknown>[];
        // Union of keys, not just the first row's: reports frequently omit null
        // columns per row, and keying off row 0 silently drops them.
        const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
        return (
          <div className="max-h-96 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60">
                <tr>
                  {cols.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="px-3 py-2 text-left text-label font-medium text-muted-foreground"
                    >
                      {fieldLabel(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    {cols.map((c) => (
                      <td key={c} className="px-3 py-row">
                        {smartCell(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      return (
        <p className="text-sm">{data.map((v) => smartCell(v)).join(", ")}</p>
      );
    }

    if (isRecord(data)) {
      const pairs = Object.entries(data);
      if (!pairs.length) return null;
      return (
        <dl className="divide-y rounded-lg border">
          {pairs.map(([k, v]) => (
            <div
              key={k}
              className="flex items-baseline justify-between gap-4 px-3 py-2"
            >
              <dt className="shrink-0 text-label text-muted-foreground">
                {fieldLabel(k)}
              </dt>
              <dd className="min-w-0 break-words text-right text-sm">
                {Array.isArray(v) && v.every(isRecord) && v.length ? (
                  <DataView data={v} />
                ) : (
                  smartCell(v)
                )}
              </dd>
            </div>
          ))}
        </dl>
      );
    }

    return <p className="text-sm">{smartCell(data)}</p>;
  }, [data]);

  if (body === null) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return <div className={cn(className)}>{body}</div>;
}
