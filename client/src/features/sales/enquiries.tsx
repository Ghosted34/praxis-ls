/**
 * Sales & CRM — Contact enquiries (F9, doc/SALES_CRM_FEATURES.md#F9).
 *
 * The desk for messages from the website's contact form: they arrive, get
 * classified, get answered, and either close or become a lead — or, when they
 * are a partnership offer, a partnership request in F10's register.
 *
 * THE TILES PARTITION THE SET. One tile per correspondence status plus TOTAL,
 * and they add up under every filter combination with no row left over.
 *
 * That is a deliberate deviation from the legacy, which renders FOUR tiles
 * (Total / New (unread) / Responded / Closed) over FOUR statuses (NEW / READ /
 * RESPONDED / CLOSED). READ belongs to no tile there, so a message that has
 * been opened and not yet answered is counted into Total and displayed nowhere,
 * and the three sub-tiles do not sum to the first. Four tiles that do not add
 * up is the defect, not the specification — so the row here is the legacy's
 * four plus a Read tile.
 *
 * Two things stop it coming back: the API derives the tiles from its own status
 * list and asserts they sum to TOTAL before responding, and this screen renders
 * whatever it is given rather than keeping a hand-written copy. `Unrecognised`
 * appears only if a row carries a status the API does not know — visible rather
 * than silently absorbed.
 *
 * The legacy also computes its tiles in PHP by looping the page it just fetched
 * under LIMIT 200, so a desk with 300 messages reports "Total: 200". Here the
 * counts come from a GROUP BY over the whole filtered set, and the status
 * filter is dropped from that query so filtering to Responded still shows the
 * full summary instead of one tile equal to the total.
 */

import * as React from "react";
import { tr } from "@/lib/i18n";
import { tenant, download } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SkeletonTable } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/ui/pill";
import { Chips } from "@/components/ui/chips";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { pageShell } from "@/lib/layout";
import { cell, dateFmt } from "@/lib/format";
import { errMsg } from "@/lib/use-resource";
import { AiActions } from "@/components/ai-actions";
import type { AiAction } from "@/features/scaffold/screen-specs";
import { ManageEnquiryModal } from "./enquiry-forms";

/** TOTAL plus one count per status; `OTHER` only ever appears if a row carries
 *  a status the API does not know, which the screen shows rather than hides. */
type Kpi = Record<string, number>;

/** Tile order and captions — lifecycle order, TOTAL first. Kept beside
 *  STATUS_FILTERS below so the two cannot drift apart. */
const KPI_TILES: { key: string; label: string; accent: string }[] = [
  { key: "TOTAL", label: "Total messages", accent: "text-foreground" },
  { key: "NEW", label: "New (unread)", accent: "text-warn" },
  { key: "READ", label: "Read", accent: "text-primary-ink" },
  { key: "RESPONDED", label: "Responded", accent: "text-ok" },
  { key: "CLOSED", label: "Closed", accent: "text-muted-foreground" },
];

const EMPTY_KPI: Kpi = KPI_TILES.reduce((a, t) => ({ ...a, [t.key]: 0 }), {} as Kpi);

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "NEW", label: "New (unread)" },
  { value: "READ", label: "Read" },
  { value: "RESPONDED", label: "Responded" },
  { value: "CLOSED", label: "Closed" },
];

const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: "GENERAL_ENQUIRY", label: "General enquiry" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "CAREERS", label: "Careers" },
  { value: "MEDIA", label: "Media" },
];

const TYPE_LABEL: Record<string, string> = {
  GENERAL_ENQUIRY: "General enquiry",
  PARTNERSHIP: "Partnership",
  CAREERS: "Careers",
  MEDIA: "Media",
};

const ENQUIRY_AI: AiAction[] = [
  {
    label: "Draft a reply",
    kind: "assist",
    describe:
      "Read the enquiry and draft an answer for a human to edit. Nothing is sent until someone confirms the wording.",
  },
  {
    label: "Classify the unread pile",
    kind: "assist",
    describe:
      "Suggest an enquiry_type (GENERAL_ENQUIRY / PARTNERSHIP / CAREERS / MEDIA) for every message still sitting in New.",
  },
  {
    label: "Route to lead or partnership",
    kind: "write",
    describe:
      "Raise a lead, or a partnership request, from an enquiry (human-confirmed before the write runs).",
  },
];

function KpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="lux-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

export function EnquiriesPage() {
  const [statusFilter, setStatusFilter] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [data, setData] = React.useState<{ rows: any[]; total: number; kpi: Kpi } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [managing, setManaging] = React.useState<any | null>(null);

  const params = React.useCallback(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set("status", statusFilter);
    if (typeFilter) p.set("enquiry_type", typeFilter);
    if (search.trim()) p.set("q", search.trim());
    return p;
  }, [statusFilter, typeFilter, search]);

  const reload = React.useCallback(async () => {
    setError(null);
    try {
      const qs = params().toString();
      const out = await tenant<any>(`/intake/enquiries${qs ? `?${qs}` : ""}`);
      // The backend returns { rows, total, kpi } directly (not wrapped in
      // data). Some endpoints wrap; tolerate both.
      const payload = out && typeof out === "object" && "rows" in out ? out : out?.data;
      setData({
        rows: payload?.rows || [],
        total: payload?.total || 0,
        kpi: payload?.kpi || EMPTY_KPI,
      });
    } catch (e) {
      setError(errMsg(e));
    }
  }, [params]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  function exportCsv() {
    const qs = params().toString();
    const today = new Date().toISOString().slice(0, 10);
    void download(`/intake/enquiries/export.csv${qs ? `?${qs}` : ""}`, `contact_enquiries_${today}.csv`);
  }

  const rows = data?.rows || [];
  const kpi = data?.kpi || EMPTY_KPI;

  return (
    <section className={pageShell.wide}>
      <PageHeader
        eyebrow={<HubCrumb area="Sales & CRM" to="/sales" />}
        title="Contact enquiries"
        description="Messages from the website contact form. One tile per state, and they add up under every filter; replying is recorded separately from having merely read it."
      />
      <HubTabs />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {KPI_TILES.map((t) => (
          <KpiCard key={t.key} label={t.label} value={kpi[t.key] ?? 0} accent={t.accent} />
        ))}
        {kpi.OTHER ? <KpiCard label="Unrecognised" value={kpi.OTHER} accent="text-bad" /> : null}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a message — name, company, email, subject, body…"
          />
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
          Export CSV
        </Button>
      </div>

      <div className="mb-4 space-y-3">
        <Chips label={tr("Filter by status")} value={statusFilter} options={STATUS_FILTERS} onChange={setStatusFilter} />
        <Chips label="Filter by enquiry type" value={typeFilter} options={TYPE_FILTERS} onChange={setTypeFilter} />
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : data === null ? (
        <SkeletonTable />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No enquiries"
          hint="Messages from the website contact form land here to be classified, answered and routed."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const id = String(r.contact_enquiry_id);
            const status = String(r.status || "NEW");
            // ONE source of truth for "was this triaged" — the FKs, never a
            // status value. The legacy computed its analogue two different ways
            // and the two disagreed.
            const routed = Boolean(r.lead_id || r.partnership_request_id);
            return (
              <div key={id} className="lux-card flex items-center gap-3 p-3">
                <Avatar name={String(r.name || r.company_name || r.email || "?")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {cell(r.subject) === "—" ? "(no subject)" : cell(r.subject)}
                    </p>
                    <StatusPill status={status} />
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {TYPE_LABEL[String(r.enquiry_type)] || cell(r.enquiry_type)}
                    </span>
                    {routed && (
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary-ink">
                        {r.lead_id && r.partnership_request_id
                          ? "lead + partnership"
                          : r.lead_id
                            ? "lead raised"
                            : "partnership raised"}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[cell(r.name), cell(r.company_name), cell(r.email)].filter((x) => x !== "—").join(" · ") ||
                      "Anonymous"}
                    {" · "}
                    {cell(r.source).toLowerCase()} · {dateFmt(r.created_at)}
                    {r.responded_at ? ` · answered ${dateFmt(r.responded_at)}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setManaging(r)}>
                  Manage
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <ManageEnquiryModal enquiry={managing} onClose={() => setManaging(null)} onDone={reload} />

      <AiActions actions={ENQUIRY_AI} />
    </section>
  );
}
