/**
 * Sales & CRM — Leads, and the inbound intake feed that supplies them.
 *
 * Split out of `features/sales/pages.tsx` (2,596 lines) in Phase 4, audit F7.
 *
 * Intake is a TAB here rather than a screen of its own: the leads list is the
 * funnel and inbound enquiries/partnerships are its raw feed, so triage flows
 * straight from one into the other. `/sales/inbound-intake` redirects to
 * `?tab=intake`.
 *
 * NOTE: the API prefix moved /inbound → /intake on 2026-08-04 (audit API F-6),
 * because wms/inbound already owned /inbound.
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { ComposeIconButton } from "@/features/comms/mail";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { errMsg, useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Chips } from "@/components/ui/chips";
import { Avatar } from "@/components/ui/avatar";
import { LeadForm, ConvertModal, TriageModal, ReviewModal } from "./lead-forms";

/* ═══════════════════════════════════ LEADS ═══════════════════════════════════ */

const LEADS_AI: AiAction[] = [
  { label: "Triage inbound enquiry", kind: "assist", describe: "Triage an enquiry into a qualified lead (optionally converting it)." },
  { label: "Suggest next action", kind: "assist", describe: "Suggest the next best action for a stale lead based on its history." },
  { label: "Draft outreach", kind: "write", describe: "Draft a first-contact email for a new lead (human-confirmed before send)." },
];

const LEAD_FILTERS = [
  { value: "", label: "All leads" },
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "QUALIFIED", label: "Qualified" },
  { value: "CONVERTED", label: "Converted" },
  { value: "LOST", label: "Lost" },
];
const NEXT_STATUS: Record<string, string> = { NEW: "CONTACTED", CONTACTED: "QUALIFIED" };

