/**
 * Vault — the document store: upload, browse, download.
 *
 * Split out of `features/vault/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { errMsg, useList, useRefresh } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { tokenStore } from "@/lib/token-store";

const FILE_CONTEXTS = [
  { value: "", label: "— none —" },
  { value: "OPS", label: "Operations" },
  { value: "OVH", label: "Overhead" },
];

/** Auth-gated binary download: the /download endpoint returns bytes (not JSON),
 *  so we fetch with the Bearer token + env header and open the blob in a tab. */
async function downloadDocument(id: string) {
  const token = tokenStore.getAccess();
  const res = await fetch(`/api/tenant/documents/${id}/download`, {
    headers: {
      "X-Praxis-Env": tokenStore.getEnv(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    let msg = "Download failed.";
    try {
      const j = await res.json();
      if (res.status === 409) msg = "This document hasn't been rendered yet.";
      else if (j?.error?.message) msg = String(j.error.message);
    } catch {
      /* non-JSON body */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function UploadDocumentForm({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [docType, setDocType] = React.useState("");
  const [entityRef, setEntityRef] = React.useState("");
  const [fileContext, setFileContext] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFile(null);
    setDocType("");
    setEntityRef("");
    setFileContext("");
    setError(null);
  }, [open]);

  const canSubmit = !!file && !busy;

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const data_url = await readAsDataUrl(file);
      await tenant("/documents", {
        method: "POST",
        body: {
          data_url,
          doc_type: docType.trim() || undefined,
          entity_ref: entityRef.trim() || undefined,
          file_context: fileContext || undefined,
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload document"
      description="Stored in the confidential vault with a SHA-256 fingerprint (max 25 MB)."
      size="lg"
    >
      <div className="space-y-4">
        <Field label="File" required>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Document type" hint="e.g. invoice, bill_of_lading">
            <Input
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              placeholder="invoice"
            />
          </Field>
          <Field label="File context">
            <Select
              value={fileContext}
              onChange={(e) => setFileContext(e.target.value)}
            >
              {FILE_CONTEXTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Reference"
            hint="Optional business key (entity_ref)"
            className="sm:col-span-2"
          >
            <Input
              value={entityRef}
              onChange={(e) => setEntityRef(e.target.value)}
              placeholder="DOSSIER-2026-0042"
            />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            Upload
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const DOC_FILTERS = [
  { value: "", label: "All" },
  { value: "VERIFIED", label: "Verified" },
  { value: "ARCHIVED", label: "Archived" },
];

export function DocumentsPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/documents");
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [q, setQ] = React.useState("");
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function withRow(id: string, fn: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await fn();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }
  const archive = (id: string) =>
    withRow(id, async () => {
      await tenant(`/documents/${id}`, { method: "DELETE" });
      reload();
    });
  const download = (id: string) => withRow(id, () => downloadDocument(id));

  const shown = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (filter && String(r.status ?? "").toUpperCase() !== filter)
        return false;
      if (!term) return true;
      return [r.doc_type, r.entity_ref, r.folder_ref].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(term),
      );
    });
  }, [rows, filter, q]);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Vault & compliance" to="/vault" />}
        title="Documents"
        description="The confidential document vault — uploaded evidence with tamper-evident fingerprints."
        action={
          <Button onClick={() => setUploadOpen(true)}>Upload document</Button>
        }
      />
      <HubTabs />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Chips
          label="Filter documents by status"
          value={filter}
          options={DOC_FILTERS}
          onChange={setFilter}
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search type / reference…"
          className="max-w-xs"
        />
      </div>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : shown.length === 0 ? (
        <EmptyState
          title={rows.length ? "No documents match" : "No documents yet"}
          hint={
            rows.length
              ? "Try another filter."
              : "Upload a document to the vault."
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Type</TH>
              <TH>Reference</TH>
              <TH>Ver.</TH>
              <TH>Status</TH>
              <TH>Uploaded</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {shown.map((r) => {
              const id = String(r.doc_id);
              const archived =
                String(r.status ?? "").toUpperCase() === "ARCHIVED";
              return (
                <TR key={id}>
                  <TD className="text-sm font-medium">{cell(r.doc_type)}</TD>
                  <TD className="text-sm">{cell(r.entity_ref)}</TD>
                  <TD className="num text-sm">{cell(r.version_no)}</TD>
                  <TD className="text-sm">
                    <StatusPill status={String(r.status ?? "—")} />
                  </TD>
                  <TD className="text-sm">{dateFmt(r.created_at)}</TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={rowBusy === id}
                        onClick={() => download(id)}
                      >
                        Download
                      </Button>
                      {!archived && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={rowBusy === id}
                          onClick={() => archive(id)}
                        >
                          Archive
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <UploadDocumentForm
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaved={reload}
      />
    </section>
  );
}

/* ═══════════════════════════════════ SIGNATURES ═══════════════════════════════════ */
