/**
 * Vault — the report catalogue, saved runs and the dashboard tile picker.
 *
 * Split out of `features/vault/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant, tenantDownload } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, Field } from "@/components/ui/modal";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { DataView } from "@/components/ui/data-view";
import { Segmented } from "@/components/ui/segmented";
import { isGated } from "./shared";

/* ═══════════════════════════════════ REPORTS ═══════════════════════════════════ */

const REPORTS_AI: AiAction[] = [
  {
    label: "Run a report",
    kind: "read",
    describe:
      "Run any catalogue report and summarise the result in plain language.",
  },
  {
    label: "Explain a movement",
    kind: "assist",
    describe:
      "Explain a change in a report (e.g. why receivables ageing shifted).",
  },
];

const PARAM_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "from", label: "From", placeholder: "2026-01-01" },
  { key: "to", label: "To", placeholder: "2026-03-31" },
  { key: "as_of", label: "As of", placeholder: "2026-03-31" },
  { key: "period_code", label: "Period code", placeholder: "2026-Q1" },
  { key: "dossier_id", label: "Operations file id", placeholder: "uuid (dossier_360)" },
];

function RunReportModal({
  report,
  onClose,
  onSaved,
}: {
  report: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
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

  const filled = () =>
    Object.fromEntries(Object.entries(params).filter(([, v]) => v.trim()));

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
      await tenant("/reports/saved", {
        method: "POST",
        body: {
          name: saveName.trim() || key,
          report_key: key,
          params: filled(),
          is_shared: shared,
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }
  // Server runs the report fresh and streams the file — works with the current
  // params whether or not the preview above has been run.
  async function exportAs(format: "csv" | "xlsx") {
    setError(null);
    try {
      const qs = new URLSearchParams({ ...filled(), format }).toString();
      await tenantDownload(
        `/reports/run/${key}/export?${qs}`,
        `${key}.${format}`,
      );
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Run — ${key}`}
      description={report ? String(report.describe) : ""}
      size="xl"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {PARAM_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}>
              <Input
                value={params[f.key] ?? ""}
                onChange={(e) =>
                  setParams((p) => ({ ...p, [f.key]: e.target.value }))
                }
                placeholder={f.placeholder}
              />
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={run} loading={running}>
            Run report
          </Button>
          <Button
            variant="outline"
            onClick={() => exportAs("csv")}
            disabled={running}
          >
            Export CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => exportAs("xlsx")}
            disabled={running}
          >
            Export XLSX
          </Button>
          <span className="text-xs text-muted-foreground">
            Leave params blank for report defaults.
          </span>
        </div>

        {error && <ErrorState message={error} />}
        {result !== undefined && (
          <div className="space-y-3">
            <DataView
              data={result}
              emptyTitle="This report returned no rows"
              emptyHint="Adjust the parameters above and run it again."
            />
            <div className="flex flex-wrap items-end gap-2 border-t pt-3">
              <Field label="Save as" className="flex-1">
                <Input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="My Q1 income statement"
                />
              </Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={shared}
                  onChange={(e) => setShared(e.target.checked)}
                />
                Share with team
              </label>
              <Button
                variant="outline"
                onClick={save}
                loading={saving}
                disabled={saving}
              >
                Save report
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultModal({
  open,
  title,
  path,
  onClose,
}: {
  open: boolean;
  title: string;
  path: string;
  onClose: () => void;
}) {
  const [data, setData] = React.useState<unknown>(undefined);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setData(undefined);
    setError(null);
    tenant<Row>(path)
      .then(
        (r) =>
          live &&
          setData(
            r && typeof r === "object" && "data" in r ? (r as Row).data : r,
          ),
      )
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [open, path]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Report result."
      size="xl"
    >
      <div className="space-y-4">
        {error ? (
          <ErrorState message={error} />
        ) : data === undefined ? (
          <LoadingRow label="Running…" />
        ) : (
          <DataView
            data={data}
            emptyTitle="This saved report returned no rows"
          />
        )}
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
  const [tab, setTab] = React.useState<"catalogue" | "saved" | "tiles">(
    "catalogue",
  );
  const reload = useRefresh();
  // Was one hand-rolled useEffect + Promise.all keyed on a local nonce, which
  // refetched all three lists on every mount with no cache (F8). As three
  // useList calls they are deduplicated, cached and revalidated independently —
  // and /reports/catalogue is now shared with every other screen that reads it.
  const {
    rows: catalogue,
    error: catalogueError,
    errorCode: catalogueCode,
  } = useList<Row>("/reports/catalogue");
  const {
    rows: saved,
    error: savedError,
    errorCode: savedCode,
  } = useList<Row>("/reports/saved");
  // Tiles are optional: the endpoint 403s for roles without dashboard config,
  // and that must not blank the page. The original swallowed it with
  // `.catch(() => [])`; here its error is simply not surfaced.
  const { rows: tiles } = useList<Row>("/reports/tiles");
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [running, setRunning] = React.useState<Row | null>(null);
  const [savedResult, setSavedResult] = React.useState<{
    title: string;
    path: string;
  } | null>(null);
  const [tileBusy, setTileBusy] = React.useState<string | null>(null);

  const error = actionError ?? catalogueError ?? savedError;
  const errorCode = catalogueCode ?? savedCode;
  const setError = setActionError;

  async function del(id: string) {
    try {
      await tenant(`/reports/saved/${id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  // Tile map keyed by tile_key (== report_key) for quick lookup of dashboard state.
  const tileByKey = React.useMemo(
    () => new Map((tiles || []).map((t) => [String(t.tile_key), t])),
    [tiles],
  );

  async function setTile(
    tileKey: string,
    patch: { position?: number; is_visible?: boolean },
  ) {
    setTileBusy(tileKey);
    setError(null);
    const existing = tileByKey.get(tileKey);
    const body = {
      tile_key: tileKey,
      position:
        patch.position ??
        (existing ? Number(existing.position) || 0 : (tiles || []).length),
      is_visible:
        patch.is_visible ?? (existing ? existing.is_visible !== false : true),
      config: existing?.config ?? {},
    };
    try {
      await tenant("/reports/tiles", { method: "PUT", body });
      // Was a manual refetch into local state. Invalidating the cache instead
      // means every screen showing tiles updates, not just this one.
      reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setTileBusy(null);
    }
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Vault & compliance" to="/vault" />}
        title="Reports"
        description="Run finance, receivables and cross-module reports; save the ones you use."
        action={
          <Segmented
            label="Reports section"
            value={tab}
            onChange={setTab}
            options={[
              { value: "catalogue", label: "Catalogue" },
              { value: "saved", label: "Saved" },
              { value: "tiles", label: "Dashboard tiles" },
            ]}
          />
        }
      />
      <HubTabs />

      {error ? (
        isGated(errorCode) ? (
          <EmptyState
            title="Reporting isn't enabled for this tenant"
            hint="The reporting feature flag is off. Enable it in the developer dashboard to run reports."
          />
        ) : (
          <ErrorState message={error} />
        )
      ) : catalogue === null ? (
        <SkeletonTable />
      ) : tab === "tiles" ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Choose which reports appear as tiles on your Control Tower, toggle
            their visibility and order.
          </p>
          {catalogue.map((r) => {
            const key = String(r.report_key);
            const t = tileByKey.get(key);
            const on = !!t;
            const visible = t ? t.is_visible !== false : false;
            return (
              <div
                key={key}
                className="lux-card flex flex-wrap items-center gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {key}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {cell(r.describe)}
                  </p>
                </div>
                {on && (
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    Pos
                    <Input
                      type="number"
                      min="0"
                      className="num h-8 w-16 text-right"
                      defaultValue={String(Number(t?.position) || 0)}
                      onBlur={(e) =>
                        setTile(key, { position: Number(e.target.value) || 0 })
                      }
                    />
                  </label>
                )}
                {on && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={tileBusy === key}
                    onClick={() => setTile(key, { is_visible: !visible })}
                  >
                    {visible ? "Hide" : "Show"}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={on ? "outline" : "default"}
                  disabled={tileBusy === key}
                  onClick={() =>
                    setTile(key, { is_visible: on ? false : true })
                  }
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
            <div
              key={String(r.report_key)}
              className="lux-card flex flex-col p-4"
            >
              <p className="text-sm font-semibold text-foreground">
                {cell(r.report_key)}
              </p>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">
                {cell(r.describe)}
              </p>
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRunning(r)}
                >
                  Run
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (saved || []).length === 0 ? (
        <EmptyState
          title="No saved reports"
          hint="Run a report from the catalogue and save it to pin it here."
        />
      ) : (
        <div className="space-y-2">
          {(saved || []).map((s) => (
            <div
              key={String(s.saved_report_id)}
              className="lux-card flex items-center gap-3 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {cell(s.name)}
                  </p>
                  {s.is_shared ? <StatusPill status="shared" /> : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {cell(s.report_key)} · {dateFmt(s.created_at)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSavedResult({
                    title: String(s.name),
                    path: `/reports/saved/${String(s.saved_report_id)}/run`,
                  })
                }
              >
                Run
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => del(String(s.saved_report_id))}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}

      <AiActions actions={REPORTS_AI} />

      <RunReportModal
        report={running}
        onClose={() => setRunning(null)}
        onSaved={reload}
      />
      <ResultModal
        open={!!savedResult}
        title={savedResult?.title ?? ""}
        path={savedResult?.path ?? ""}
        onClose={() => setSavedResult(null)}
      />
    </section>
  );
}

/* ═══════════════════════════════ COMPLIANCE FLAGS ═══════════════════════════════ */
