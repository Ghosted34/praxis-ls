/**
 * Sales & CRM — the opportunity pipeline: Kanban board, list view, win/lose.
 *
 * Split out of `features/sales/pages.tsx` in Phase 4 (audit F7), then extended
 * by SALES_CRM_FEATURES.md#F7 (the sales pipeline feature).
 *
 * The board's drag-and-drop is a POINTER gesture. Every card also carries a
 * "Move" menu calling the same `/move` endpoint, because until Phase 4 added it
 * the CRM's primary screen could not be worked without a mouse at all.
 *
 * ── THE KPI ROW IS SERVER-COMPUTED (F7) ─────────────────────────────────────
 * It used to be summed in this component from `useList("/opportunities")` —
 * which returns ONE PAGE. Past 50 deals the "open pipeline" figure quietly
 * became "open pipeline, first page", and nothing on screen said so. It now
 * comes from `/opportunities/metrics`, which aggregates in SQL under the same
 * filters as the list.
 *
 * ── TWO WIN RATES, BOTH NAMED ───────────────────────────────────────────────
 * `win_rate_settled` is won / (won + lost) — decided deals only, the headline.
 * `win_rate_all_deals` is won / every deal, which is what the legacy's
 * kpis.php computes. They differ by a lot on a busy pipeline, and a dashboard
 * that shows one of them unlabelled is how two people quote different win rates
 * off the same screen. Null renders as "—", never 0%: "nothing has settled yet"
 * and "settled, none won" are different facts.
 */

import * as React from "react";
import { tenant, download } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Select } from "@/components/ui/modal";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, money } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { Segmented } from "@/components/ui/segmented";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { OpportunityForm, WinModal } from "./opportunity-forms";

/* ═══════════════════════════════ OPPORTUNITIES ═══════════════════════════════ */

type Metrics = {
  pipeline_value: number;
  weighted_value: number;
  won_value: number;
  open_count: number;
  won_count: number;
  lost_count: number;
  settled_count: number;
  total_count: number;
  win_rate_settled: number | null;
  win_rate_all_deals: number | null;
};

const OPP_AI: AiAction[] = [
  {
    label: "Pipeline health",
    kind: "read",
    describe:
      "Summarise the open pipeline — stage counts, weighted value and stalled deals.",
  },
  {
    label: "Move / create opportunity",
    kind: "write",
    describe:
      "Create an opportunity or move it to another stage (human-confirmed).",
  },
  {
    label: "Win / lose",
    kind: "write",
    describe:
      "Mark an opportunity won (optionally open a delivery dossier) or lost.",
  },
];

/** The 0683 intake vocabulary plus the two in-system origins a deal can have. */
const SOURCE_FILTERS = [
  { value: "", label: "All sources" },
  { value: "QUOTE_REQUEST", label: "Quote request" },
  { value: "WEBSITE", label: "Website" },
  { value: "MANUAL", label: "Manual" },
  { value: "REFERRAL", label: "Referral" },
  { value: "CAMPAIGN", label: "Campaign" },
  { value: "LEAD_CONVERSION", label: "Lead" },
  { value: "PARTNER", label: "Partner" },
];

