/**
 * Sales & CRM — the opportunity pipeline: Kanban board, list view, win/lose.
 *
 * Split out of `features/sales/pages.tsx` in Phase 4 (audit F7).
 *
 * The board's drag-and-drop is a POINTER gesture. Every card also carries a
 * "Move" menu calling the same `/move` endpoint, because until Phase 4 added it
 * the CRM's primary screen could not be worked without a mouse at all.
 */

import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
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
import { Segmented } from "@/components/ui/segmented";
import { Stat } from "@/components/ui/stat";
import { DropdownMenu, DropdownItem } from "@/components/ui/dropdown-menu";
import { OpportunityForm, WinModal } from "./opportunity-forms";

/* ═══════════════════════════════ OPPORTUNITIES ═══════════════════════════════ */

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

export function OpportunitiesPage() {
  const reload = useRefresh();
  const { rows: stages, error: stErr } = useList("/opportunities/stages");
  const { rows: opps, error: oppErr } = useList("/opportunities");
  const { rows: leads } = useList("/leads");
  const { rows: clients } = useList("/clients");
  const { rows: entities } = useList("/entities");

  const [view, setView] = React.useState<"board" | "list">("board");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [winning, setWinning] = React.useState<Row | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);

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

  const openOpps = React.useMemo(
    () => (opps || []).filter((o) => String(o.status) === "OPEN"),
    [opps],
  );
  const forecast = React.useMemo(() => {
    const value = openOpps.reduce(
      (a, o) => a + (Number(o.estimated_value) || 0),
      0,
    );
    const weighted = openOpps.reduce(
      (a, o) =>
        a +
        ((Number(o.estimated_value) || 0) * (Number(o.probability) || 0)) / 100,
      0,
    );
    const won = (opps || []).filter((o) => String(o.status) === "WON").length;
    const lost = (opps || []).filter((o) => String(o.status) === "LOST").length;
    const winRate = won + lost ? Math.round((won / (won + lost)) * 100) : null;
    return {
      value,
      weighted: Math.round(weighted),
      open: openOpps.length,
      winRate,
    };
  }, [openOpps, opps]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await fn();
      reload();
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

  function onDrop(stageId: string) {
    setDragOver(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const opp = openOpps.find((o) => String(o.opportunity_id) === id);
    if (!opp || String(opp.pipeline_stage_id) === stageId) return;
    move(id, stageId);
  }

  const loading = stages === null || opps === null;
  const err = stErr || oppErr;

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

      {/* Forecast strip (Pixie "Today" metric row) */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open pipeline" value={money(forecast.value)} />
        <Stat
          label="Weighted forecast"
          value={money(forecast.weighted)}
          tone="accent"
        />
        <Stat label="Open deals" value={String(forecast.open)} />
        <Stat
          label="Win rate"
          value={forecast.winRate === null ? "—" : `${forecast.winRate}%`}
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
                          draggable
                          onDragStart={() => setDragId(id)}
                          onDragEnd={() => setDragId(null)}
                          className={`lux-card cursor-grab p-3 active:cursor-grabbing ${rowBusy === id ? "opacity-50" : ""}`}
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
                          <p className="mt-1 text-xs font-semibold text-foreground">
                            {money(o.estimated_value, o.currency)}
                          </p>
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
                      {o.probability != null ? `${cell(o.probability)}%` : "—"}
                    </p>
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
        onSaved={reload}
      />
      <WinModal
        opp={winning}
        entities={entities}
        onClose={() => setWinning(null)}
        onDone={reload}
      />
    </section>
  );
}
