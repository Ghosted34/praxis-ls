/**
 * Financial dictionary — the bulk Excel import modal.
 *
 * Three steps, and they are separate on purpose:
 *
 *   1. DOWNLOAD a template built from THIS tenant's accounts, tax codes and
 *      service keys, with enum dropdowns. Most of what a naive importer rejects
 *      is a mistyped enum or a guessed account code; a template moves that whole
 *      class of error to the moment of typing.
 *   2. UPLOAD it and see the staging table — exactly what will be created, and
 *      what will not with the reason per row. Nothing is written yet.
 *   3. COMMIT the valid rows. PARTIALLY: 400 good rows are never lost to one
 *      typo, and the rejected rows come back as an .xlsx the user fixes and
 *      re-uploads.
 *
 * WHY STAGING IS ITS OWN STEP. An importer that validates and commits in one
 * call has to pick between all-or-nothing (one bad row destroys the batch) and
 * silent partial success (rows appear that nobody reviewed). Showing the table
 * first makes that the user's decision instead of the implementation's.
 *
 * The table pages at 50 — the same ceiling the server's `page()` helper uses —
 * because a 400-row upload rendered in one DOM tree is the "unpaginated
 * fetch-everything" pattern the audit's F8 is about, just moved client-side.
 */
import * as React from "react";
import { tr } from "@/lib/i18n";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Callout } from "@/components/ui/callout";
import { Pagination } from "@/components/ui/pagination";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import { num } from "@/lib/format";
import * as api from "@/lib/masterdata-api";

const PAGE_SIZE = 50;
type Filter = "all" | "valid" | "rejected";

type StagedRow = {
  row?: number;
  raw: Record<string, unknown>;
  reasons: string[];
  ok: boolean;
};

const cell = (v: unknown) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

/** Read a File as the base64 data URL the upload endpoint expects (same shape
 *  the document vault uses, so there is one upload convention in the product). */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Could not read that file"));
    fr.readAsDataURL(file);
  });
}