function LeadsTab() {
  const reload = useRefresh();
  const { rows, error } = useList("/leads");
  const [filter, setFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [converting, setConverting] = React.useState<Row | null>(null);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  async function transition(id: string, to: string) {
    setRowBusy(id);
    setRowError(null);
    try {
      await tenant(`/leads/${id}/transition`, { method: "POST", body: { to } });
      reload();
    } catch (e) {
      setRowError(errMsg(e));
    } finally {
      setRowBusy(null);
    }
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (filter && String(r.status) !== filter) return false;
      if (!q) return true;
      return [r.company_name, r.contact_name, r.email].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a lead — company, contact, email…" />
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Capture lead
        </Button>
      </div>
      <Chips label="Filter leads by status" value={filter} options={LEAD_FILTERS} onChange={setFilter} />

      {rowError && <ErrorState message={rowError} />}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? "No leads match" : "No leads yet"} hint={rows.length ? "Try a different filter or search." : "Capture your first lead, or triage an inbound enquiry into one."} />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const id = String(r.lead_id);
            const status = String(r.status || "NEW");
            const next = NEXT_STATUS[status];
            const terminal = status === "CONVERTED" || status === "LOST";
            return (
              <div key={id} className="lux-card flex items-center gap-3 p-3">
                <Avatar name={String(r.company_name || "?")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{cell(r.company_name)}</p>
                    <StatusPill status={status} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[cell(r.contact_name), cell(r.email)].filter((x) => x !== "—").join(" · ") || "No contact details"}
                    {r.service_interest ? ` · ${cell(r.service_interest)}` : ""}
                  </p>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:block">{cell(r.source).toLowerCase()}</span>
                <ComposeIconButton to={String(r.email ?? "") || undefined} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" />
                {!terminal && (
                  <div className="flex gap-2">
                    {status === "QUALIFIED" ? (
                      <Button size="sm" onClick={() => setConverting(r)}>
                        Convert
                      </Button>
                    ) : next ? (
                      <Button size="sm" variant="outline" loading={rowBusy === id} onClick={() => transition(id, next)}>
                        {next === "CONTACTED" ? "Mark contacted" : "Qualify"}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" disabled={rowBusy === id} onClick={() => transition(id, "LOST")}>
                      Lost
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <LeadForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={reload} />
      <ConvertModal lead={converting} onClose={() => setConverting(null)} onDone={reload} />
    </div>
  );
}

/* ═══════════════════════════════ INBOUND INTAKE ═══════════════════════════════ */

function IntakeTab() {
  const [sub, setSub] = React.useState<"enquiries" | "partnerships">("enquiries");
  const reload = useRefresh();
  const { rows: enquiries, error: enqErr } = useList(sub === "enquiries" ? "/intake/enquiries" : null);
  const { rows: partnerships, error: partErr } = useList(sub === "partnerships" ? "/intake/partnerships" : null);
  const [triaging, setTriaging] = React.useState<Row | null>(null);
  const [reviewing, setReviewing] = React.useState<Row | null>(null);

  return (
    <div className="space-y-4">
      <Segmented
        label="Inbound intake type"
        value={sub}
        onChange={setSub}
        options={[
          { value: "enquiries", label: "Enquiries" },
          { value: "partnerships", label: "Partnership requests" },
        ]}
      />

      {sub === "enquiries" ? (
        enqErr ? (
          <ErrorState message={enqErr} />
        ) : enquiries === null ? (
          <SkeletonTable />
        ) : enquiries.length === 0 ? (
          <EmptyState title="No enquiries" hint="Contact-form and email enquiries land here for triage into leads." />
        ) : (
          <div className="space-y-2">
            {enquiries.map((r) => {
              const done = String(r.status) === "TRIAGED" || String(r.status) === "CLOSED";
              return (
                <div key={String(r.contact_enquiry_id)} className="lux-card flex items-center gap-3 p-3">
                  <Avatar name={String(r.name || r.email || "?")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-foreground">{cell(r.subject) === "—" ? "(no subject)" : cell(r.subject)}</p>
                      <StatusPill status={String(r.status || "NEW")} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[cell(r.name), cell(r.email)].filter((x) => x !== "—").join(" · ") || "Anonymous"} · {cell(r.source).toLowerCase()} · {dateFmt(r.created_at)}
                    </p>
                  </div>
                  {!done && (
                    <Button size="sm" variant="outline" onClick={() => setTriaging(r)}>
                      Triage
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : partErr ? (
        <ErrorState message={partErr} />
      ) : partnerships === null ? (
        <SkeletonTable />
      ) : partnerships.length === 0 ? (
        <EmptyState title="No partnership requests" hint="Inbound partnership proposals land here for review." />
      ) : (
        <div className="space-y-2">
          {partnerships.map((r) => (
            <div key={String(r.partnership_request_id)} className="lux-card flex items-center gap-3 p-3">
              <Avatar name={String(r.company_name || "?")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{cell(r.company_name)}</p>
                  <StatusPill status={String(r.status || "NEW")} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[cell(r.contact_name), cell(r.email)].filter((x) => x !== "—").join(" · ") || "—"} · {dateFmt(r.created_at)}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setReviewing(r)}>
                Review
              </Button>
            </div>
          ))}
        </div>
      )}

      <TriageModal enquiry={triaging} onClose={() => setTriaging(null)} onDone={reload} />
      <ReviewModal partnership={reviewing} onClose={() => setReviewing(null)} onDone={reload} />
    </div>
  );
}

/* ─────────────────────────────── Leads page (tabbed) ─────────────────────────────── */

export function LeadsPage() {
  const initialTab = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "intake" ? "intake" : "leads";
  const [tab, setTab] = React.useState<"leads" | "intake">(initialTab as "leads" | "intake");

  return (
    <section className={pageShell.wide}>
      <PageHeader eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />} title="Leads & intake" description="The top of the sales funnel — capture and qualify leads, and triage inbound enquiries into them." />
      <HubTabs />

      <div className="mb-5">
        <Segmented
          label="Lead pipeline section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "leads", label: "Leads" },
            { value: "intake", label: "Inbound intake" },
          ]}
        />
      </div>

      {tab === "leads" ? <LeadsTab /> : <IntakeTab />}

      <AiActions actions={LEADS_AI} />
    </section>
  );
}
