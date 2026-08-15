/**
 * Sales & CRM — Marketing campaigns (F8), subscribers, senders and templates.
 *
 * doc/SALES_CRM_FEATURES.md#F8. The campaign register answers one question —
 * what did we spend and what did we get — and this screen is built so that both
 * halves of the answer are visibly what they are.
 *
 * THE FOUR TILES ARE FILTERED SUMS, NOT A PARTITION. Unlike the quote-request
 * register, whose tiles must add up to the row count, these are sums of money
 * and of hand-entered counts over whatever the filters select. Filtering by
 * status therefore narrows the tiles too — "total budget of the ACTIVE
 * campaigns" is a real question — where on the intake register the same thing
 * would be a tautology.
 *
 * THE FIRST TILE SAYS "BUDGET", NOT "SPEND". The legacy labels the identical
 * SUM(budget_amount) "Total Spend (Q1)". Nothing in this system knows what was
 * actually disbursed against a campaign, so the label states what the number
 * is: money planned.
 *
 * PERFORMANCE FIGURES ARE HAND-ENTERED AND THE SCREEN SAYS SO. Not as a
 * footnote — the notice sits under the tiles it qualifies, each card shows when
 * its figures were last typed, and a card nobody has updated says so rather
 * than showing a confident zero.
 *
 * Split out of `features/sales/pages.tsx` in Phase 4 (audit F7). This is the
 * largest of the Sales screens because one campaign needs four supporting
 * records (subscriber list, sender identity, message template, send run), and
 * they are edited from here rather than from four more tabs.
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant, download } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt, money, money0 } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Chips } from "@/components/ui/chips";
import { Segmented } from "@/components/ui/segmented";
import { Avatar } from "@/components/ui/avatar";
import { Stat } from "@/components/ui/stat";
import {
  CampaignForm,
  ActualsForm,
  RejectCampaignModal,
  SubscriberForm,
  TemplateForm,
  SendCampaignModal,
  CAMPAIGN_TEMPLATES,
  CAMPAIGN_SENDERS,
  PLATFORMS,
  platformLabel,
  senderLabel,
} from "./campaign-forms";

/* ═══════════════════════════════ MARKETING CAMPAIGNS ═══════════════════════════════ */

const CAMPAIGN_AI: AiAction[] = [
  {
    label: "Draft campaign copy",
    kind: "assist",
    describe:
      "Draft subject lines / body copy for a channel (human-reviewed before send).",
  },
  {
    label: "Record this week's figures",
    kind: "write",
    describe:
      "Type the leads, opportunities and wins from an ad-manager report onto a running campaign (human-confirmed before it writes).",
  },
  {
    label: "Summarise audience",
    kind: "read",
    describe: "Summarise the active newsletter audience and recent growth.",
  },
];

/**
 * Row actions by status.
 *
 * Note what DRAFT does not offer: "Activate". Going live without approval is
 * the control F8 adds, and the API refuses DRAFT -> ACTIVE outright, so
 * offering the button would only produce a 422. Approve and reject are not here
 * either — they are separate endpoints with their own permission, so they are
 * separate buttons.
 */
const CAMPAIGN_ACTIONS: Record<string, { to: string; label: string }[]> = {
  DRAFT: [{ to: "PENDING_APPROVAL", label: "Submit for approval" }],
  PENDING_APPROVAL: [],
  ACTIVE: [
    { to: "PAUSED", label: "Pause" },
    { to: "ENDED", label: "End" },
  ],
  PAUSED: [
    { to: "ACTIVE", label: "Resume" },
    { to: "ENDED", label: "End" },
  ],
  ENDED: [],
};

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING_APPROVAL", label: "Awaiting approval" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "ENDED", label: "Ended" },
];

const PLATFORM_FILTERS = [{ value: "", label: "All platforms" }].concat(
  PLATFORMS.map((p) => ({ value: p.value, label: p.label })),
);

type Kpi = {
  TOTAL_BUDGET: number;
  LEADS: number;
  WON: number;
  AVG_CONVERSION: number;
  CAMPAIGNS: number;
};

const EMPTY_KPI: Kpi = {
  TOTAL_BUDGET: 0,
  LEADS: 0,
  WON: 0,
  AVG_CONVERSION: 0,
  CAMPAIGNS: 0,
};

/** Plan figure over recorded figure, e.g. "43 / 60". The plan is the quieter
 *  half deliberately: what happened is the answer, what was hoped for is the
 *  context. */
