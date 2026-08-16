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
import { cell } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Chips } from "@/components/ui/chips";
import { Avatar } from "@/components/ui/avatar";
import { Link } from "react-router-dom";
import { LeadForm, ConvertModal } from "./lead-forms";
import { LeadDossier } from "./sales-360";

/* ═══════════════════════════════════ LEADS ═══════════════════════════════════ */

const LEADS_AI: AiAction[] = [
  {
    label: "Triage inbound enquiry",
    kind: "assist",
    describe:
      "Triage an enquiry into a qualified lead (optionally converting it).",
  },
  {
    label: "Suggest next action",
    kind: "assist",
    describe:
      "Suggest the next best action for a stale lead based on its history.",
  },
  {
    label: "Draft outreach",
    kind: "write",
    describe:
      "Draft a first-contact email for a new lead (human-confirmed before send).",
  },
];

const LEAD_FILTERS = [
  { value: "", label: "All leads" },
  { value: "NEW", label: "New" },
  { value: "CONTACTED", label: "Contacted" },
  { value: "QUALIFIED", label: "Qualified" },
  { value: "CONVERTED", label: "Converted" },
  { value: "LOST", label: "Lost" },
];
const NEXT_STATUS: Record<string, string> = {
  NEW: "CONTACTED",
  CONTACTED: "QUALIFIED",
};

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
  /**
   * The lead whose 360 is open, shown in place of the list.
   *
   * In place, rather than the SplitPane suppliers.tsx uses: this register is a
   * card list, not a narrow index, and a 280px pane would crush it. The dossier
   * is also its own route (`/sales/leads/:leadId`), so it can be linked to from
   * outside the app — the two surfaces render the SAME component, so neither
   * can drift from the other.
   */
  const [openLead, setOpenLead] = React.useState<Row | null>(null);

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
      return [r.company_name, r.contact_name, r.email].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [rows, filter, search]);

  // The 360, in place of the register. Kept as an early return rather than a
  // branch inside the layout below so the list markup stays one thing.
  if (openLead) {
    const id = String(openLead.lead_id);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOpenLead(null)}
            className="micro text-muted-foreground hover:text-foreground"
          >
            ← All leads
          </button>
          <Link to={`/sales/leads/${id}`} className="micro hover:underline">
            Open as a page ↗
          </Link>
        </div>
        <LeadDossier
          leadId={id}
          onEdit={() => {
            setEditing(openLead);
            setFormOpen(true);
          }}
        />
        <LeadForm
          open={formOpen}
          editing={editing}
          onClose={() => setFormOpen(false)}
          onSaved={reload}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a lead — company, contact, email…"
          />
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
      <Chips
        label="Filter leads by status"
        value={filter}
        options={LEAD_FILTERS}
        onChange={setFilter}
      />

      {rowError && <ErrorState message={rowError} />}

      {error ? (
        <ErrorState message={error} />
      ) : rows === null ? (
        <SkeletonTable />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={rows.length ? "No leads match" : "No leads yet"}
          hint={
            rows.length
              ? "Try a different filter or search."
              : "Capture your first lead, or triage an inbound enquiry into one."
          }
        />
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
                    {/* The company name opens the 360. A button, not a link,
                        because it swaps the view in place; the dossier's own
                        header offers the copyable URL. */}
                    <button
                      type="button"
                      onClick={() => setOpenLead(r)}
                      className="truncate text-left text-sm font-semibold text-foreground underline-offset-2 hover:underline"
                    >
                      {cell(r.company_name)}
                    </button>
                    <StatusPill status={status} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[cell(r.contact_name), cell(r.email)]
                      .filter((x) => x !== "—")
                      .join(" · ") || "No contact details"}
                    {r.service_interest ? ` · ${cell(r.service_interest)}` : ""}
                  </p>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:block">
                  {cell(r.source).toLowerCase()}
                </span>
                <ComposeIconButton
                  to={String(r.email ?? "") || undefined}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                />
                {!terminal && (
                  <div className="flex gap-2">
                    {status === "QUALIFIED" ? (
                      <Button size="sm" onClick={() => setConverting(r)}>
                        Convert
                      </Button>
                    ) : next ? (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={rowBusy === id}
                        onClick={() => transition(id, next)}
                      >
                        {next === "CONTACTED" ? "Mark contacted" : "Qualify"}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={rowBusy === id}
                      onClick={() => transition(id, "LOST")}
                    >
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

      <LeadForm
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
      />
      <ConvertModal
        lead={converting}
        onClose={() => setConverting(null)}
        onDone={reload}
      />
    </div>
  );
}

/* ═══════════════════════════════ INBOUND INTAKE ═══════════════════════════════ */

/**
 * Both halves of the old intake feed now have a register of their own — F9 gave
 * the enquiry desk one, F10 the partnership register — so this tab is two
 * signposts rather than two second copies.
 *
 * F9 replaced the enquiries list here with a signpost and wrote the reason on
 * it: "Two live lists over one register is the defect this build exists to
 * remove." The partnership list was the other one. It was also, as of migration
 * 0688, broken: it read /intake/partnerships (moved) and its Review modal wrote
 * REVIEWING / ACCEPTED / DECLINED, which the status CHECK no longer accepts.
 */
function IntakeTab() {
  return (
    <div className="space-y-4">
      <EmptyState
        title="Inbound intake has moved into two desks"
        hint="Contact enquiries are classified, answered and closed on their own screen. Partnership and vendor applications are vetted on theirs — where approving a vendor opens a draft supplier."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { window.location.href = "/sales/enquiries"; }}>
              Open contact enquiries
            </Button>
            <Button variant="outline" onClick={() => { window.location.href = "/sales/partnerships"; }}>
              Open partnerships & vendors
            </Button>
          </div>
        }
      />
    </div>
  );
}

/* ─────────────────────────────── Leads page (tabbed) ─────────────────────────────── */

export function LeadsPage() {
  const initialTab =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("tab") === "intake"
      ? "intake"
      : "leads";
  const [tab, setTab] = React.useState<"leads" | "intake">(
    initialTab as "leads" | "intake",
  );

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Leads & intake"
        description="The top of the sales funnel — capture and qualify leads, and triage inbound enquiries into them."
      />
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
