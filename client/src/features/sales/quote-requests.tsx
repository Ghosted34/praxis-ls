/**
 * Sales & CRM — Quote requests (F6 intake register).
 *
 * doc/SALES_CRM_FEATURES.md#F6. The logistics-scope intake register with its
 * own lifecycle (RECEIVED -> UNDER_REVIEW -> CLARIFICATION_REQUIRED -> QUOTED
 * -> CONVERTED_TO_OPPORTUNITY, plus CLOSED_NO_ACTION).
 *
 * THE TILES PARTITION THE SET. There is one tile per intake status, plus
 * TOTAL, and they add up — under every filter combination, with no row left
 * over. That is the defect F6 exists to correct: the legacy stored intake
 * status and pipeline stage in one column, so its counters described a
 * fraction of the register and "converted: 0" was false. This screen briefly
 * reproduced it in a different way, listing four tiles against six possible
 * statuses, so every CLARIFICATION_REQUIRED and CLOSED_NO_ACTION row was
 * counted into TOTAL and displayed nowhere.
 *
 * Two things stop it coming back: the API derives the tiles from its own
 * status list and asserts they sum to TOTAL before responding, and this screen
 * renders whatever it is given rather than keeping a hand-written list.
 *
 * The page is its own tab on the Sales & CRM hub (not nested under Leads)
 * because it is a different state machine from `lead.status`. Leads carry
 * the commercial funnel (NEW -> ... -> CONVERTED); quote requests carry
 * the intake lifecycle; opportunities carry the pipeline stage. Three
 * different concerns, three different rows — that is the F6 architectural
 * correction.
 */

import * as React from "react";
import { tenant, download } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { pageShell } from "@/lib/layout";
import { cell, dateFmt } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { QuoteRequestForm, ConvertToOpportunityModal } from "./quote-request-forms";

/** TOTAL plus one count per intake status; `OTHER` only ever appears if a row
 *  carries a status the API does not know, which the screen shows rather than
 *  hides. */
type Kpi = Record<string, number>;

/** Tile order and captions — lifecycle order, TOTAL first. Kept beside
 *  STATUS_FILTERS below so the two cannot drift apart. */
const KPI_TILES: { key: string; label: string; accent: string }[] = [
  { key: "TOTAL", label: "Total", accent: "text-foreground" },
  { key: "RECEIVED", label: "Received", accent: "text-primary-ink" },
  { key: "UNDER_REVIEW", label: "Under review", accent: "text-warn" },
  { key: "CLARIFICATION_REQUIRED", label: "Needs clarification", accent: "text-warn" },
  { key: "QUOTED", label: "Quoted", accent: "text-ok" },
  { key: "CONVERTED_TO_OPPORTUNITY", label: "Converted", accent: "text-primary-ink" },
  { key: "CLOSED_NO_ACTION", label: "Closed", accent: "text-muted-foreground" },
];

const EMPTY_KPI: Kpi = KPI_TILES.reduce((a, t) => ({ ...a, [t.key]: 0 }), {} as Kpi);

const QUOTE_REQUEST_AI: AiAction[] = [
  {
    label: "Triage intake to UNDER_REVIEW",
    kind: "assist",
    describe: "Move a freshly received quote request to UNDER_REVIEW (the first step of the intake funnel).",
  },
  {
    label: "Suggest next step",
    kind: "assist",
    describe: "Read the request's status, attachments and history, and suggest the next concrete action (REQUEST_INFO / MOVE_TO_QUOTED / CLOSE_NO_ACTION).",
  },
  {
    label: "Convert to opportunity",
    kind: "write",
    describe: "Create a pipeline opportunity from a QUOTED request (human-confirmed before the convert runs).",
  },
];

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "RECEIVED", label: "Received" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "CLARIFICATION_REQUIRED", label: "Needs clarification" },
  { value: "QUOTED", label: "Quoted" },
  { value: "CONVERTED_TO_OPPORTUNITY", label: "Converted" },
  { value: "CLOSED_NO_ACTION", label: "Closed" },
];

const CHANNEL_FILTERS = [
  { value: "", label: "All channels" },
  { value: "WEBSITE", label: "Website" },
  { value: "MANUAL", label: "Manual" },
  { value: "REFERRAL", label: "Referral" },
  { value: "CAMPAIGN", label: "Campaign" },
];

const NEXT_STATUS: Record<string, string | null> = {
  RECEIVED: "UNDER_REVIEW",
  UNDER_REVIEW: "QUOTED",
  QUOTED: "CONVERTED_TO_OPPORTUNITY",
};

function KpiTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="lux-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

