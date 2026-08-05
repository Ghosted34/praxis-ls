/**
 * Sales & CRM — Proposals: the line/narrative editor and the detail drawer.
 *
 * Split out of `features/sales/pages.tsx` in Phase 4 (audit F7).
 */

import { pageShell } from "@/lib/layout";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, dateFmt } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { ProposalForm } from "./proposal-forms";
import { ProposalDetail } from "./proposal-detail";

/* ═══════════════════════════════════ PROPOSALS ═══════════════════════════════════ */

const PROPOSAL_AI: AiAction[] = [
  { label: "Draft proposal", kind: "assist", describe: "Draft a proposal — narrative sections + line items — from an opportunity or brief (human-reviewed before send)." },
  { label: "Tighten narrative", kind: "assist", describe: "Rewrite a proposal's narrative sections for clarity and tone." },
  { label: "Send / accept", kind: "write", describe: "Submit, send, reject or accept a proposal (optionally spin a quotation)." },
];

const PROPOSAL_FILTERS = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "IN_REVIEW", label: "In review" },
  { value: "SENT", label: "Sent" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "REJECTED", label: "Rejected" },
];

export function ProposalsPage() {
  const reload = useRefresh();
  const { rows, error } = useList("/proposals");
  const { rows: leads } = useList("/leads");
  const { rows: clients } = useList("/clients");
  const { rows: opportunities } = useList("/opportunities");
  const { rows: entities } = useList("/entities");
  const [filter, setFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [detail, setDetail] = React.useState<Row | null>(null);

  const clientName = React.useMemo(() => new Map((clients || []).map((c) => [String(c.client_id), cell(c.name ?? c.legal_name)])), [clients]);
  const leadName = React.useMemo(() => new Map((leads || []).map((l) => [String(l.lead_id), cell(l.company_name)])), [leads]);
  function withLabel(p: Row): string {
    if (p.client_id) return clientName.get(String(p.client_id)) ?? "Client";
    if (p.lead_id) return leadName.get(String(p.lead_id)) ?? "Lead";
    return "—";
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (filter && String(r.status) !== filter) return false;
      if (!q) return true;
      return String(r.title ?? "").toLowerCase().includes(q);
    });
  }, [rows, filter, search]);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Proposals"
        description="Formal proposals with narrative + line items — drafted, reviewed, sent, then accepted."
        action={<Button onClick={() => { setEditing(null); setFormOpen(true); }}>New proposal</Button>}
      />
      <HubTabs />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Chips label="Filter proposals by status" value={filter} options={PROPOSAL_FILTERS} onChange={setFilter} />
        <div className="w-full sm:max-w-xs">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search proposals…" />
        </div>
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length ? "No proposals match" : "No proposals yet"} hint={rows.length ? "Try another filter." : "Draft your first proposal, or generate one with AI from an opportunity."} />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <button key={String(r.proposal_id)} type="button" onClick={() => setDetail(r)} className="lux-card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-primary/40">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{cell(r.title)}</p>
                  <StatusPill status={String(r.status || "DRAFT")} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {withLabel(r)}
                  {r.doc_number ? ` · № ${cell(r.doc_number)}` : ""} · {dateFmt(r.created_at)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <AiActions actions={PROPOSAL_AI} />

      <ProposalForm
        open={formOpen}
        editing={editing}
        leads={leads}
        clients={clients}
        opportunities={opportunities}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
      />
      <ProposalDetail
        proposal={detail}
        entities={entities}
        onClose={() => setDetail(null)}
        onChanged={reload}
        onEdit={(p) => {
          setDetail(null);
          setEditing(p);
          setFormOpen(true);
        }}
      />
    </section>
  );
}