function TargetPair({
  label,
  actual,
  target,
}: {
  label: string;
  actual: unknown;
  target: unknown;
}) {
  return (
    <div>
      <p className="text-micro uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="num text-sm font-semibold text-foreground">
        {Number(actual ?? 0)}
        <span className="font-normal text-muted-foreground">
          {" / "}
          {Number(target ?? 0)}
        </span>
      </p>
    </div>
  );
}

export function CampaignsPage() {
  const [tab, setTab] = React.useState<
    "campaigns" | "subscribers" | "templates"
  >("campaigns");
  const reload = useRefresh();
  const [statusFilter, setStatusFilter] = React.useState("");
  const [platformFilter, setPlatformFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [data, setData] = React.useState<{
    rows: Row[];
    total: number;
    kpi: Kpi;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { rows: subscribers } = useList("/campaigns/subscribers");
  const { rows: templates } = useList(CAMPAIGN_TEMPLATES);
  const { rows: senders } = useList(CAMPAIGN_SENDERS);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [actualsFor, setActualsFor] = React.useState<Row | null>(null);
  const [rejecting, setRejecting] = React.useState<Row | null>(null);
  const [subOpen, setSubOpen] = React.useState(false);
  const [tplEditing, setTplEditing] = React.useState<Row | null>(null);
  const [tplOpen, setTplOpen] = React.useState(false);
  const [sendFor, setSendFor] = React.useState<Row | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const query = React.useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (platformFilter) params.set("platform", platformFilter);
    if (search.trim()) params.set("q", search.trim());
    return params.toString();
  }, [statusFilter, platformFilter, search]);

  const loadCampaigns = React.useCallback(async () => {
    setError(null);
    try {
      const qs = query();
      const out = await tenant<any>(`/campaigns${qs ? `?${qs}` : ""}`);
      // The register returns { rows, total, kpi } directly; some endpoints in
      // this codebase wrap in { data }. Tolerate both rather than depending on
      // which shape this one happens to use today.
      const payload = out && typeof out === "object" && "rows" in out ? out : out?.data;
      setData({
        rows: payload?.rows || [],
        total: payload?.total || 0,
        kpi: { ...EMPTY_KPI, ...(payload?.kpi || {}) },
      });
    } catch (e) {
      setError(errMsg(e));
    }
  }, [query]);

  React.useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const reloadAll = React.useCallback(() => {
    void loadCampaigns();
    reload();
  }, [loadCampaigns, reload]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setRowBusy(id);
    setRowError(null);
    try {
      await fn();
      reloadAll();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }
  const transition = (id: string, to: string) =>
    act(id, () =>
      tenant(`/campaigns/${id}/transition`, { method: "POST", body: { to } }),
    );
  const approve = (id: string) =>
    act(id, () => tenant(`/campaigns/${id}/approve`, { method: "POST" }));
  const unsubscribe = (email: string) =>
    act(email, () =>
      tenant("/campaigns/subscribers/unsubscribe", {
        method: "POST",
        body: { email },
      }),
    );
  const deleteTemplate = (id: string) =>
    act(id, () => tenant(`${CAMPAIGN_TEMPLATES}/${id}`, { method: "DELETE" }));
  const openTemplate = (t: Row | null) => {
    setTplEditing(t);
    setTplOpen(true);
  };
  function exportCsv() {
    const qs = query();
    const today = new Date().toISOString().slice(0, 10);
    void download(
      `/campaigns/export.csv${qs ? `?${qs}` : ""}`,
      `campaigns_${today}.csv`,
    );
  }

  const senderName = React.useMemo(
    () =>
      new Map(
        (senders || []).map((s) => [String(s.sender_id), senderLabel(s)]),
      ),
    [senders],
  );

  const campaigns = data?.rows ?? null;
  const kpi = data?.kpi ?? EMPTY_KPI;

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Marketing campaigns"
        description="What each campaign was budgeted to do and what it actually returned — plus the newsletter audience it sends to."
        action={
          <div className="flex items-center gap-3">
            <Segmented
              label="Campaign section"
              value={tab}
              onChange={setTab}
              options={[
                { value: "campaigns", label: "Campaigns" },
                { value: "subscribers", label: "Subscribers" },
                { value: "templates", label: "Templates" },
              ]}
            />
            {tab === "campaigns" ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                New campaign
              </Button>
            ) : tab === "subscribers" ? (
              <Button onClick={() => setSubOpen(true)}>Add subscriber</Button>
            ) : (
              <Button onClick={() => openTemplate(null)}>New template</Button>
            )}
          </div>
        }
      />
      <HubTabs />

      {tab === "campaigns" ? (
        <>
          {/* Sums over the filtered set, not a partition of it — see the file
              header. The first tile is BUDGET: this system does not know what
              was disbursed, so it does not claim to. */}
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Total budget"
              value={money0(kpi.TOTAL_BUDGET)}
              hint={`${kpi.CAMPAIGNS} campaign${kpi.CAMPAIGNS === 1 ? "" : "s"}`}
              tone="accent"
            />
            <Stat label="Leads generated" value={String(kpi.LEADS)} hint="Hand-entered" />
            <Stat label="Deals won" value={String(kpi.WON)} hint="Hand-entered" />
            <Stat
              label="Avg. conversion"
              value={`${kpi.AVG_CONVERSION}%`}
              hint="Wins ÷ leads"
            />
          </div>

          {/* The legacy screen prints this notice and it is the most honest
              thing on it. Reproduced here, under the tiles it qualifies. */}
          <div className="mb-5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Performance figures are entered by hand.
            </span>{" "}
            Nothing links a lead or a won deal back to the campaign that produced
            it, so leads, opportunities and wins are typed in from your ad
            manager's reports — update them weekly. Budget is what was approved,
            not what has been disbursed.
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-md">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a campaign — name, owner, remarks…"
              />
            </div>
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={!campaigns || campaigns.length === 0}
            >
              Export CSV
            </Button>
          </div>

          <div className="mb-4 space-y-3">
            <Chips
              label="Filter by status"
              value={statusFilter}
              options={STATUS_FILTERS}
              onChange={setStatusFilter}
            />
            <Chips
              label="Filter by platform"
              value={platformFilter}
              options={PLATFORM_FILTERS}
              onChange={setPlatformFilter}
            />
          </div>
        </>
      ) : null}

      {notice && (
        <Callout tone="ok" className="mb-3">
          {notice}
        </Callout>
      )}
      {rowError && (
        <div className="mb-3">
          <ErrorState message={rowError} />
        </div>
      )}

      {tab === "campaigns" ? (
        error ? (
          <ErrorState message={error} />
        ) : campaigns === null ? (
          <SkeletonTable />
        ) : campaigns.length === 0 ? (
          <EmptyState
            title="No campaigns match"
            hint="Create a campaign, or clear the filters to see the whole register."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {campaigns.map((c) => {
              const id = String(c.campaign_id);
              const status = String(c.status || "DRAFT");
              const actions = CAMPAIGN_ACTIONS[status] || [];
              const pending = status === "PENDING_APPROVAL";
              const canRecord =
                status === "ACTIVE" || status === "PAUSED" || status === "ENDED";
              return (
                <div key={id} className="lux-card flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {cell(c.name)}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {platformLabel(c.platform)}
                        {c.owner_name ? ` · ${cell(c.owner_name)}` : ""}
                        {c.target_service && String(c.target_service) !== "ALL"
                          ? ` · ${cell(c.target_service)}`
                          : ""}
                      </p>
                    </div>
                    <StatusPill status={status} />
                  </div>

                  {/* A rejection the planner has not yet acted on. Shown on the
                      card, not only inside the drawer: the legacy hides it in
                      the drawer, so a sent-back campaign looks like an ordinary
                      draft in the register. */}
                  {c.rejection_reason && status === "DRAFT" ? (
                    <div className="mt-2 rounded-md border border-bad/30 bg-bad-fill/8 px-2.5 py-1.5 text-xs text-foreground">
                      <span className="font-medium">Sent back:</span>{" "}
                      {cell(c.rejection_reason)}
                    </div>
                  ) : null}

                  <p className="num mt-3 text-lg font-semibold text-foreground">
                    {money(c.budget_amount, c.budget_currency ?? "XAF")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.starts_on || c.ends_on
                      ? `${dateFmt(c.starts_on)} → ${c.ends_on ? dateFmt(c.ends_on) : "ongoing"}`
                      : "No dates set"}
                  </p>

                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
                    <TargetPair label="Leads" actual={c.actual_leads} target={c.target_leads} />
                    <TargetPair label="Opps" actual={c.actual_opportunities} target={c.target_opportunities} />
                    <TargetPair label="Won" actual={c.actual_won} target={c.target_won} />
                  </div>
                  <p className="mt-2 text-micro text-muted-foreground">
                    CPL{" "}
                    <span className="num text-foreground">
                      {c.cost_per_lead == null ? "—" : money0(Number(c.cost_per_lead))}
                    </span>{" "}
                    ·{" "}
                    {c.actuals_updated_at
                      ? `figures as of ${dateFmt(c.actuals_updated_at)}`
                      : "figures never updated"}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {pending ? (
                      <>
                        <Button
                          size="sm"
                          loading={rowBusy === id}
                          onClick={() => approve(id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rowBusy === id}
                          onClick={() => setRejecting(c)}
                        >
                          Send back…
                        </Button>
                      </>
                    ) : (
                      actions.map((a, i) => (
                        <Button
                          key={a.to}
                          size="sm"
                          variant={i === 0 ? "outline" : "ghost"}
                          loading={rowBusy === id}
                          onClick={() => transition(id, a.to)}
                        >
                          {a.label}
                        </Button>
                      ))
                    )}
                    {canRecord && (
                      <Button
                        size="sm"
                        variant={status === "ENDED" ? "outline" : "default"}
                        disabled={rowBusy === id}
                        onClick={() => setActualsFor(c)}
                      >
                        {status === "ENDED" ? "Amend figures" : "Record figures"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={rowBusy === id}
                      onClick={() => {
                        setEditing(c);
                        setFormOpen(true);
                      }}
                    >
                      {status === "DRAFT" || pending ? "Edit plan" : "View plan"}
                    </Button>
                    {status !== "ENDED" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSendFor(c)}
                      >
                        Send…
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : tab === "subscribers" ? (
        subscribers === null ? (
          <SkeletonTable />
        ) : subscribers.length === 0 ? (
          <EmptyState
            title="No subscribers yet"
            hint="Add subscribers, or they arrive via the public newsletter form."
          />
        ) : (
          <div className="space-y-2">
            {subscribers.map((s) => {
              const email = String(s.email);
              return (
                <div
                  key={email}
                  className="lux-card flex items-center gap-3 p-3"
                >
                  <Avatar name={String(s.name || s.email || "?")} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {cell(s.name) === "—" ? email : cell(s.name)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {cell(s.name) === "—"
                        ? cell(s.source)
                        : `${email} · ${cell(s.source)}`}{" "}
                      · {dateFmt(s.subscribed_at)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={rowBusy === email}
                    onClick={() => unsubscribe(email)}
                  >
                    Unsubscribe
                  </Button>
                </div>
              );
            })}
          </div>
        )
      ) : templates === null ? (
        <SkeletonTable />
      ) : (templates || []).length === 0 ? (
        <EmptyState
          title="No email templates yet"
          hint="Create a reusable campaign email — each carries its own sender name and address."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(templates || []).map((t) => {
            const id = String(t.template_id);
            return (
              <div key={id} className="lux-card flex flex-col p-4">
                <p className="text-sm font-semibold text-foreground">
                  {cell(t.name)}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {cell(t.subject)}
                </p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  From:{" "}
                  {t.from_sender_id
                    ? (senderName.get(String(t.from_sender_id)) ?? "—")
                    : "No sender"}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openTemplate(t)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={rowBusy === id}
                    onClick={() => deleteTemplate(id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AiActions actions={CAMPAIGN_AI} />

      <CampaignForm
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={reloadAll}
      />
      <ActualsForm
        campaign={actualsFor}
        onClose={() => setActualsFor(null)}
        onSaved={reloadAll}
      />
      <RejectCampaignModal
        campaign={rejecting}
        onClose={() => setRejecting(null)}
        onRejected={reloadAll}
      />
      <SubscriberForm
        open={subOpen}
        onClose={() => setSubOpen(false)}
        onSaved={reloadAll}
      />
      <TemplateForm
        open={tplOpen}
        editing={tplEditing}
        senders={senders}
        onClose={() => setTplOpen(false)}
        onSaved={reloadAll}
        onReloadSenders={reload}
      />
      <SendCampaignModal
        campaign={sendFor}
        templates={templates}
        onClose={() => setSendFor(null)}
        onSent={(queued) => {
          setNotice(
            `Queued to ${queued} subscriber${queued === 1 ? "" : "s"}.`,
          );
          reloadAll();
        }}
      />
    </section>
  );
}
