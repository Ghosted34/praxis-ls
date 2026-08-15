/**
 * Client-side CSV export for a table selection (Phase 5).
 *
 * WHY CLIENT-SIDE AT ALL. `lib/api-client.download()` already streams a server
 * export for the endpoints that have one, and that is the right tool when the
 * answer is "every invoice in the period". This is the other case: the operator
 * has already filtered, sorted and hand-picked eleven rows on screen, and what
 * they want is those eleven — a scope the server does not know and cannot be
 * told without inventing a query language for it.
 *
 * TWO THINGS THIS GETS RIGHT THAT A `rows.map(r => r.join(",")).join("\n")` DOES
 * NOT, and both have bitten real products:
 *
 * 1. **CSV INJECTION.** A cell whose text begins `=`, `+`, `-`, `@`, tab or CR
 *    is evaluated as a FORMULA by Excel, Sheets and LibreOffice on open. In an
 *    ERP the cell contents are user-supplied — a client name, a journal
 *    narrative, a dossier reference — so `=HYPERLINK("http://evil","Click")` or
 *    a `=cmd|…` DDE payload typed into a client's name field becomes live code
 *    on the machine of whoever opens the export. This is OWASP's "CSV
 *    Injection"/"Formula Injection", and the fix is one apostrophe: prefixing
 *    the value neutralises it while still displaying the original text. It is
 *    applied here rather than left to each caller precisely because it is the
 *    kind of thing every caller forgets.
 *
 * 2. **THE BOM.** Excel on Windows reads a CSV without a byte-order mark as the
 *    system's legacy code page, not UTF-8, so `Société Générale` opens as
 *    `SociÃ©tÃ© GÃ©nÃ©rale`. For a francophone product that is not an edge
 *    case, it is every other row. A leading U+FEFF fixes it, and nothing else
 *    does.
 *
 * @example
 * exportCsv({
 *   filename: "chart-of-accounts",
 *   columns: [
 *     { header: "Code", value: (a) => a.code },
 *     { header: "Label", value: (a) => a.label_fr },
 *   ],
 *   rows: selection.selectedRows,
 * });
 */
export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

/** Excel/Sheets/LibreOffice treat a value starting with any of these as a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function escapeCell(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  let s = String(raw);
  // Neutralise before quoting: the apostrophe must end up INSIDE the quoted
  // field, or the quoting would just move the leading `=` along by one.
  if (FORMULA_LEAD.test(s)) s = `'${s}`;
  // RFC 4180: double the quotes, wrap anything containing a delimiter, quote or
  // newline. Wrapping unconditionally would be simpler and would also make
  // every numeric column a text column in Excel.
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(",")];
  for (const r of rows)
    lines.push(columns.map((c) => escapeCell(c.value(r))).join(","));
  // CRLF is what RFC 4180 specifies and what Excel is least surprised by.
  return lines.join("\r\n");
}

export function exportCsv<T>({
  filename,
  columns,
  rows,
}: {
  /** Without the extension; a date stamp and `.csv` are appended. */
  filename: string;
  columns: CsvColumn<T>[];
  rows: T[];
}): void {
  const csv = toCsv(columns, rows);
  // U+FEFF, written as an escape: a literal BOM in source is invisible, and the
  // linter rejects it as irregular whitespace for exactly that reason.
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Not revoked synchronously: Safari has historically cancelled the download
  // when the object URL disappeared in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
