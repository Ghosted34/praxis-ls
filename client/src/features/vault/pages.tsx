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
import { Modal, Field } from "@/components/ui/modal";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { Row, errMsg, cell, when, Badge, Chips, Segmented } from "@/features/sales/ui";

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
        <LoadingRow label="Loading reports…" />
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
            <LoadingRow label="Loading flags…" />
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
        <LoadingRow label="Loading rules…" />
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