export function QuoteRequestsPage() {
  const [statusFilter, setStatusFilter] = React.useState("");
  const [channelFilter, setChannelFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [data, setData] = React.useState<{ rows: any[]; total: number; kpi: Kpi } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<any | null>(null);
  const [converting, setConverting] = React.useState<any | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (channelFilter) params.set("intake_channel", channelFilter);
      if (search.trim()) params.set("q", search.trim());
      const qs = params.toString();
      const out = await tenant<any>(`/quote-requests${qs ? `?${qs}` : ""}`);
      // The backend returns { rows, total, kpi } directly (not wrapped in data).
      // Some endpoints wrap; tolerate both.
      const payload = out && typeof out === "object" && "rows" in out ? out : out?.data;
      setData({
        rows: payload?.rows || [],
        total: payload?.total || 0,
        kpi: payload?.kpi || EMPTY_KPI,
      });
    } catch (e) {
      setError(errMsg(e));
    }
  }, [statusFilter, channelFilter, search]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  async function transition(id: string, to: string) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/quote-requests/${id}/transition`, { method: "POST", body: { to } });
      await reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (channelFilter) params.set("intake_channel", channelFilter);
    if (search.trim()) params.set("q", search.trim());
    const qs = params.toString();
    const today = new Date().toISOString().slice(0, 10);
    void download(`/quote-requests/export.csv${qs ? `?${qs}` : ""}`, `quote_requests_${today}.csv`);
  }

  const rows = data?.rows || [];
  const kpi = data?.kpi || EMPTY_KPI;

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Quote requests"
        description="Logistics-scope intake register. One tile per intake state, and they add up under every filter; conversion produces a tracked opportunity in the pipeline."
      />
      <HubTabs />

      {/* One tile per intake status, plus TOTAL — they sum to TOTAL under every
          filter. `OTHER` is rendered only when the API reports a status it does
          not recognise, so a counter that stops adding up is visible instead of
          silently absorbed. */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {KPI_TILES.map((t) => (
          <KpiTile key={t.key} label={t.label} value={kpi[t.key] ?? 0} accent={t.accent} />
        ))}
        {kpi.OTHER ? <KpiTile label="Unrecognised" value={kpi.OTHER} accent="text-bad" /> : null}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a request — ref, requester, origin, destination, cargo…"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
            Export CSV
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Capture request
          </Button>
        </div>
      </div>

      <div className="mb-4 space-y-3">
        <Chips
          label="Filter by status"
          value={statusFilter}
          options={STATUS_FILTERS}
          onChange={setStatusFilter}
        />
        <Chips
          label="Filter by channel"
          value={channelFilter}
          options={CHANNEL_FILTERS}
          onChange={setChannelFilter}
        />
      </div>

      {rowError && <ErrorState message={rowError} />}
      {error ? (
        <ErrorState message={error} />
      ) : data === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No quote requests yet"
          hint="Capture a request manually, or wait for the website intake to land one here."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const id = String(r.quote_request_id);
            const status = String(r.status || "RECEIVED");
            const next = NEXT_STATUS[status];
            const locked = status === "CONVERTED_TO_OPPORTUNITY" || status === "CLOSED_NO_ACTION";
            return (
              <div key={id} className="lux-card flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-mono text-sm font-semibold text-foreground">
                      {cell(r.public_ref)}
                    </p>
                    <StatusPill status={status} />
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {cell(r.intake_channel).toLowerCase()}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[cell(r.requester_company), cell(r.requester_name)].filter((x) => x !== "—").join(" · ") || "—"}
                    {r.service_category ? ` · ${cell(r.service_category)}` : ""}
                    {r.incoterm ? ` · ${cell(r.incoterm)}` : ""}
                    {r.origin_location ? ` · ${cell(r.origin_location)} → ${cell(r.destination_location)}` : ""}
                  </p>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:block">{dateFmt(r.created_at)}</span>
                {!locked && (
                  <div className="flex gap-2">
                    {next ? (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={rowBusy === id}
                        onClick={() => transition(id, next)}
                      >
                        {next === "UNDER_REVIEW" ? "Start review" : next === "QUOTED" ? "Mark quoted" : "Convert"}
                      </Button>
                    ) : null}
                    {status === "QUOTED" && (
                      <Button size="sm" onClick={() => setConverting(r)}>
                        Open opportunity
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={rowBusy === id}
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    {status !== "QUOTED" && status !== "CONVERTED_TO_OPPORTUNITY" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={rowBusy === id}
                        onClick={() => transition(id, "CLOSED_NO_ACTION")}
                      >
                        Close
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <QuoteRequestForm
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
      />
      <ConvertToOpportunityModal
        request={converting}
        onClose={() => setConverting(null)}
        onDone={reload}
      />

      <AiActions actions={QUOTE_REQUEST_AI} />
    </section>
  );
}
