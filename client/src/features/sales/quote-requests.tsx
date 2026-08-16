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
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { SplitPane } from "@/components/ui/split-pane";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { pageShell } from "@/lib/layout";
import { cell } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { Link } from "react-router-dom";
import { QuoteRequestForm, ConvertToOpportunityModal } from "./quote-request-forms";
import { IntakeDossier } from "./sales-360";

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
  /** The request whose 360 fills the right-hand pane. */
  const [selId, setSelId] = React.useState<string | null>(null);

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
  const selected = rows.find((r: any) => String(r.quote_request_id) === selId) || null;

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

      {/*
        An index on the left, the full 360 on the right — Master data → Clients
        (`masterdata/client-360.tsx`), deliberately.

        It was a card list, one `lux-card` per request with the logistics scope
        crammed into a subtitle. A register whose job is comparing route,
        incoterm and age cannot do that when every row is a paragraph; the scope
        now has a tab of its own on the right, and the row carries what an index
        row should — the reference and the state.

        The lifecycle buttons moved into the dossier header with it (see
        `ActionBar` in sales-360.tsx). Deciding a request is QUOTED is a
        judgement about its attachments and its scope, which are on the right.
      */}
      {error ? (
        <ErrorState message={error} />
      ) : (
        <SplitPane
          storageKey="sales.quote-requests"
          label="Quote request list width"
          defaultSize={260}
          min={200}
          max={480}
        >
          <div className="space-y-2">
            <Input
              placeholder="Search request…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {data === null ? (
                <LoadingRow label="Loading requests…" />
              ) : rows.length === 0 ? (
                <div className="px-3 py-4 micro">No quote requests.</div>
              ) : (
                rows.map((r: any) => {
                  const id = String(r.quote_request_id);
                  return (
                    <button
                      key={id}
                      onClick={() => setSelId(id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-mono font-medium">
                          {cell(r.public_ref)}
                        </span>
                        <span className="block truncate micro">
                          {cell(r.requester_company)}
                        </span>
                      </span>
                      <StatusPill status={String(r.status || "RECEIVED")} />
                    </button>
                  );
                })
              )}
            </div>
          </div>
          {selected ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <Link
                  to={`/sales/quote-requests/${selId}`}
                  className="micro hover:underline"
                >
                  Open as a page ↗
                </Link>
              </div>
              <IntakeDossier
                quoteRequestId={String(selected.quote_request_id)}
                // Reference and state come from the row just clicked, so the
                // header is right immediately — see DossierSkeleton.
                placeholder={{
                  title: String(selected.public_ref || ""),
                  status: String(selected.status || "RECEIVED"),
                }}
                onEdit={() => {
                  setEditing(selected);
                  setFormOpen(true);
                }}
                onChanged={reload}
              />
            </div>
          ) : (
            <EmptyState
              title={rows.length ? "No request selected" : "No quote requests yet"}
              hint={
                rows.length
                  ? "Choose a request from the list."
                  : "Capture a request manually, or wait for the website intake to land one here."
              }
            />
          )}
        </SplitPane>
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
