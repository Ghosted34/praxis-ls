/**
 * Sales & CRM — Marketing campaigns, subscribers, senders and templates.
 *
 * Split out of `features/sales/pages.tsx` in Phase 4 (audit F7). This is the
 * largest of the six Sales screens because one campaign needs four supporting
 * records (subscriber list, sender identity, message template, send run), and
 * they are edited from here rather than from four more tabs.
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Callout } from "@/components/ui/callout";
import { Segmented } from "@/components/ui/segmented";
import { Avatar } from "@/components/ui/avatar";
import { Stat } from "@/components/ui/stat";
import { CampaignForm, SubscriberForm, TemplateForm, SendCampaignModal, CAMPAIGN_TEMPLATES, CAMPAIGN_SENDERS, senderLabel } from "./campaign-forms";

/* ═══════════════════════════════ MARKETING CAMPAIGNS ═══════════════════════════════ */

const CAMPAIGN_AI: AiAction[] = [
  { label: "Draft campaign copy", kind: "assist", describe: "Draft subject lines / body copy for a channel (human-reviewed before send)." },
  { label: "Summarise audience", kind: "read", describe: "Summarise the active newsletter audience and recent growth." },
];

const CAMPAIGN_ACTIONS: Record<string, { to: string; label: string }[]> = {
  DRAFT: [{ to: "ACTIVE", label: "Activate" }],
  ACTIVE: [{ to: "PAUSED", label: "Pause" }, { to: "ENDED", label: "End" }],
  PAUSED: [{ to: "ACTIVE", label: "Resume" }, { to: "ENDED", label: "End" }],
  ENDED: [],
};

export function CampaignsPage() {
  const [tab, setTab] = React.useState<"campaigns" | "subscribers" | "templates">("campaigns");
  const reload = useRefresh();
  const { rows: campaigns, error } = useList("/campaigns");
  const { rows: subscribers } = useList("/campaigns/subscribers");
  const { rows: templates } = useList(CAMPAIGN_TEMPLATES);
  const { rows: senders } = useList(CAMPAIGN_SENDERS);
  const [formOpen, setFormOpen] = React.useState(false);
  const [subOpen, setSubOpen] = React.useState(false);
  const [tplEditing, setTplEditing] = React.useState<Row | null>(null);
  const [tplOpen, setTplOpen] = React.useState(false);
  const [sendFor, setSendFor] = React.useState<Row | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

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
  const transition = (id: string, to: string) => act(id, () => tenant(`/campaigns/${id}/transition`, { method: "POST", body: { to } }));
  const unsubscribe = (email: string) => act(email, () => tenant("/campaigns/subscribers/unsubscribe", { method: "POST", body: { email } }));
  const deleteTemplate = (id: string) => act(id, () => tenant(`${CAMPAIGN_TEMPLATES}/${id}`, { method: "DELETE" }));
  const openTemplate = (t: Row | null) => {
    setTplEditing(t);
    setTplOpen(true);
  };
  const senderName = React.useMemo(() => new Map((senders || []).map((s) => [String(s.sender_id), senderLabel(s)])), [senders]);

  const counts = React.useMemo(() => {
    const cs = campaigns || [];
    return {
      active: cs.filter((c) => String(c.status) === "ACTIVE").length,
      draft: cs.filter((c) => String(c.status) === "DRAFT").length,
      ended: cs.filter((c) => String(c.status) === "ENDED").length,
    };
  }, [campaigns]);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Marketing campaigns"
        description="Outbound campaigns and the newsletter audience — launch, pause, measure."
        action={(
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
            <Button onClick={() => setFormOpen(true)}>New campaign</Button>
          ) : tab === "subscribers" ? (
            <Button onClick={() => setSubOpen(true)}>Add subscriber</Button>
          ) : (
            <Button onClick={() => openTemplate(null)}>New template</Button>
          )}
        </div>
        )}
      />
      <HubTabs />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active" value={String(counts.active)} tone="accent" />
        <Stat label="Draft" value={String(counts.draft)} />
        <Stat label="Ended" value={String(counts.ended)} />
        <Stat label="Subscribers" value={subscribers === null ? "…" : String(subscribers.length)} />
      </div>

      {notice && (
        <Callout tone="ok" className="mb-3">{notice}</Callout>
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
          <EmptyState title="No campaigns yet" hint="Create your first campaign to reach the newsletter audience." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((c) => {
              const id = String(c.campaign_id);
              const status = String(c.status || "DRAFT");
              const actions = CAMPAIGN_ACTIONS[status] || [];
              return (
                <div key={id} className="lux-card flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{cell(c.name)}</p>
                    <StatusPill status={status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{cell(c.channel)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.starts_on || c.ends_on ? `${dateFmt(c.starts_on)} → ${dateFmt(c.ends_on)}` : "No dates set"}
                  </p>
                  {actions.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      {actions.map((a, i) => (
                        <Button key={a.to} size="sm" variant={i === 0 ? "outline" : "ghost"} loading={rowBusy === id} onClick={() => transition(id, a.to)}>
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                  {status !== "ENDED" && (
                    <div className="mt-2">
                      <Button size="sm" variant="ghost" onClick={() => setSendFor(c)}>
                        Send…
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : tab === "subscribers" ? (
        subscribers === null ? (
          <SkeletonTable />
        ) : subscribers.length === 0 ? (
          <EmptyState title="No subscribers yet" hint="Add subscribers, or they arrive via the public newsletter form." />
      ) : (
        <div className="space-y-2">
          {subscribers.map((s) => {
            const email = String(s.email);
            return (
              <div key={email} className="lux-card flex items-center gap-3 p-3">
                <Avatar name={String(s.name || s.email || "?")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{cell(s.name) === "—" ? email : cell(s.name)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {cell(s.name) === "—" ? cell(s.source) : `${email} · ${cell(s.source)}`} · {dateFmt(s.subscribed_at)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" loading={rowBusy === email} onClick={() => unsubscribe(email)}>
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
        <EmptyState title="No email templates yet" hint="Create a reusable campaign email — each carries its own sender name and address." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(templates || []).map((t) => {
            const id = String(t.template_id);
            return (
              <div key={id} className="lux-card flex flex-col p-4">
                <p className="text-sm font-semibold text-foreground">{cell(t.name)}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{cell(t.subject)}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  From: {t.from_sender_id ? senderName.get(String(t.from_sender_id)) ?? "—" : "No sender"}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openTemplate(t)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" loading={rowBusy === id} onClick={() => deleteTemplate(id)}>
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AiActions actions={CAMPAIGN_AI} />

      <CampaignForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} />
      <SubscriberForm open={subOpen} onClose={() => setSubOpen(false)} onSaved={reload} />
      <TemplateForm open={tplOpen} editing={tplEditing} senders={senders} onClose={() => setTplOpen(false)} onSaved={reload} onReloadSenders={reload} />
      <SendCampaignModal
        campaign={sendFor}
        templates={templates}
        onClose={() => setSendFor(null)}
        onSent={(queued) => {
          setNotice(`Queued to ${queued} subscriber${queued === 1 ? "" : "s"}.`);
          reload();
        }}
      />
    </section>
  );
}