const SOURCE_LABEL: Record<string, string> = Object.fromEntries(
  SOURCE_FILTERS.filter((s) => s.value).map((s) => [s.value, s.label]),
);

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v}%`;

export function OpportunitiesPage() {
  const reload = useRefresh();
  const { rows: stages, error: stErr } = useList("/opportunities/stages");
  const { rows: leads } = useList("/leads");
  const { rows: clients } = useList("/clients");
  const { rows: entities } = useList("/entities");

  const [view, setView] = React.useState<"board" | "list">("board");
  const [sourceFilter, setSourceFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [opps, setOpps] = React.useState<Row[] | null>(null);
  const [metrics, setMetrics] = React.useState<Metrics | null>(null);
  const [oppErr, setOppErr] = React.useState<string | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [winning, setWinning] = React.useState<Row | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  /** The filters the list, the KPI row and the CSV export all share. */
  const query = React.useCallback(() => {
    const p = new URLSearchParams();
    if (sourceFilter) p.set("source", sourceFilter);
    if (search.trim()) p.set("q", search.trim());
    // The board needs every open deal, not one page of them.
    p.set("limit", "200");
    return p;
  }, [sourceFilter, search]);

  const load = React.useCallback(async () => {
    setOppErr(null);
    const qs = query().toString();
    try {
      const [listOut, metricsOut] = await Promise.all([
        tenant<Row[] | { data: Row[] }>(`/opportunities${qs ? `?${qs}` : ""}`),
        tenant<Metrics | { data: Metrics }>(`/opportunities/metrics${qs ? `?${qs}` : ""}`),
      ]);
      const list = Array.isArray(listOut)
        ? listOut
        : (listOut as { data?: Row[] })?.data || [];
      const m =
        metricsOut && typeof metricsOut === "object" && "pipeline_value" in metricsOut
          ? (metricsOut as Metrics)
          : (metricsOut as { data?: Metrics })?.data || null;
      setOpps(list);
      setMetrics(m);
    } catch (e) {
      setOppErr(errMsg(e));
    }
  }, [query]);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** Refetch this screen's own state AND every cached tenant query. */
  const refreshAll = React.useCallback(() => {
    void load();
    reload();
  }, [load, reload]);

  const clientName = React.useMemo(
    () =>
      new Map(
        (clients || []).map((c) => [
          String(c.client_id),
          cell(c.name ?? c.legal_name),
        ]),
      ),
    [clients],
  );
  const leadName = React.useMemo(
    () =>
      new Map(
        (leads || []).map((l) => [String(l.lead_id), cell(l.company_name)]),
      ),
    [leads],
  );
  function withLabel(o: Row): string {
    if (o.client_id) return clientName.get(String(o.client_id)) ?? "Client";
    if (o.lead_id) return leadName.get(String(o.lead_id)) ?? "Lead";
    return "—";
  }

  async function act(id: string, fn: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await fn();
      refreshAll();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }
  const move = (id: string, stageId: string) =>
    act(id, () =>
      tenant(`/opportunities/${id}/move`, {
        method: "POST",
        body: { pipeline_stage_id: stageId },
      }),
    );
  const lose = (id: string) =>
    act(id, () =>
      tenant(`/opportunities/${id}/lose`, { method: "POST", body: {} }),
    );

  function exportCsv() {
    const qs = query().toString();
    const today = new Date().toISOString().slice(0, 10);
    void download(
      `/opportunities/export.csv${qs ? `?${qs}` : ""}`,
      `sales_pipeline_${today}.csv`,
    );
  }

  function onDrop(stageId: string) {
    setDragOver(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const opp = (opps || []).find((o) => String(o.opportunity_id) === id);
    if (!opp || String(opp.status) !== "OPEN") return;
    if (String(opp.pipeline_stage_id) === stageId) return;
    move(id, stageId);
  }

  const loading = stages === null || opps === null;
  const err = stErr || oppErr;

  /** Source · scope · originating reference — the legacy board's card subtitle. */
  function provenance(o: Row): string {
    const src = String(o.source || "MANUAL");
    const parts = [SOURCE_LABEL[src] ?? src.toLowerCase()];
    if (o.source_ref) parts.push(String(o.source_ref));
    return parts.join(" · ");
  }

  return (
    <section className="mx-auto max-w-[1400px] animate-fade-in">
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Opportunities"
        description="The sales pipeline — drag deals across stages; value × probability is the weighted forecast."
        action={
          <div className="flex items-center gap-3">
            <Segmented
              label="Opportunity layout"
              value={view}
              onChange={setView}
              options={[
                { value: "board", label: "Board" },
                { value: "list", label: "List" },
              ]}
            />
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={!(opps || []).length}
            >
              Export CSV
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              New opportunity
            </Button>
          </div>
        }
      />
      <HubTabs />

      {/* Forecast strip — computed in SQL over the whole filtered set, not over
          the page this component happens to be holding. Both win rates carry
          their denominator in the hint, so neither figure has to be trusted on
          faith. */}
      <KpiRow>
        <KpiTile
          label="Open pipeline"
          value={money(metrics?.pipeline_value ?? 0)}
          hint={`${metrics?.open_count ?? 0} open deals`}
        />
        <KpiTile
          label="Weighted forecast"
          value={money(metrics?.weighted_value ?? 0)}
          hint="value × probability"
          tone="info"
        />
        <KpiTile
          label="Won value"
          value={money(metrics?.won_value ?? 0)}
          hint={`${metrics?.won_count ?? 0} won`}
          tone="ok"
        />
        <KpiTile
          label="Win rate (settled)"
          value={pct(metrics?.win_rate_settled)}
          hint={`${metrics?.won_count ?? 0} won of ${metrics?.settled_count ?? 0} decided`}
          tone="ok"
        />
        <KpiTile
          label="Win rate (all deals)"
          value={pct(metrics?.win_rate_all_deals)}
          hint={`${metrics?.won_count ?? 0} won of ${metrics?.total_count ?? 0} total`}
        />
      </KpiRow>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-md">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a deal — name, source reference, scope…"
          />
        </div>
      </div>
      <div className="mb-4">
        <Chips
          label="Filter by source"
          value={sourceFilter}
          options={SOURCE_FILTERS}
          onChange={setSourceFilter}
        />
      </div>

      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {err ? (
        <ErrorState message={err} />
      ) : loading ? (
        <SkeletonTable />
      ) : (stages || []).length === 0 ? (
        <EmptyState
          title="No pipeline stages configured"
          hint="Add pipeline stages in Settings → Pipeline stages, then deals can flow across them."
        />
      ) : view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {(stages || []).map((s) => {
            const sid = String(s.pipeline_stage_id);
            // Group by stage across ALL opps (not just OPEN) so a won deal lands
            // in the Won column — filtering to OPEN left won/lost stages empty and
            // out of sync with the List view. Lost deals are dropped from the board.
            const cards = (opps || []).filter(
              (o) =>
                String(o.pipeline_stage_id) === sid &&
                String(o.status) !== "LOST",
            );
            const colValue = cards.reduce(
              (a, o) => a + (Number(o.estimated_value) || 0),
              0,
            );
            const won = s.is_won === true;
            const lost = s.is_lost === true;
            return (
              // Drop target for the pointer gesture. Every card carries a
              // "Move" menu that performs the same `move()` server-side, so the
              // board has a complete keyboard path and this is enhancement only.
              // eslint-disable-next-line jsx-a11y/no-static-element-interactions
              <div
                key={sid}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(sid);
                }}
                onDragLeave={() => setDragOver((d) => (d === sid ? null : d))}
                onDrop={() => onDrop(sid)}
                className={`flex w-72 shrink-0 flex-col rounded-xl border bg-muted/20 transition-colors ${dragOver === sid ? "border-primary/60 bg-primary/5" : ""}`}
              >
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${won ? "bg-ok-fill" : lost ? "bg-bad-fill" : "bg-primary"}`}
                    />
                    <span className="text-sm font-semibold text-foreground">
                      {cell(s.name)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {cards.length}
                    </span>
                    {/* The stage's own win probability — the number a deal
                        inherits when it lands here (legacy STAGE_CONFIG). */}
                    {s.default_probability != null && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {cell(s.default_probability)}%
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {money(colValue)}
                  </span>
                </div>
                <div className="flex min-h-[8rem] flex-1 flex-col gap-2 p-2">
                  {cards.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                      Drop deals here
                    </p>
                  ) : (
                    cards.map((o) => {
                      const id = String(o.opportunity_id);
                      const settled = String(o.status) !== "OPEN";
                      return (
                        // `draggable` is a pointer-only gesture. The "Move" menu
                        // below is its keyboard equivalent — same `move()` call,
                        // reachable by Tab + Enter + arrows. Without it the board
                        // was operable by mouse alone, which for the CRM's primary
                        // screen meant the pipeline could not be worked at all
                        // without one.
                        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                        <div
                          key={id}
                          draggable={!settled}
                          onDragStart={() => setDragId(id)}
                          onDragEnd={() => setDragId(null)}
                          className={`lux-card p-3 ${settled ? "" : "cursor-grab active:cursor-grabbing"} ${rowBusy === id ? "opacity-50" : ""}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-foreground">
                              {cell(o.name)}
                            </p>
                            {o.probability != null && (
                              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-ink">
                                {cell(o.probability)}%
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {withLabel(o)}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] uppercase tracking-wider text-muted-foreground">
                            {provenance(o)}
                          </p>
                          {o.scope_summary ? (
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {cell(o.scope_summary)}
                            </p>
                          ) : null}
                          <p className="mt-1 text-xs font-semibold text-foreground">
                            {money(o.estimated_value, o.currency)}
                          </p>
                          {settled ? (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              Settled — {cell(o.status)}
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                disabled={rowBusy === id}
                                onClick={() => setWinning(o)}
                              >
                                Win
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                disabled={rowBusy === id}
                                onClick={() => lose(id)}
                              >
                                Lose
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setEditing(o);
                                  setFormOpen(true);
                                }}
                              >
                                Edit
                              </Button>
                              {/* The keyboard path across the pipeline. Named per
                                  card so a screen-reader user hears which deal is
                                  being moved, not six identical "Move" buttons. */}
                              <DropdownMenu
                                label={`Move ${cell(o.name)} to stage`}
                                trigger={
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    disabled={rowBusy === id}
                                  >
                                    Move
                                  </Button>
                                }
                              >
                                {(stages || [])
                                  .filter(
                                    (t) => String(t.pipeline_stage_id) !== sid,
                                  )
                                  .map((t) => (
                                    <DropdownItem
                                      key={String(t.pipeline_stage_id)}
                                      onSelect={() =>
                                        move(id, String(t.pipeline_stage_id))
                                      }
                                    >
                                      {cell(t.name)}
                                    </DropdownItem>
                                  ))}
                              </DropdownMenu>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* List view */
        <div className="space-y-2">
          {(opps || []).length === 0 ? (
            <EmptyState
              title="No opportunities yet"
              hint="Create the first opportunity, or convert a qualified lead."
            />
          ) : (
            (opps || []).map((o) => {
              const id = String(o.opportunity_id);
              const settled = String(o.status) !== "OPEN";
              return (
                <div
                  key={id}
                  className="lux-card flex flex-wrap items-center gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {cell(o.name)}
                      </p>
                      <StatusPill status={String(o.status || "OPEN")} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {withLabel(o)} · {cell(o.stage_name)} ·{" "}
                      {o.probability != null ? `${cell(o.probability)}%` : "—"} ·{" "}
                      {provenance(o)}
                    </p>
                    {o.scope_summary ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {cell(o.scope_summary)}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {money(o.estimated_value, o.currency)}
                  </span>
                  {!settled && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={String(o.pipeline_stage_id ?? "")}
                        onChange={(e) => move(id, e.target.value)}
                        className="h-8 w-40 text-xs"
                        disabled={rowBusy === id}
                      >
                        {(stages || []).map((s) => (
                          <option
                            key={String(s.pipeline_stage_id)}
                            value={String(s.pipeline_stage_id)}
                          >
                            {cell(s.name)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rowBusy === id}
                        onClick={() => setWinning(o)}
                      >
                        Win
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={rowBusy === id}
                        onClick={() => lose(id)}
                      >
                        Lose
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(o);
                          setFormOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <AiActions actions={OPP_AI} />

      <OpportunityForm
        open={formOpen}
        editing={editing}
        stages={stages}
        leads={leads}
        clients={clients}
        onClose={() => setFormOpen(false)}
        onSaved={refreshAll}
      />
      <WinModal
        opp={winning}
        entities={entities}
        onClose={() => setWinning(null)}
        onDone={refreshAll}
      />
    </section>
  );
}
