/**
 * Vault hubs — wired to live endpoints.
 *   - ReportsPage         → /reports  (feature-gated `reporting`)
 *   - ComplianceFlagsPage → /compliance
 *
 * Shared primitives + Pixie-tinted design from features/sales/ui.tsx.
 * AI panels are gated globally (components/ai-actions.tsx).
 */
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field, Select } from "@/components/ui/modal";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { Row, errMsg, cell, when, Badge, Chips, Segmented, useList } from "@/features/sales/ui";
import { tokenStore } from "@/lib/token-store";

function isGated(msg: string | null): boolean {
  return !!msg && /feature|not enabled|disabled|forbidden|permission/i.test(msg);
}

/** Generic renderer for an arbitrary report/portal payload. */
function ResultBlock({ data }: { data: unknown }) {
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
    const rows = data as Row[];
    const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    return (
      <div className="max-h-96 overflow-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/60">
            <tr>
              {cols.map((c) => (
                <th key={c} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">
                {cols.map((c) => (
                  <td key={c} className="px-3 py-1.5">
                    {cell(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (data === null || data === undefined) return <EmptyState title="No data" />;
  return <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/30 p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>;
}

/* ═══════════════════════════════════ REPORTS ═══════════════════════════════════ */

const REPORTS_AI: AiAction[] = [
  { label: "Run a report", kind: "read", describe: "Run any catalogue report and summarise the result in plain language." },
  { label: "Explain a movement", kind: "assist", describe: "Explain a change in a report (e.g. why receivables ageing shifted)." },
];

const PARAM_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "from", label: "From", placeholder: "2026-01-01" },
  { key: "to", label: "To", placeholder: "2026-03-31" },
  { key: "as_of", label: "As of", placeholder: "2026-03-31" },
  { key: "period_code", label: "Period code", placeholder: "2026-Q1" },
  { key: "dossier_id", label: "Dossier id", placeholder: "uuid (dossier_360)" },
];

function RunReportModal({ report, onClose, onSaved }: { report: Row | null; onClose: () => void; onSaved: () => void }) {
  const open = !!report;
  const key = report ? String(report.report_key) : "";
  const [params, setParams] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<unknown>(undefined);
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saveName, setSaveName] = React.useState("");
  const [shared, setShared] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!report) return;
    setParams({});
    setResult(undefined);
    setError(null);
    setSaveName(String(report.report_key));
    setShared(false);
  }, [report]);

  const filled = () => Object.fromEntries(Object.entries(params).filter(([, v]) => v.trim()));

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const qs = new URLSearchParams(filled()).toString();
      const res = await tenant<Row>(`/reports/run/${key}${qs ? `?${qs}` : ""}`);
      setResult(res.data);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRunning(false);
    }
  }
  async function save() {
    setSaving(true);
    setError(null);
    try {
      await tenant("/reports/saved", { method: "POST", body: { name: saveName.trim() || key, report_key: key, params: filled(), is_shared: shared } });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Run — ${key}`} description={report ? String(report.describe) : ""} size="xl">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {PARAM_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input value={params[f.key] ?? ""} onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))} placeholder={f.placeholder} />
            </Field>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={run} loading={running}>
            Run report
          </Button>
          <span className="text-xs text-muted-foreground">Leave params blank for report defaults.</span>
        </div>

        {error && <ErrorState message={error} />}
        {result !== undefined && (
          <div className="space-y-3">
            <ResultBlock data={result} />
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <Field label="Save as" className="flex-1">
                <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="My Q1 income statement" />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                Share with team
              </label>
              <Button variant="outline" onClick={save} loading={saving} disabled={saving}>
                Save report
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultModal({ open, title, path, onClose }: { open: boolean; title: string; path: string; onClose: () => void }) {
  const [data, setData] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setData(undefined);
    setError(null);
    tenant<Row>(path)
      .then((r) => live && setData(r && typeof r === "object" && "data" in r ? (r as Row).data : r))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [open, path]);

  return (
    <Modal open={open} onClose={onClose} title={title} description="Report result." size="xl">
      <div className="space-y-4">
        {error ? <ErrorState message={error} /> : data === undefined ? <LoadingRow label="Running…" /> : <ResultBlock data={data} />}
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ReportsPage() {
  const [tab, setTab] = React.useState<"catalogue" | "saved" | "tiles">("catalogue");
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const [catalogue, setCatalogue] = React.useState<Row[] | null>(null);
  const [saved, setSaved] = React.useState<Row[] | null>(null);
  const [tiles, setTiles] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState<Row | null>(null);
  const [savedResult, setSavedResult] = React.useState<{ title: string; path: string } | null>(null);
  const [tileBusy, setTileBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setError(null);
    setCatalogue(null);
    setSaved(null);
    setTiles(null);
    Promise.all([tenant<Row[]>("/reports/catalogue"), tenant<Row[]>("/reports/saved"), tenant<Row[]>("/reports/tiles").catch(() => [])])
      .then(([c, s, t]) => {
        if (!live) return;
        setCatalogue(Array.isArray(c) ? c : []);
        setSaved(Array.isArray(s) ? s : []);
        setTiles(Array.isArray(t) ? t : []);
      })
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [nonce]);

  async function del(id: string) {
    try {
      await tenant(`/reports/saved/${id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  // Tile map keyed by tile_key (== report_key) for quick lookup of dashboard state.
  const tileByKey = React.useMemo(() => new Map((tiles || []).map((t) => [String(t.tile_key), t])), [tiles]);

  async function setTile(tileKey: string, patch: { position?: number; is_visible?: boolean }) {
    setTileBusy(tileKey);
    setError(null);
    const existing = tileByKey.get(tileKey);
    const body = {
      tile_key: tileKey,
      position: patch.position ?? (existing ? Number(existing.position) || 0 : (tiles || []).length),
      is_visible: patch.is_visible ?? (existing ? existing.is_visible !== false : true),
      config: existing?.config ?? {},
    };
    try {
      await tenant("/reports/tiles", { method: "PUT", body });
      const t = await tenant<Row[]>("/reports/tiles").catch(() => tiles || []);
      setTiles(Array.isArray(t) ? t : []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setTileBusy(null);
    }
  }

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">Run finance, receivables and cross-module reports; save the ones you use.</p>
        </div>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "catalogue", label: "Catalogue" },
            { value: "saved", label: "Saved" },
            { value: "tiles", label: "Dashboard tiles" },
          ]}
        />
      </header>

      {error ? (
        isGated(error) ? (
          <EmptyState title="Reporting isn't enabled for this tenant" hint="The reporting feature flag is off. Enable it in the developer dashboard to run reports." />
        ) : (
          <ErrorState message={error} />
        )
      ) : catalogue === null ? (
        <SkeletonTable />
      ) : tab === "tiles" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Choose which reports appear as tiles on your Control Tower, toggle their visibility and order.</p>
          {catalogue.map((r) => {
            const key = String(r.report_key);
            const t = tileByKey.get(key);
            const on = !!t;
            const visible = t ? t.is_visible !== false : false;
            return (
              <div key={key} className="lux-card flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{key}</p>
                  <p className="truncate text-xs text-muted-foreground">{cell(r.describe)}</p>
                </div>
                {on && (
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    Pos
                    <Input
                      type="number"
                      min="0"
                      className="num h-8 w-16 text-right"
                      defaultValue={String(Number(t?.position) || 0)}
                      onBlur={(e) => setTile(key, { position: Number(e.target.value) || 0 })}
                    />
                  </label>
                )}
                {on && (
                  <Button size="sm" variant="ghost" disabled={tileBusy === key} onClick={() => setTile(key, { is_visible: !visible })}>
                    {visible ? "Hide" : "Show"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={on ? "outline" : "default"}
                  disabled={tileBusy === key}
                  onClick={() => setTile(key, { is_visible: on ? false : true })}
                >
                  {on ? (visible ? "On dashboard" : "Hidden") : "Add tile"}
                </Button>
              </div>
            );
          })}
        </div>
      ) : tab === "catalogue" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {catalogue.map((r) => (
            <div key={String(r.report_key)} className="lux-card flex flex-col p-4">
              <p className="text-sm font-semibold text-foreground">{cell(r.report_key)}</p>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">{cell(r.describe)}</p>
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={() => setRunning(r)}>
                  Run
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (saved || []).length === 0 ? (
        <EmptyState title="No saved reports" hint="Run a report from the catalogue and save it to pin it here." />
      ) : (
        <div className="space-y-2">
          {(saved || []).map((s) => (
            <div key={String(s.saved_report_id)} className="lux-card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{cell(s.name)}</p>
                  {s.is_shared ? <Badge label="shared" /> : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">{cell(s.report_key)} · {when(s.created_at)}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setSavedResult({ title: String(s.name), path: `/reports/saved/${String(s.saved_report_id)}/run` })}>
                Run
              </Button>
              <Button size="sm" variant="ghost" onClick={() => del(String(s.saved_report_id))}>
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}

      <AiActions actions={REPORTS_AI} />

      <RunReportModal report={running} onClose={() => setRunning(null)} onSaved={reload} />
      <ResultModal open={!!savedResult} title={savedResult?.title ?? ""} path={savedResult?.path ?? ""} onClose={() => setSavedResult(null)} />
    </section>
  );
}

/* ═══════════════════════════════ COMPLIANCE FLAGS ═══════════════════════════════ */

const COMPLIANCE_AI: AiAction[] = [
  { label: "Triage open flags", kind: "assist", describe: "Summarise open compliance flags by severity and suggest what to fix first." },
];

const SEVERITY_FILTERS = [
  { value: "", label: "All" },
  { value: "RED", label: "Red" },
  { value: "YELLOW", label: "Yellow" },
  { value: "GREEN", label: "Green" },
];

export function ComplianceFlagsPage() {
  const [tab, setTab] = React.useState<"flags" | "rules">("flags");
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const [flags, setFlags] = React.useState<Row[] | null>(null);
  const [rules, setRules] = React.useState<Row[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [severity, setSeverity] = React.useState("");
  const [includeResolved, setIncludeResolved] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setError(null);
    setFlags(null);
    const q = includeResolved ? "?include_resolved=true" : "";
    Promise.all([tenant<Row[]>(`/compliance${q}`), tenant<Row[]>("/compliance/catalogue")])
      .then(([f, c]) => {
        if (!live) return;
        setFlags(Array.isArray(f) ? f : []);
        setRules(Array.isArray(c) ? c : []);
      })
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [nonce, includeResolved]);

  async function runChecks() {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const res = await tenant<Row>("/compliance/run", { method: "POST", body: {} });
      const s = (res && typeof res === "object" ? (res as Row).summary : null) ?? res;
      setSummary(typeof s === "string" ? s : JSON.stringify(s));
      reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRunning(false);
    }
  }
  async function resolve(id: string) {
    setRowBusy(id);
    try {
      await tenant(`/compliance/${id}/resolve`, { method: "POST", body: {} });
      reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  const filtered = React.useMemo(() => (flags || []).filter((f) => !severity || String(f.severity) === severity), [flags, severity]);

  return (
    <section className="mx-auto max-w-5xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Compliance flags</h1>
          <p className="mt-1 text-sm text-muted-foreground">Run the rule scans and clear the flags they raise.</p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "flags", label: "Flags" },
              { value: "rules", label: "Rules" },
            ]}
          />
          {tab === "flags" && (
            <Button onClick={runChecks} loading={running}>
              Run checks
            </Button>
          )}
        </div>
      </header>

      {summary && <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground">Last run: {summary}</div>}
      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {tab === "flags" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Chips value={severity} options={SEVERITY_FILTERS} onChange={setSeverity} />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={includeResolved} onChange={(e) => setIncludeResolved(e.target.checked)} />
              Include resolved
            </label>
          </div>
          {flags === null ? (
            <SkeletonTable />
          ) : filtered.length === 0 ? (
            <EmptyState title={flags.length ? "No flags match" : "No open flags"} hint={flags.length ? "Try another severity." : "Run the checks to scan for compliance issues."} />
          ) : (
            <div className="space-y-2">
              {filtered.map((f) => {
                const id = String(f.compliance_flag_id ?? f.flag_id);
                const resolved = f.resolved_at || f.is_resolved;
                return (
                  <div key={id} className="lux-card flex items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{cell(f.rule_key)}</p>
                        <Badge label={String(f.severity || "—")} />
                        {resolved ? <span className="text-xs text-muted-foreground">resolved</span> : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{cell(f.message)} · {cell(f.entity_ref)}</p>
                    </div>
                    {!resolved && (
                      <Button size="sm" variant="outline" loading={rowBusy === id} onClick={() => resolve(id)}>
                        Resolve
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : rules === null ? (
        <SkeletonTable />
      ) : (
        <div className="space-y-2">
          {(rules || []).map((r) => (
            <div key={String(r.rule_key)} className="lux-card flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{cell(r.rule_key)}</p>
                  <Badge label={String(r.severity || "—")} />
                </div>
                <p className="truncate text-xs text-muted-foreground">{cell(r.describe)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <AiActions actions={COMPLIANCE_AI} />
    </section>
  );
}

/* ═══════════════════════════════════ DOCUMENTS ═══════════════════════════════════ */

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

function UploadDocumentForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
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
    <Modal open={open} onClose={onClose} title="Upload document" description="Stored in the confidential vault with a SHA-256 fingerprint (max 25 MB)." size="lg">
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
            <Input value={docType} onChange={(e) => setDocType(e.target.value)} placeholder="invoice" />
          </Field>
          <Field label="File context">
            <Select value={fileContext} onChange={(e) => setFileContext(e.target.value)}>
              {FILE_CONTEXTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference" hint="Optional business key (entity_ref)" className="sm:col-span-2">
            <Input value={entityRef} onChange={(e) => setEntityRef(e.target.value)} placeholder="DOSSIER-2026-0042" />
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
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList("/documents", nonce);
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
  const archive = (id: string) => withRow(id, async () => { await tenant(`/documents/${id}`, { method: "DELETE" }); reload(); });
  const download = (id: string) => withRow(id, () => downloadDocument(id));

  const shown = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (filter && String(r.status ?? "").toUpperCase() !== filter) return false;
      if (!term) return true;
      return [r.doc_type, r.entity_ref, r.folder_ref].some((v) => String(v ?? "").toLowerCase().includes(term));
    });
  }, [rows, filter, q]);

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">The confidential document vault — uploaded evidence with tamper-evident fingerprints.</p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>Upload document</Button>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Chips value={filter} options={DOC_FILTERS} onChange={setFilter} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search type / reference…" className="max-w-xs" />
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
        <EmptyState title={rows.length ? "No documents match" : "No documents yet"} hint={rows.length ? "Try another filter." : "Upload a document to the vault."} />
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
              const archived = String(r.status ?? "").toUpperCase() === "ARCHIVED";
              return (
                <TR key={id}>
                  <TD className="text-sm font-medium">{cell(r.doc_type)}</TD>
                  <TD className="text-sm">{cell(r.entity_ref)}</TD>
                  <TD className="num text-sm">{cell(r.version_no)}</TD>
                  <TD className="text-sm">
                    <Badge label={String(r.status ?? "—")} />
                  </TD>
                  <TD className="text-sm">{when(r.created_at)}</TD>
                  <TD>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" loading={rowBusy === id} onClick={() => download(id)}>
                        Download
                      </Button>
                      {!archived && (
                        <Button size="sm" variant="ghost" loading={rowBusy === id} onClick={() => archive(id)}>
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

      <UploadDocumentForm open={uploadOpen} onClose={() => setUploadOpen(false)} onSaved={reload} />
    </section>
  );
}

/* ═══════════════════════════════════ SIGNATURES ═══════════════════════════════════ */

const SIGN_METHODS = [
  { value: "DIGITAL", label: "Digital" },
  { value: "PHYSICAL", label: "Physical" },
];

function SignForm({ open, entityRef, onClose, onSaved }: { open: boolean; entityRef: string; onClose: () => void; onSaved: () => void }) {
  const [signerName, setSignerName] = React.useState("");
  const [method, setMethod] = React.useState("DIGITAL");
  const [signatureRef, setSignatureRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setSignerName("");
    setMethod("DIGITAL");
    setSignatureRef("");
    setError(null);
  }, [open]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await tenant("/signatures", {
        method: "POST",
        body: { entity_ref: entityRef, signer_name: signerName.trim() || undefined, method, signature_ref: signatureRef.trim() || undefined },
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
    <Modal open={open} onClose={onClose} title="Add signature" description={`Sign the document at reference "${entityRef}" — bound to its content fingerprint.`} size="lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Signer name" hint="Defaults to you if left blank">
            <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {SIGN_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Signature reference" hint="Optional external ref (e-sign id, doc №)" className="sm:col-span-2">
            <Input value={signatureRef} onChange={(e) => setSignatureRef(e.target.value)} placeholder="docusign:abc123" />
          </Field>
        </div>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Add signature
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function SignaturesPage() {
  const [refInput, setRefInput] = React.useState("");
  const [activeRef, setActiveRef] = React.useState("");
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows, error } = useList(`/signatures?entity_ref=${encodeURIComponent(activeRef)}`, nonce, !!activeRef);
  const [signOpen, setSignOpen] = React.useState(false);
  const gated = isGated(error);

  return (
    <section className="mx-auto max-w-4xl animate-fade-in">
      <header className="mb-5">
        <h1 className="font-display text-2xl tracking-tight">Signatures</h1>
        <p className="mt-1 text-sm text-muted-foreground">Signatures are bound to a document's fingerprint. Look one up by its reference, then sign.</p>
      </header>

      <form
        className="mb-5 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setActiveRef(refInput.trim());
        }}
      >
        <Field label="Document reference" className="min-w-64 flex-1">
          <Input value={refInput} onChange={(e) => setRefInput(e.target.value)} placeholder="DOSSIER-2026-0042" />
        </Field>
        <Button type="submit" disabled={!refInput.trim()}>
          Look up
        </Button>
      </form>

      {!activeRef ? (
        <EmptyState title="Enter a reference" hint="Type a document reference above to see its signatures." />
      ) : gated ? (
        <EmptyState title="Signatures aren't enabled" hint="The `signatures` feature flag is off for this tenant (or you lack access)." />
      ) : error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {rows.length} signature{rows.length === 1 ? "" : "s"} on <span className="font-medium text-foreground">{activeRef}</span>
            </p>
            <Button size="sm" onClick={() => setSignOpen(true)}>
              Add signature
            </Button>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No signatures yet" hint="Be the first to sign this document." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Signer</TH>
                  <TH>Method</TH>
                  <TH>Signed</TH>
                  <TH>Reference</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={String(r.signature_id ?? r.document_signature_id ?? `${r.entity_ref}-${r.signed_at}`)}>
                    <TD className="text-sm font-medium">{cell(r.signer_name ?? r.signer_user_id)}</TD>
                    <TD className="text-sm">
                      <Badge label={String(r.method ?? "—")} />
                    </TD>
                    <TD className="text-sm">{when(r.signed_at ?? r.created_at)}</TD>
                    <TD className="text-sm">{cell(r.signature_ref)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}

      <SignForm open={signOpen} entityRef={activeRef} onClose={() => setSignOpen(false)} onSaved={reload} />
    </section>
  );
}

/* ═══════════════════════════════════ VERIFICATION ═══════════════════════════════════ */

export function VerificationPage() {
  const [kind, setKind] = React.useState<"entity_ref" | "doc_id">("entity_ref");
  const [target, setTarget] = React.useState("");
  const [hash, setHash] = React.useState("");
  const [result, setResult] = React.useState<Row | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canVerify = !!target.trim() && hash.trim().length >= 4 && !busy;

  async function verify() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const qs = new URLSearchParams();
      qs.set("hash", hash.trim());
      qs.set(kind, target.trim());
      const r = await tenant<Row>(`/document-verification/verify?${qs.toString()}`);
      setResult(r);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const verified = result ? result.verified === true : null;

  return (
    <section className="mx-auto max-w-2xl animate-fade-in">
      <header className="mb-5">
        <h1 className="font-display text-2xl tracking-tight">Document verification</h1>
        <p className="mt-1 text-sm text-muted-foreground">Check a document's fingerprint against the vault — confirms it hasn't been tampered with.</p>
      </header>

      <form
        className="lux-card space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canVerify) verify();
        }}
      >
        <Field label="Look up by">
          <Segmented
            value={kind}
            onChange={(v) => setKind(v)}
            options={[
              { value: "entity_ref", label: "Reference" },
              { value: "doc_id", label: "Document ID" },
            ]}
          />
        </Field>
        <Field label={kind === "entity_ref" ? "Document reference" : "Document ID"} required>
          <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder={kind === "entity_ref" ? "DOSSIER-2026-0042" : "uuid…"} />
        </Field>
        <Field label="Hash" required hint="The fingerprint from the QR / document (min 4 chars)">
          <Input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="a1b2c3d4…" />
        </Field>
        {error && <ErrorState message={error} />}
        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!canVerify}>
            Verify
          </Button>
        </div>
      </form>

      {result && (
        <div className={`lux-card mt-4 p-4 ${verified ? "border-emerald-500/40" : "border-rose-500/40"}`}>
          <div className="flex items-center gap-2">
            <span className={`text-lg font-semibold ${verified ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {verified ? "✓ Verified — no tampering" : "✗ Not verified — hash mismatch"}
            </span>
          </div>
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="font-medium">{cell(result.doc_type)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-medium">{cell(result.version_no)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="font-medium">{cell(result.entity_ref)}</dd>
            </div>
            <div className="flex justify-between gap-4 sm:col-span-2">
              <dt className="text-muted-foreground">Stored hash</dt>
              <dd className="truncate font-mono text-xs">{cell(result.content_hash)}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
