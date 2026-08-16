/**
 * Sales & CRM — Partnerships & vendors (F10 intake desk).
 *
 * doc/SALES_CRM_FEATURES.md#F10. Forwarding agents and vendors apply to work
 * with the company; someone vets the application; on approval a vendor starts
 * existing as a DRAFT supplier that still has to be verified before anything
 * can be bought from them.
 *
 * THE TILES. Four, in the legacy's order — total, agency partnerships, vendor
 * registrations, pending review — but the API computes them from two COMPLETE
 * partitions (one per status, one per type) and refuses to answer if either
 * fails to sum to the total. The legacy's four look like a summary and are not
 * one: agency + vendor already IS total, and its "pending" tile counts NEW plus
 * a status string ('UNDER_REVIEW') that its own update endpoint never writes,
 * so it has been reporting only new rows since it shipped.
 *
 * NETWORK MEMBERSHIPS are a column on the list rather than a detail-page field.
 * They are what a forwarding agent is actually vetted on, and a register that
 * makes you open every row to see them is a register nobody triages from.
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
import { PartnershipForm, ReviewModal, NetworkPills } from "./partnership-forms";

type Kpi = Record<string, number>;

const KPI_TILES: { key: string; label: string; accent: string }[] = [
  { key: "TOTAL", label: "Total proposals", accent: "text-foreground" },
  { key: "AGENCY_PARTNERSHIP", label: "Agency partnerships", accent: "text-primary-ink" },
  { key: "VENDOR_REGISTRATION", label: "Vendor registrations", accent: "text-ok" },
  { key: "PENDING", label: "Pending review", accent: "text-warn" },
];

const EMPTY_KPI: Kpi = KPI_TILES.reduce((a, t) => ({ ...a, [t.key]: 0 }), {} as Kpi);

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "NEW", label: "New" },
  { value: "IN_REVIEW", label: "Under review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: "AGENCY_PARTNERSHIP", label: "Agency partnership" },
  { value: "VENDOR_REGISTRATION", label: "Vendor registration" },
];

const PARTNERSHIP_AI: AiAction[] = [
  {
    label: "Summarise an applicant",
    kind: "assist",
    describe: "Read one application — memberships, country, proposal text and profile document — and summarise what it rests on.",
  },
  {
    label: "Move to review",
    kind: "assist",
    describe: "Move a new application to UNDER REVIEW, or reject it with a recorded reason.",
  },
  {
    label: "Approve and open a draft supplier",
    kind: "write",
    describe: "Approve an application (human-confirmed). A vendor registration opens a DRAFT supplier; an existing supplier with the same name is reused, never duplicated.",
  },
];

function KpiTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="lux-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

export function PartnershipsPage() {
  const [statusFilter, setStatusFilter] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [data, setData] = React.useState<{ rows: any[]; total: number; kpi: Kpi } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<any | null>(null);
  const [reviewing, setReviewing] = React.useState<any | null>(null);

  const params = React.useCallback(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set("status", statusFilter);
    if (typeFilter) p.set("proposal_type", typeFilter);
    if (search.trim()) p.set("q", search.trim());
    return p.toString();
  }, [statusFilter, typeFilter, search]);

  const reload = React.useCallback(async () => {
    setError(null);
    try {
      const qs = params();
      const out = await tenant<any>(`/partnership-requests${qs ? `?${qs}` : ""}`);
      // The register returns { rows, total, kpi } directly; some endpoints wrap
      // in { data }. Tolerate both rather than guess.
      const payload = out && typeof out === "object" && "rows" in out ? out : out?.data;
      setData({ rows: payload?.rows || [], total: payload?.total || 0, kpi: payload?.kpi || EMPTY_KPI });
      // Keep an open review drawer in step with the row it is showing.
      setReviewing((cur: any) =>
        cur
          ? (payload?.rows || []).find(
              (r: any) => String(r.partnership_request_id) === String(cur.partnership_request_id),
            ) || cur
          : cur,
      );
    } catch (e) {
      setError(errMsg(e));
    }
  }, [params]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  function exportCsv() {
    const qs = params();
    const today = new Date().toISOString().slice(0, 10);
    void download(`/partnership-requests/export.csv${qs ? `?${qs}` : ""}`, `partnership_requests_${today}.csv`);
  }

  const rows = data?.rows || [];
  const kpi = data?.kpi || EMPTY_KPI;

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Partnerships & vendors"
        description="Applications from forwarding agents and vendors. Approving a vendor opens a draft supplier in the master registry — which buys nothing until somebody verifies it."
      />
      <HubTabs />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPI_TILES.map((t) => (
          <KpiTile key={t.key} label={t.label} value={kpi[t.key] ?? 0} accent={t.accent} />
        ))}
        {kpi.OTHER_STATUS ? <KpiTile label="Unrecognised status" value={kpi.OTHER_STATUS} accent="text-bad" /> : null}
        {kpi.OTHER_TYPE ? <KpiTile label="Unrecognised type" value={kpi.OTHER_TYPE} accent="text-bad" /> : null}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find an applicant — company, country, contact, email…"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Record application
          </Button>
        </div>
      </div>

      <div className="mb-4 space-y-3">
        <Chips label="Filter by status" value={statusFilter} options={STATUS_FILTERS} onChange={setStatusFilter} />
        <Chips label="Filter by type" value={typeFilter} options={TYPE_FILTERS} onChange={setTypeFilter} />
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : data === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No applications yet"
          hint="Record one manually, or wait for the website's partnership form to land one here."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const id = String(r.partnership_request_id);
            const status = String(r.status || "NEW");
            const isVendor = String(r.proposal_type) === "VENDOR_REGISTRATION";
            return (
              <div key={id} className="lux-card flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{cell(r.company_name)}</p>
                    <StatusPill status={status} />
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {isVendor ? "vendor" : "agency"}
                    </span>
                    {r.supplier_id ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ok">
                        supplier opened
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[cell(r.country_of_origin), cell(r.contact_name), cell(r.email)]
                      .filter((x) => x !== "—")
                      .join(" · ") || "—"}
                  </p>
                  <div className="mt-1">
                    <NetworkPills
                      list={Array.isArray(r.network_memberships) ? r.network_memberships.map(String) : []}
                    />
                  </div>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:block">{dateFmt(r.created_at)}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReviewing(r)}>Review</Button>
                  {status !== "APPROVED" && (
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
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PartnershipForm open={formOpen} editing={editing} onClose={() => setFormOpen(false)} onSaved={reload} />
      <ReviewModal request={reviewing} onClose={() => setReviewing(null)} onDone={reload} />

      <AiActions actions={PARTNERSHIP_AI} />
    </section>
  );
}