export function DictImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState<
    null | "template" | "upload" | "commit" | "errors"
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<api.ImportValidateResult | null>(
    null,
  );
  const [committed, setCommitted] =
    React.useState<api.ImportCommitResult | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [page, setPage] = React.useState(0);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const reset = () => {
    setResult(null);
    setCommitted(null);
    setError(null);
    setPage(0);
    setFilter("all");
  };

  // One list, flagged — so "Rejected" is a filter over the same table rather
  // than a second table the user has to mentally reconcile with the first.
  const staged: StagedRow[] = React.useMemo(() => {
    if (!result) return [];
    const rows: StagedRow[] = [
      ...result.valid.map((v) => ({
        row: v.row,
        raw: v.raw,
        reasons: [],
        ok: true,
      })),
      ...result.rejected.map((r) => ({
        row: r.row,
        raw: r.raw,
        reasons: r.reasons || [],
        ok: false,
      })),
    ];
    return rows.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  }, [result]);

  const filtered = React.useMemo(
    () =>
      filter === "all"
        ? staged
        : staged.filter((r) => (filter === "valid" ? r.ok : !r.ok)),
    [staged, filter],
  );
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  React.useEffect(() => {
    setPage(0);
  }, [filter]);

  async function downloadTemplate() {
    setBusy("template");
    setError(null);
    try {
      await api.downloadDictImportTemplate();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Clear immediately so re-picking the SAME file after a fix still fires
    // change — the input keeps its value otherwise and the second upload
    // silently does nothing.
    e.target.value = "";
    if (!file) return;
    setBusy("upload");
    setError(null);
    setCommitted(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      setResult(await api.validateDictImport(dataUrl, file.name));
      setPage(0);
    } catch (err) {
      setError(errMsg(err));
      setResult(null);
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!result || result.valid.length === 0) return;
    setBusy("commit");
    setError(null);
    try {
      const out = await api.commitDictImport(result.valid);
      setCommitted(out);
      // The list behind the modal refreshes now, not on close — the requirement
      // is that imported rows appear instantly.
      onImported();
      toast.success(
        `${out.summary.created} item${out.summary.created === 1 ? "" : "s"} created`,
      );
      // Anything the server rejected at insert joins the staging table, so the
      // user can export the full rejection set in one file.
      if (out.rejected.length) {
        setResult((r) =>
          r
            ? {
                ...r,
                valid: [],
                rejected: [...r.rejected, ...out.rejected],
                summary: {
                  ...r.summary,
                  valid: 0,
                  rejected: r.rejected.length + out.rejected.length,
                },
              }
            : r,
        );
        setFilter("rejected");
      } else {
        setResult((r) => (r ? { ...r, valid: [] } : r));
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function exportErrors() {
    if (!result || result.rejected.length === 0) return;
    setBusy("errors");
    setError(null);
    try {
      await api.downloadDictImportErrors(result.rejected);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  if (!open) return null;

  return (
    <Modal
      open
      onClose={() => {
        reset();
        onClose();
      }}
      size="lg"
      title="Import dictionary items"
      description="Download the template, fill it in, upload it to review — then commit the valid rows."
    >
      <div className="space-y-4">
        {/* Step 1 + 2 */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <Button
            type="button"
            variant="outline"
            loading={busy === "template"}
            onClick={downloadTemplate}
          >
            1 · Download template
          </Button>
          <Button
            type="button"
            variant="outline"
            loading={busy === "upload"}
            onClick={() => fileRef.current?.click()}
          >
            2 · Upload filled sheet
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            aria-label="Upload a filled dictionary template"
            onChange={onFile}
          />
          <p className="micro ml-auto">
            Enum dropdowns and your own account, tax and service codes are on
            the template&apos;s Reference sheet.
          </p>
        </div>

        {error && <ErrorState message={error} />}

        {result && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="mute">{num(result.summary.total)} rows read</Pill>
                <Pill tone="ok">{num(result.summary.valid)} valid</Pill>
                <Pill tone={result.summary.rejected ? "bad" : "mute"}>
                  {num(result.summary.rejected)} rejected
                </Pill>
              </div>
              <Segmented
                label="Row filter"
                value={filter}
                onChange={(v) => setFilter(v as Filter)}
                options={[
                  { value: "all", label: "All" },
                  { value: "valid", label: "Valid" },
                  { value: "rejected", label: "Rejected" },
                ]}
              />
            </div>

            {result.summary.rejected > 0 && (
              <Callout tone="warn" title="Some rows cannot be imported">
                The valid rows can still be committed — this import is partial
                by design. Export the rejected rows, fix them in Excel and
                upload the corrected file.
              </Callout>
            )}

            <div className="max-h-[46vh] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Rows staged for import, with the reason each rejected row
                  cannot be created
                </caption>
                <thead className="sticky top-0 bg-muted">
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th scope="col" className="px-3 py-2">
                      Row
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Name
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Direction
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Category
                    </th>
                    <th scope="col" className="px-3 py-2">
                      OHADA
                    </th>
                    <th scope="col" className="px-3 py-2">
                      State
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 micro">
                        No rows match this filter.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((r, i) => (
                      <tr
                        key={`${r.row}-${i}`}
                        className={r.ok ? "" : "bg-bad/5"}
                      >
                        <td className="px-3 py-1.5 num text-xs">
                          {r.row ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {cell(r.raw.label_fr)}
                          {r.raw.label_en ? (
                            <span className="block text-muted-foreground">
                              {String(r.raw.label_en)}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {cell(r.raw.direction)}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {cell(r.raw.category)}
                        </td>
                        <td className="px-3 py-1.5 num text-xs">
                          {[
                            r.raw.sale_debit
                              ? `sale ${r.raw.sale_debit}→${r.raw.sale_credit || "?"}`
                              : "",
                            r.raw.purchase_debit
                              ? `purchase ${r.raw.purchase_debit}→${r.raw.purchase_credit || "?"}`
                              : "",
                            r.raw.disbursement_debit
                              ? `disb ${r.raw.disbursement_debit}→${r.raw.disbursement_credit || "?"}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.ok ? (
                            <Pill tone="ok">{tr("Valid")}</Pill>
                          ) : (
                            <>
                              <Pill tone="bad">{tr("Rejected")}</Pill>
                              {/* The reason belongs on the row, not in a tooltip:
                                fixing 40 rows means reading 40 reasons. */}
                              <ul className="mt-1 list-none space-y-0.5 p-0 text-xs text-muted-foreground">
                                {r.reasons.map((why, j) => (
                                  <li key={j}>{why}</li>
                                ))}
                              </ul>
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {filtered.length > PAGE_SIZE && (
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={filtered.length}
                onPageChange={setPage}
              />
            )}
          </>
        )}

        {committed && (
          <Callout
            tone={committed.summary.rejected ? "warn" : "ok"}
            title="Import complete"
          >
            {num(committed.summary.created)} item
            {committed.summary.created === 1 ? "" : "s"} created
            {committed.summary.rejected
              ? `, ${num(committed.summary.rejected)} rejected — export them below and re-upload once fixed.`
              : "."}
          </Callout>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <div>
          {result && result.rejected.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              loading={busy === "errors"}
              onClick={exportErrors}
            >
              Export rejected rows (.xlsx)
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Close
          </Button>
          <Button
            type="button"
            loading={busy === "commit"}
            disabled={!result || result.valid.length === 0 || busy !== null}
            onClick={commit}
          >
            3 · Commit {result ? num(result.valid.length) : 0} valid row
            {result && result.valid.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
