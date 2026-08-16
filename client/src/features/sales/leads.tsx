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
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRow } from "@/components/ui/states";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { useList, useRefresh, type Row } from "@/lib/use-resource";
import { cell, num } from "@/lib/format";
import { StatusPill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Chips } from "@/components/ui/chips";
import { SplitPane } from "@/components/ui/split-pane";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Avatar } from "@/components/ui/avatar";
import { Link } from "react-router-dom";
import { LeadForm } from "./lead-forms";
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

/**
 * The lead register — an index on the left, the full 360 on the right.
 *
 * This is Master data → Clients (`masterdata/client-360.tsx`), deliberately: a
 * `SplitPane` whose left column is a searchable list of names and states, and
 * whose right column is the record's whole dossier. It replaced a card list —
 * one `lux-card` per lead with the fields stacked inside it — which could not
 * be scanned down a column and made you leave the page to learn anything.
 *
 * The lifecycle buttons that were on each card now live in the dossier header
 * (see `ActionBar` in sales-360.tsx), which is where the client 360 keeps
 * Activate / Block / → Supplier. An index row says who and what state; the
 * decision to qualify or lose a lead is made with the discovery notes and the
 * proposal history in front of you, and those are on the right-hand side.
 */
function LeadsTab() {
  const reload = useRefresh();
  const { rows, error } = useList("/leads");
  const [filter, setFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [selId, setSelId] = React.useState<string | null>(null);

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

  /**
   * The tiles PARTITION the register: one per funnel state, plus a total, and
   * they add up. Same discipline as the quote-request tiles — a counter that
   * does not account for every row is the F6 defect wearing a new hat.
   */
  const tiles = React.useMemo(() => {
    const all = rows || [];
    const by = (st: string) => all.filter((r) => String(r.status || "NEW") === st).length;
    return {
      TOTAL: all.length,
      NEW: by("NEW"),
      CONTACTED: by("CONTACTED"),
      QUALIFIED: by("QUALIFIED"),
      CONVERTED: by("CONVERTED"),
      LOST: by("LOST"),
    };
  }, [rows]);

  // Select the first lead once the list arrives, so the right-hand pane is
  // never an empty frame on a register that has rows — same as client-360.
  React.useEffect(() => {
    if (!selId && filtered.length) setSelId(String(filtered[0].lead_id));
  }, [filtered, selId]);

  const selected =
    (rows || []).find((r) => String(r.lead_id) === selId) || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Chips
          label="Filter leads by status"
          value={filter}
          options={LEAD_FILTERS}
          onChange={setFilter}
        />
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Capture lead
        </Button>
      </div>

      <KpiRow>
        <KpiTile label="Leads" value={num(tiles.TOTAL)} />
        <KpiTile label="New" value={num(tiles.NEW)} />
        <KpiTile label="Contacted" value={num(tiles.CONTACTED)} />
        <KpiTile label="Qualified" value={num(tiles.QUALIFIED)} />
        <KpiTile label="Converted" value={num(tiles.CONVERTED)} />
        <KpiTile label="Lost" value={num(tiles.LOST)} />
      </KpiRow>

      {error ? (
        <ErrorState message={error} />
      ) : (
        <SplitPane
          storageKey="sales.leads"
          label="Lead list width"
          defaultSize={260}
          min={200}
          max={480}
        >
          <div className="space-y-2">
            <Input
              placeholder="Search lead…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-[70vh] space-y-1 overflow-auto rounded-lg border p-1">
              {rows === null ? (
                <LoadingRow label="Loading leads…" />
              ) : filtered.length === 0 ? (
                <div className="px-3 py-4 micro">
                  {rows.length ? "No leads match." : "No leads yet."}
                </div>
              ) : (
                filtered.map((r) => {
                  const id = String(r.lead_id);
                  return (
                    <button
                      key={id}
                      onClick={() => setSelId(id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${id === selId ? "bg-primary/10 text-foreground" : "hover:bg-muted"}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Avatar name={String(r.company_name || "?")} />
                        <span className="truncate font-medium">
                          {cell(r.company_name)}
                        </span>
                      </span>
                      <StatusPill status={String(r.status || "NEW")} />
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
                  to={`/sales/leads/${selId}`}
                  className="micro hover:underline"
                >
                  Open as a page ↗
                </Link>
              </div>
              <LeadDossier
                leadId={String(selected.lead_id)}
                // The name and state are already in the row that was clicked,
                // so the dossier can draw its own header before the request
                // lands — no blank frame, and no identity that changes under
                // the reader. See DossierSkeleton.
                placeholder={{
                  title: String(selected.company_name || ""),
                  status: String(selected.status || "NEW"),
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
              title={rows && rows.length ? "No lead selected" : "No leads yet"}
              hint={
                rows && rows.length
                  ? "Choose a lead from the list."
                  : "Capture your first lead, or triage an inbound enquiry into one."
              }
            />
          )}
        </SplitPane>
      )}

      <LeadForm
        open={formOpen}
        editing={editing}
        onClose={() => setFormOpen(false)}
        onSaved={reload}
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
