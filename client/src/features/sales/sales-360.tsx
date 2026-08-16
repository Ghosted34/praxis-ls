/**
 * Lead 360° and Intake 360° — the two front-of-funnel command centres.
 *
 * One rich view over `/leads/:id/360` and `/quote-requests/:id/360`, built to
 * the same shape as `masterdata/party-360.tsx`: a header carrying identity and
 * lifecycle, a KPI strip, then tabs for every collection that points at the
 * record. A reader who knows the client 360 knows this one.
 *
 * WHY IT EXISTS. F6 split what the legacy overloaded into one column across
 * three rows — the lead carries the commercial funnel, the quote request the
 * intake lifecycle, the opportunity the pipeline stage. That correction is the
 * point of the feature, and it left a salesperson with three registers and no
 * one place that answers "what is going on with this company". The meetings are
 * on a fourth screen and the proposals on a fifth. This is the join the split
 * made necessary.
 *
 * MONEY IS SERVER-GATED. `kpis.money_visible` tells this view whether the caller
 * has finance visibility; when false the API sends `null` — not 0 — and every
 * money cell here renders a "—" with a single explanatory line rather than a
 * zero. A dossier that shows "XAF 0" to someone who is merely not allowed to
 * see the figure is worse than one that admits it is hiding something.
 *
 * BOTH SURFACES, ONE COMPONENT. `LeadDossier` / `IntakeDossier` are embedded in
 * the registers (the way suppliers.tsx embeds PartyDossier) and the `*Page`
 * wrappers below mount the same component on their own route, so a dossier can
 * be linked to from an email. Neither copy can drift from the other.
 */

import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Pill, StatusPill, type Tone } from "@/components/ui/pill";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource, errMsg } from "@/lib/use-resource";
import { money, moneyCompact, num, dateFmt, dateTimeFmt, enumLabel, cell } from "@/lib/format";
import { pageShell } from "@/lib/layout";
import { ConvertModal } from "./lead-forms";
import { ConvertToOpportunityModal } from "./quote-request-forms";

/* ── Types (mirrors src/modules/sales/sales-360.service.js) ────────────────── */

type Id = string;

export type DiscoverySection = {
  section_key: string;
  capture_state?: string | null;
  dictation_error?: string | null;
  has_body: boolean;
  updated_at?: string | null;
};
export type Meeting360 = {
  meeting_id: Id;
  subject?: string | null;
  location?: string | null;
  scheduled_at?: string | null;
  created_at?: string;
  organiser_name?: string | null;
  sections: DiscoverySection[];
};
export type Proposal360 = {
  proposal_id: Id;
  doc_number?: string | null;
  title?: string | null;
  status?: string | null;
  language?: string | null;
  currency?: string | null;
  ai_generated?: boolean;
  created_at?: string;
  viewed_at?: string | null;
  downloaded_at?: string | null;
  share_live?: boolean;
  total: number | null;
};
export type Opportunity360 = {
  opportunity_id: Id;
  name?: string | null;
  status?: string | null;
  estimated_value: number | null;
  weighted_value: number | null;
  currency?: string | null;
  probability?: number | null;
  probability_is_manual?: boolean;
  source?: string | null;
  scope_summary?: string | null;
  settled_at?: string | null;
  stage_code?: string | null;
  stage_name?: string | null;
};
export type QuoteRequest360Row = {
  quote_request_id: Id;
  public_ref?: string | null;
  status?: string | null;
  intake_channel?: string | null;
  service_category?: string | null;
  incoterm?: string | null;
  origin_location?: string | null;
  destination_location?: string | null;
  estimated_weight?: number | string | null;
  project_cargo_flag?: boolean;
  converted_opportunity_id?: Id | null;
  created_at?: string;
};
export type Enquiry360 = {
  contact_enquiry_id: Id;
  subject?: string | null;
  enquiry_type?: string | null;
  status?: string | null;
  source?: string | null;
  responded_at?: string | null;
  created_at?: string;
};
export type TimelineEntry = {
  audit_id: Id;
  action: string;
  actor_name?: string | null;
  is_sensitive?: boolean;
  occurred_at: string;
};

export type LeadDossierData = {
  lead: Record<string, unknown> & {
    lead_id: Id;
    company_name?: string | null;
    status?: string | null;
  };
  kpis: {
    meetings: number;
    discovery_sections_captured: number;
    quote_requests: number;
    proposals: number;
    proposals_sent: number;
    proposals_accepted: number;
    enquiries: number;
    opportunities: number;
    open_opportunities: number;
    won_opportunities: number;
    lost_opportunities: number;
    open_pipeline_value: number | null;
    weighted_pipeline_value: number | null;
    proposals_value: number | null;
    money_visible: boolean;
  };
  meetings: Meeting360[];
  quote_requests: QuoteRequest360Row[];
  proposals: Proposal360[];
  opportunities: Opportunity360[];
  enquiries: Enquiry360[];
  client: { client_id: Id; name?: string | null } | null;
  timeline: TimelineEntry[];
};

export type IntakeAttachment = {
  quote_request_attachment_id: Id;
  kind: string;
  vault_id: Id;
  original_name?: string | null;
  doc_type?: string | null;
  vault_status?: string | null;
  uploaded_by_name?: string | null;
  created_at?: string;
};
export type IntakeDossierData = {
  request: Record<string, unknown> & {
    quote_request_id: Id;
    public_ref?: string | null;
    status?: string | null;
  };
  kpis: {
    attachments: number;
    has_primary_attachment: boolean;
    proposals: number;
    is_converted: boolean;
    age_days: number;
    converted_value: number | null;
    money_visible: boolean;
  };
  attachments: IntakeAttachment[];
  converted_opportunity: Opportunity360 | null;
  lead: { lead_id: Id; company_name?: string | null; status?: string | null } | null;
  proposals: Proposal360[];
  timeline: TimelineEntry[];
};

/* ── Small building blocks (mirroring party-360's MiniTable / Th / Td) ─────── */

function MiniTable({
  head,
  children,
  empty,
  emptyHint,
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  empty: boolean;
  emptyHint?: string;
}) {
  if (empty)
    return (
      <div className="px-3 py-6 text-center micro">
        {emptyHint || "Nothing here yet."}
      </div>
    );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
const Th = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <th className={`px-3 py-2 font-medium ${r ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, r }: { children?: React.ReactNode; r?: boolean }) => (
  <td className={`px-3 py-1.5 ${r ? "text-right num" : ""}`}>{children}</td>
);

/**
 * A money cell that tells the truth when it is not allowed to show a figure.
 *
 * `null` from the API means "you do not have finance visibility", which is a
 * different fact from zero. Rendering `money(null)` would print XAF 0 and quietly
 * misinform; this prints an em dash the reader can hover.
 */
function Money({ value, currency }: { value: number | null; currency?: string | null }) {
  if (value === null || value === undefined)
    return (
      <span className="text-muted-foreground" title="Hidden — needs finance visibility">
        —
      </span>
    );
  return <>{money(value, currency || "XAF")}</>;
}

/** A capture-state pill for one discovery section (F1). */
const SECTION_TONE: Record<string, Tone> = {
  TYPED: "ok",
  TRANSCRIBED: "ok",
  DICTATING: "blue",
  QUEUED: "blue",
  FAILED: "bad",
  EMPTY: "mute",
};
function SectionPill({ s }: { s: DiscoverySection }) {
  const state = String(s.capture_state || (s.has_body ? "TYPED" : "EMPTY")).toUpperCase();
  return (
    <Pill tone={SECTION_TONE[state] || "mute"}>
      {enumLabel(s.section_key)}
      {state === "FAILED" ? " · dictation failed" : ""}
    </Pill>
  );
}

/** The header block both dossiers share: a title, a status and a field grid. */
function DossierHeader({
  title,
  subtitle,
  status,
  fields,
  titleAs = "h2",
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  status?: string | null;
  fields: { label: string; value: React.ReactNode }[];
  titleAs?: "h1" | "h2";
  actions?: React.ReactNode;
}) {
  const H = titleAs;
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <H className="truncate text-lg font-semibold text-foreground">{title}</H>
            {status ? <StatusPill status={status} /> : null}
          </div>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        {fields.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="micro">{f.label}</dt>
            <dd className="truncate text-sm text-foreground">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * What a dossier looks like while it is loading.
 *
 * SWITCHING RECORDS USED TO FLASH, and the cause was the placeholder, not the
 * request. This rendered `<SkeletonTable />` — six grey rows in a card — so
 * picking another lead went: full dossier → a short table-shaped block → full
 * dossier. Two separate jolts. The shape changed, and the page HEIGHT collapsed
 * to a fraction of the dossier's and sprang back, which on a scrolled page
 * moves everything under the cursor.
 *
 * `ui/skeleton.tsx` says it in its own header: a skeleton "says this is what is
 * about to be here" and "stops the layout jumping because the placeholder
 * already occupies the space the real content will take". A table skeleton
 * under a 360 does neither.
 *
 * So this mirrors the dossier — the same header card, KPI strip, tab bar and
 * two-column body, at roughly the same height.
 *
 * AND IT KNOWS WHOSE DOSSIER IS COMING. The register already has the name and
 * the state in the row that was just clicked, so they are passed down and drawn
 * for real: the identity appears instantly and never changes under the reader,
 * and only what nobody could know yet is grey. That is also why this does not
 * keep the PREVIOUS record's data on screen while fetching — the cheaper trick —
 * which would show one lead's figures under another lead's name for as long as
 * the request takes.
 */
function DossierSkeleton({
  title,
  status,
  tabs,
  titleAs = "h2",
}: {
  title?: string | null;
  status?: string | null;
  tabs: readonly string[];
  titleAs?: "h1" | "h2";
}) {
  const H = titleAs;
  return (
    <div className="space-y-4" role="status" aria-label="Loading dossier">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {title ? (
                <H className="truncate text-lg font-semibold text-foreground">{title}</H>
              ) : (
                <Skeleton className="h-6 w-56" />
              )}
              {status ? <StatusPill status={status} /> : <Skeleton className="h-5 w-16" />}
            </div>
            <Skeleton className="mt-2 h-3 w-64" />
          </div>
          <Skeleton className="h-8 w-40" />
        </div>
        {/* The same four-column field grid, so the header keeps its height. */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-col divide-y overflow-hidden rounded-[10px] border bg-card shadow-[var(--shadow-s)] sm:flex-row sm:flex-wrap sm:divide-x sm:divide-y-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex min-w-0 flex-1 basis-[9rem] items-center gap-2.5 px-4 py-2.5"
          >
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* The real tab labels — they are known before the data is, and greying
          them out would be pretending otherwise. */}
      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <span
            key={t}
            className="border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground/50"
          >
            {t}
          </span>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="min-h-[12rem] rounded-xl border bg-card p-4">
            <Skeleton className="mb-3 h-4 w-32" />
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, j) => (
                <Skeleton key={j} className="h-3 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The append-only history, shared by both dossiers. */
function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <MiniTable
      empty={entries.length === 0}
      emptyHint="No recorded changes yet."
      head={
        <>
          <Th>When</Th>
          <Th>Action</Th>
          <Th>By</Th>
        </>
      }
    >
      {entries.map((e) => (
        <tr key={e.audit_id}>
          <Td>{dateTimeFmt(e.occurred_at)}</Td>
          <Td>
            {enumLabel(e.action)}
            {e.is_sensitive ? (
              <Pill tone="orange" className="ml-2">
                Sensitive
              </Pill>
            ) : null}
          </Td>
          <Td>{cell(e.actor_name)}</Td>
        </tr>
      ))}
    </MiniTable>
  );
}

/** Rendered once per dossier when money is hidden, instead of on every cell. */
function MoneyNotice({ visible }: { visible: boolean }) {
  if (visible) return null;
  return (
    <p className="micro">
      Money is hidden on this dossier — it needs finance visibility (a read grant
      on Treasury). Counts and statuses are complete.
    </p>
  );
}

/**
 * The lifecycle buttons that used to live on every row of the register.
 *
 * They belong in the dossier header, which is where Master data → Clients puts
 * them (Activate / Block / → Supplier sit beside the client's name, not on the
 * list row). Two reasons beyond consistency: the register is now an index —
 * a name and a state, nothing else — and an action taken from a row is taken
 * without the context that decides it. "Qualify" is a judgement about what the
 * discovery notes and the proposal history say, and both are on this page.
 *
 * Defined once here so BOTH surfaces get them: the dossier embedded in the
 * register, and the one on its own route. That is the whole reason the two
 * surfaces share a component — a second copy of this bar is a second place for
 * the transition rules to drift.
 */
function ActionBar({
  busy,
  error,
  children,
}: {
  busy: boolean;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error ? (
        <span className="micro text-[rgb(var(--bad))]" role="alert">
          {error}
        </span>
      ) : null}
      <span className={busy ? "pointer-events-none opacity-60" : undefined}>
        <span className="flex flex-wrap items-center gap-2">{children}</span>
      </span>
    </div>
  );
}

/**
 * Run a transition and refresh the dossier.
 *
 * The dossier reload is the point: a status change moves KPI tiles and can add
 * a timeline row, and a header that updates while the body still shows the old
 * state is how a user learns not to trust the screen.
 */
function useTransition(reload: () => void, onChanged?: () => void) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(
    async (path: string, body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await tenant(path, { method: "POST", body });
        reload();
        onChanged?.();
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [reload, onChanged],
  );
  return { busy, error, run };
}

/* ═════════════════════════════ LEAD 360 ═════════════════════════════════════ */

const LEAD_TABS = [
  "Overview",
  "Meetings",
  "Quote requests",
  "Proposals",
  "Opportunities",
  "Enquiries",
  "History",
] as const;
type LeadTab = (typeof LEAD_TABS)[number];

export function LeadDossier({
  leadId,
  titleAs = "h2",
  onEdit,
  onChanged,
  placeholder,
}: {
  leadId: string;
  titleAs?: "h1" | "h2";
  onEdit?: () => void;
  /** Told when a transition lands, so a register can refresh its index. */
  onChanged?: () => void;
  /**
   * What the caller already knows about this record — the name and state from
   * the row that was just clicked. Drawn immediately so switching records shows
   * the right identity before the request lands. See `DossierSkeleton`.
   */
  placeholder?: { title?: string | null; status?: string | null };
}) {
  const [tab, setTab] = React.useState<LeadTab>("Overview");
  const [converting, setConverting] = React.useState(false);
  const res = useResource<LeadDossierData>(
    () => tenant<LeadDossierData>(`/leads/${leadId}/360`),
    [leadId],
  );
  const { busy, error: actionError, run } = useTransition(res.reload, onChanged);

  if (res.error) return <ErrorState message={errMsg(res.error)} />;
  if (!res.data)
    return (
      <DossierSkeleton
        titleAs={titleAs}
        tabs={LEAD_TABS}
        title={placeholder?.title}
        status={placeholder?.status}
      />
    );
  const d = res.data;
  // A payload without its record is a broken response, not an empty lead —
  // say so rather than throwing on `l.status` and taking the screen down with
  // an error boundary. Caught by screens.axe.test.tsx, which renders this
  // against a stubbed API.
  if (!d.lead) return <ErrorState message="This lead's dossier came back empty." />;
  const l = d.lead;
  const k = d.kpis || ({} as LeadDossierData["kpis"]);

  const status = String(l.status || "NEW");
  const terminal = status === "CONVERTED" || status === "LOST";
  const next = status === "NEW" ? "CONTACTED" : status === "CONTACTED" ? "QUALIFIED" : null;

  const counts: Partial<Record<LeadTab, number>> = {
    Meetings: d.meetings?.length ?? 0,
    "Quote requests": d.quote_requests?.length ?? 0,
    Proposals: d.proposals?.length ?? 0,
    Opportunities: d.opportunities?.length ?? 0,
    Enquiries: d.enquiries?.length ?? 0,
    History: d.timeline?.length ?? 0,
  };

  return (
    <div className="space-y-4">
      <DossierHeader
        titleAs={titleAs}
        title={String(l.company_name || "Untitled lead")}
        status={l.status as string}
        subtitle={
          [cell(l.contact_name as string), cell(l.email as string), cell(l.phone as string)]
            .filter((x) => x !== "—")
            .join(" · ") || "No contact details"
        }
        actions={
          <ActionBar busy={busy} error={actionError}>
            {d.client ? (
              <Link to={`/master/clients?focus=${encodeURIComponent(d.client.client_id)}`}>
                <Button size="sm" variant="outline">
                  Open client
                </Button>
              </Link>
            ) : null}
            {!terminal && next ? (
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                onClick={() => run(`/leads/${leadId}/transition`, { to: next })}
              >
                {next === "CONTACTED" ? "Mark contacted" : "Qualify"}
              </Button>
            ) : null}
            {status === "QUALIFIED" ? (
              <Button size="sm" onClick={() => setConverting(true)}>
                Convert
              </Button>
            ) : null}
            {!terminal ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => run(`/leads/${leadId}/transition`, { to: "LOST" })}
              >
                Lost
              </Button>
            ) : null}
            {onEdit ? (
              <Button size="sm" variant="outline" onClick={onEdit}>
                Edit
              </Button>
            ) : null}
          </ActionBar>
        }
        fields={[
          { label: "Reference", value: cell(l.public_ref as string) },
          { label: "Owner", value: cell(l.owner_name as string) },
          { label: "Source", value: enumLabel(String(l.source ?? "")) || "—" },
          { label: "Intake channel", value: enumLabel(String(l.intake_channel ?? "")) || "—" },
          { label: "Country", value: cell(l.country as string) },
          { label: "Address", value: cell(l.address as string) },
          { label: "NIU", value: cell(l.niu as string) },
          { label: "RCCM", value: cell(l.rccm as string) },
          { label: "Service interest", value: cell(l.service_interest as string) },
          { label: "Corporate entity", value: cell(l.entity_name as string) },
          { label: "Captured", value: dateFmt(l.created_at as string) },
          {
            label: "Converted client",
            value: d.client ? cell(d.client.name) : "Not converted",
          },
        ]}
      />

      {/* `fit="content"` and `moneyCompact` are the responsiveness fix: five
          tiles sharing one row, one of them carrying a money figure and a
          weighted hint, overflowed the card at every width — see KpiRow. */}
      <KpiRow fit="content">
        <KpiTile label="Meetings" value={num(k.meetings)} hint={`${k.discovery_sections_captured} discovery`} />
        <KpiTile label="Quote requests" value={num(k.quote_requests)} />
        <KpiTile label="Proposals" value={num(k.proposals)} hint={`${k.proposals_sent} sent · ${k.proposals_accepted} accepted`} />
        <KpiTile label="Open deals" value={num(k.open_opportunities)} hint={`${k.won_opportunities} won · ${k.lost_opportunities} lost`} />
        <KpiTile
          label="Open pipeline"
          value={k.open_pipeline_value === null ? "—" : moneyCompact(k.open_pipeline_value)}
          hint={
            k.weighted_pipeline_value === null
              ? "needs finance visibility"
              : `${moneyCompact(k.weighted_pipeline_value)} weighted`
          }
        />
      </KpiRow>
      <MoneyNotice visible={k.money_visible} />

      <div className="flex flex-wrap gap-1 border-b">
        {LEAD_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t}
            {counts[t] != null && <span className="ml-1.5 micro">{counts[t]}</span>}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Where this stands</h4>
            {k.opportunities === 0 && k.proposals === 0 && k.quote_requests === 0 ? (
              <EmptyState
                title="Nothing has happened yet"
                hint="Capture a meeting, log a quote request, or draft a proposal to start the trail."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                <li>
                  {k.meetings > 0
                    ? `${k.meetings} meeting${k.meetings === 1 ? "" : "s"}, ${k.discovery_sections_captured} discovery section${k.discovery_sections_captured === 1 ? "" : "s"} captured.`
                    : "No meetings captured — a proposal drafted now has nothing to ground itself in."}
                </li>
                <li>
                  {k.proposals > 0
                    ? `${k.proposals_sent} of ${k.proposals} proposal${k.proposals === 1 ? "" : "s"} sent, ${k.proposals_accepted} accepted.`
                    : "No proposals yet."}
                </li>
                <li>
                  {k.open_opportunities > 0
                    ? `${k.open_opportunities} deal${k.open_opportunities === 1 ? "" : "s"} open on the board.`
                    : "Nothing open on the pipeline board."}
                </li>
              </ul>
            )}
          </div>
          <div className="rounded-xl border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Latest activity</h4>
            <Timeline entries={(d.timeline || []).slice(0, 8)} />
          </div>
        </div>
      )}

      {tab === "Meetings" && (
        <MiniTable
          empty={(d.meetings || []).length === 0}
          emptyHint="No meetings captured against this lead."
          head={
            <>
              <Th>When</Th>
              <Th>Subject</Th>
              <Th>Location</Th>
              <Th>Organiser</Th>
              <Th>Discovery</Th>
            </>
          }
        >
          {(d.meetings || []).map((m) => (
            <tr key={m.meeting_id}>
              <Td>{dateFmt(m.scheduled_at || m.created_at)}</Td>
              <Td>{cell(m.subject)}</Td>
              <Td>{cell(m.location)}</Td>
              <Td>{cell(m.organiser_name)}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {m.sections.length === 0 ? (
                    <span className="micro">Not started</span>
                  ) : (
                    m.sections.map((s) => (
                      <SectionPill key={s.section_key} s={s} />
                    ))
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </MiniTable>
      )}

      {tab === "Quote requests" && (
        <MiniTable
          empty={(d.quote_requests || []).length === 0}
          emptyHint="No quote requests from this lead."
          head={
            <>
              <Th>Reference</Th>
              <Th>Status</Th>
              <Th>Route</Th>
              <Th>Incoterm</Th>
              <Th r>Weight</Th>
              <Th>Received</Th>
            </>
          }
        >
          {(d.quote_requests || []).map((q) => (
            <tr key={q.quote_request_id}>
              <Td>
                <Link
                  className="underline-offset-2 hover:underline"
                  to={`/sales/quote-requests/${q.quote_request_id}`}
                >
                  {cell(q.public_ref)}
                </Link>
              </Td>
              <Td>
                <StatusPill status={String(q.status || "")} />
              </Td>
              <Td>
                {[cell(q.origin_location), cell(q.destination_location)]
                  .filter((x) => x !== "—")
                  .join(" → ") || "—"}
              </Td>
              <Td>{cell(q.incoterm)}</Td>
              <Td r>{q.estimated_weight ? num(q.estimated_weight) : "—"}</Td>
              <Td>{dateFmt(q.created_at)}</Td>
            </tr>
          ))}
        </MiniTable>
      )}

      {tab === "Proposals" && (
        <>
          <MoneyNotice visible={k.money_visible} />
          <MiniTable
            empty={(d.proposals || []).length === 0}
            emptyHint="No proposals drafted for this lead."
            head={
              <>
                <Th>Number</Th>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th r>Total</Th>
                <Th>Link</Th>
                <Th>Engagement</Th>
              </>
            }
          >
            {(d.proposals || []).map((p) => (
              <tr key={p.proposal_id}>
                <Td>{cell(p.doc_number)}</Td>
                <Td>
                  {cell(p.title)}
                  {p.ai_generated ? (
                    <Pill tone="blue" className="ml-2">
                      AI draft
                    </Pill>
                  ) : null}
                </Td>
                <Td>
                  <StatusPill status={String(p.status || "")} />
                </Td>
                <Td r>
                  <Money value={p.total} currency={p.currency} />
                </Td>
                <Td>
                  {p.share_live ? (
                    <Pill tone="ok">Live</Pill>
                  ) : (
                    <span className="micro">Not shared</span>
                  )}
                </Td>
                <Td>
                  {p.viewed_at
                    ? `Opened ${dateFmt(p.viewed_at)}${p.downloaded_at ? " · downloaded" : ""}`
                    : "—"}
                </Td>
              </tr>
            ))}
          </MiniTable>
        </>
      )}

      {tab === "Opportunities" && (
        <>
          <MoneyNotice visible={k.money_visible} />
          <MiniTable
            empty={(d.opportunities || []).length === 0}
            emptyHint="This lead has no deals on the pipeline board."
            head={
              <>
                <Th>Deal</Th>
                <Th>Stage</Th>
                <Th>Status</Th>
                <Th r>Value</Th>
                <Th r>Win %</Th>
                <Th r>Weighted</Th>
              </>
            }
          >
            {(d.opportunities || []).map((o) => (
              <tr key={o.opportunity_id}>
                <Td>
                  <Link
                    className="underline-offset-2 hover:underline"
                    to={`/sales/opportunities?focus=${encodeURIComponent(o.opportunity_id)}`}
                  >
                    {cell(o.name)}
                  </Link>
                </Td>
                <Td>{cell(o.stage_name || o.stage_code)}</Td>
                <Td>
                  <StatusPill status={String(o.status || "")} />
                </Td>
                <Td r>
                  <Money value={o.estimated_value} currency={o.currency} />
                </Td>
                <Td r>
                  {o.probability === null || o.probability === undefined
                    ? "—"
                    : `${num(o.probability)}%`}
                  {o.probability_is_manual ? (
                    <Pill tone="mute" className="ml-2">
                      manual
                    </Pill>
                  ) : null}
                </Td>
                <Td r>
                  <Money value={o.weighted_value} currency={o.currency} />
                </Td>
              </tr>
            ))}
          </MiniTable>
        </>
      )}

      {tab === "Enquiries" && (
        <MiniTable
          empty={(d.enquiries || []).length === 0}
          emptyHint="No website enquiries were triaged into this lead."
          head={
            <>
              <Th>Received</Th>
              <Th>Subject</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>Replied</Th>
            </>
          }
        >
          {(d.enquiries || []).map((e) => (
            <tr key={e.contact_enquiry_id}>
              <Td>{dateFmt(e.created_at)}</Td>
              <Td>{cell(e.subject)}</Td>
              <Td>{enumLabel(String(e.enquiry_type ?? "")) || "—"}</Td>
              <Td>
                <StatusPill status={String(e.status || "")} />
              </Td>
              <Td>{e.responded_at ? dateFmt(e.responded_at) : "—"}</Td>
            </tr>
          ))}
        </MiniTable>
      )}

      {tab === "History" && <Timeline entries={d.timeline || []} />}

      <ConvertModal
        lead={converting ? (l as Record<string, unknown>) : null}
        onClose={() => setConverting(false)}
        onDone={() => {
          setConverting(false);
          res.reload();
          onChanged?.();
        }}
      />
    </div>
  );
}

/* ════════════════════════════ INTAKE 360 ════════════════════════════════════ */

const INTAKE_TABS = ["Overview", "Scope", "Attachments", "Proposals", "History"] as const;
type IntakeTab = (typeof INTAKE_TABS)[number];

export function IntakeDossier({
  quoteRequestId,
  titleAs = "h2",
  onEdit,
  onChanged,
  placeholder,
}: {
  quoteRequestId: string;
  titleAs?: "h1" | "h2";
  onEdit?: () => void;
  /** Told when a transition lands, so a register can refresh its index. */
  onChanged?: () => void;
  /** The reference and state from the row just clicked — see `DossierSkeleton`. */
  placeholder?: { title?: string | null; status?: string | null };
}) {
  const [tab, setTab] = React.useState<IntakeTab>("Overview");
  const [converting, setConverting] = React.useState(false);
  const res = useResource<IntakeDossierData>(
    () => tenant<IntakeDossierData>(`/quote-requests/${quoteRequestId}/360`),
    [quoteRequestId],
  );
  const { busy, error: actionError, run } = useTransition(res.reload, onChanged);

  if (res.error) return <ErrorState message={errMsg(res.error)} />;
  if (!res.data)
    return (
      <DossierSkeleton
        titleAs={titleAs}
        tabs={INTAKE_TABS}
        title={placeholder?.title}
        status={placeholder?.status}
      />
    );
  const d = res.data;
  // See the note in LeadDossier: a response missing its record must not throw.
  if (!d.request)
    return <ErrorState message="This request's dossier came back empty." />;
  const q = d.request;
  const k = d.kpis || ({} as IntakeDossierData["kpis"]);

  const status = String(q.status || "RECEIVED");
  const locked = status === "CONVERTED_TO_OPPORTUNITY" || status === "CLOSED_NO_ACTION";
  const next =
    status === "RECEIVED" ? "UNDER_REVIEW"
    : status === "UNDER_REVIEW" || status === "CLARIFICATION_REQUIRED" ? "QUOTED"
    : null;

  const counts: Partial<Record<IntakeTab, number>> = {
    Attachments: d.attachments?.length ?? 0,
    Proposals: d.proposals?.length ?? 0,
    History: d.timeline?.length ?? 0,
  };

  return (
    <div className="space-y-4">
      <DossierHeader
        titleAs={titleAs}
        title={String(q.public_ref || "Quote request")}
        status={q.status as string}
        subtitle={
          [cell(q.requester_company as string), cell(q.requester_name as string), cell(q.requester_email as string)]
            .filter((x) => x !== "—")
            .join(" · ") || "No requester details"
        }
        actions={
          <ActionBar busy={busy} error={actionError}>
            {d.lead ? (
              <Link to={`/sales/leads/${d.lead.lead_id}`}>
                <Button size="sm" variant="outline">
                  Open lead
                </Button>
              </Link>
            ) : null}
            {!locked && next ? (
              <Button
                size="sm"
                variant="outline"
                loading={busy}
                onClick={() => run(`/quote-requests/${quoteRequestId}/transition`, { to: next })}
              >
                {next === "UNDER_REVIEW" ? "Start review" : "Mark quoted"}
              </Button>
            ) : null}
            {status === "QUOTED" ? (
              <Button size="sm" onClick={() => setConverting(true)}>
                Open opportunity
              </Button>
            ) : null}
            {onEdit ? (
              <Button size="sm" variant="outline" onClick={onEdit}>
                Edit
              </Button>
            ) : null}
            {!locked && status !== "QUOTED" ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  run(`/quote-requests/${quoteRequestId}/transition`, { to: "CLOSED_NO_ACTION" })
                }
              >
                Close
              </Button>
            ) : null}
          </ActionBar>
        }
        fields={[
          { label: "Channel", value: enumLabel(String(q.intake_channel ?? "")) || "—" },
          { label: "Service", value: enumLabel(String(q.service_category ?? "")) || "—" },
          { label: "Incoterm", value: cell(q.incoterm as string) },
          { label: "Owner", value: cell(q.owner_name as string) },
          { label: "Logged by", value: cell(q.created_by_name as string) },
          { label: "Corporate entity", value: cell(q.entity_name as string) },
          { label: "Received", value: dateFmt(q.created_at as string) },
          {
            label: "Converted",
            value: k.is_converted ? dateFmt(q.converted_at as string) : "Not converted",
          },
        ]}
      />

      <KpiRow fit="content">
        <KpiTile
          label={k.is_converted ? "Days to convert" : "Days open"}
          value={num(k.age_days)}
        />
        <KpiTile
          label="Attachments"
          value={num(k.attachments)}
          hint={k.has_primary_attachment ? "primary on file" : "no primary document"}
        />
        <KpiTile label="Proposals" value={num(k.proposals)} hint="via the lead" />
        <KpiTile
          label="Converted deal"
          value={
            !k.is_converted
              ? "—"
              : k.converted_value === null
                ? "hidden"
                : moneyCompact(k.converted_value)
          }
          hint={d.converted_opportunity ? cell(d.converted_opportunity.stage_name) : undefined}
        />
      </KpiRow>
      <MoneyNotice visible={k.money_visible} />

      <div className="flex flex-wrap gap-1 border-b">
        {INTAKE_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t}
            {counts[t] != null && <span className="ml-1.5 micro">{counts[t]}</span>}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Where this stands</h4>
            <ul className="space-y-2 text-sm">
              <li>
                {k.is_converted
                  ? `Converted into ${cell(d.converted_opportunity?.name)} after ${k.age_days} day${k.age_days === 1 ? "" : "s"}.`
                  : `Open ${k.age_days} day${k.age_days === 1 ? "" : "s"} at ${enumLabel(String(q.status ?? ""))}.`}
              </li>
              <li>
                {k.attachments > 0
                  ? `${k.attachments} document${k.attachments === 1 ? "" : "s"} on file.`
                  : "No documents attached — the scope below is all there is to price from."}
              </li>
              <li>
                {d.lead
                  ? `Raised by lead ${cell(d.lead.company_name)}.`
                  : "Not linked to a lead — this arrived without one."}
              </li>
            </ul>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Latest activity</h4>
            <Timeline entries={(d.timeline || []).slice(0, 8)} />
          </div>
        </div>
      )}

      {tab === "Scope" && (
        <div className="rounded-xl border bg-card p-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            {[
              { label: "Origin", value: cell(q.origin_location as string) },
              { label: "Destination", value: cell(q.destination_location as string) },
              { label: "Incoterm", value: cell(q.incoterm as string) },
              {
                label: "Estimated weight",
                value: q.estimated_weight ? num(q.estimated_weight as number) : "—",
              },
              {
                label: "Project cargo",
                value: q.project_cargo_flag ? "Yes" : "No",
              },
              { label: "Warehouse", value: cell(q.warehouse_location as string) },
              {
                label: "Warehouse duration",
                value: enumLabel(String(q.warehouse_duration ?? "")) || "—",
              },
              { label: "Requester phone", value: cell(q.requester_phone as string) },
            ].map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="micro">{f.label}</dt>
                <dd className="truncate text-sm text-foreground">{f.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <p className="micro">Cargo description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
              {cell(q.cargo_description as string)}
            </p>
          </div>
        </div>
      )}

      {tab === "Attachments" && (
        <MiniTable
          empty={(d.attachments || []).length === 0}
          emptyHint="Nothing was attached to this request."
          head={
            <>
              <Th>File</Th>
              <Th>Kind</Th>
              <Th>Type</Th>
              <Th>Uploaded by</Th>
              <Th>When</Th>
            </>
          }
        >
          {(d.attachments || []).map((a) => (
            <tr key={a.quote_request_attachment_id}>
              <Td>{cell(a.original_name)}</Td>
              <Td>
                <Pill tone={a.kind === "PRIMARY" ? "blue" : "mute"}>{enumLabel(a.kind)}</Pill>
              </Td>
              <Td>{cell(a.doc_type)}</Td>
              <Td>{cell(a.uploaded_by_name)}</Td>
              <Td>{dateFmt(a.created_at)}</Td>
            </tr>
          ))}
        </MiniTable>
      )}

      {tab === "Proposals" && (
        <>
          <MoneyNotice visible={k.money_visible} />
          <MiniTable
            empty={(d.proposals || []).length === 0}
            emptyHint="No proposals — a quote request reaches proposals through its lead."
            head={
              <>
                <Th>Number</Th>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th r>Total</Th>
              </>
            }
          >
            {(d.proposals || []).map((p) => (
              <tr key={p.proposal_id}>
                <Td>{cell(p.doc_number)}</Td>
                <Td>{cell(p.title)}</Td>
                <Td>
                  <StatusPill status={String(p.status || "")} />
                </Td>
                <Td r>
                  <Money value={p.total} currency={p.currency} />
                </Td>
              </tr>
            ))}
          </MiniTable>
        </>
      )}

      {tab === "History" && <Timeline entries={d.timeline || []} />}

      <ConvertToOpportunityModal
        request={converting ? (q as Record<string, unknown>) : null}
        onClose={() => setConverting(false)}
        onDone={() => {
          setConverting(false);
          res.reload();
          onChanged?.();
        }}
      />
    </div>
  );
}

/* ═════════════════════════ Deep-linkable pages ══════════════════════════════ */

/**
 * `/sales/leads/:leadId` — the same component on its own route.
 *
 * Deep-linkable for the reason entity-360 and treasury-360 are: a dossier gets
 * pasted into an email or a Slack thread, and "open Sales, then Leads, then
 * find Tema Shipping" is not a link.
 */
export function LeadDossierPage() {
  const { leadId = "" } = useParams();
  const navigate = useNavigate();
  return (
    <section className={`${pageShell.wide} space-y-4`}>
      <div className="micro">
        <Link to="/sales/leads" className="text-muted-foreground hover:text-foreground">
          ← Leads
        </Link>
      </div>
      {/* No PageHeader — the lead's own company name is this page's h1. */}
      <LeadDossier
        leadId={leadId}
        titleAs="h1"
        onEdit={() => navigate(`/sales/leads?edit=${leadId}`)}
      />
    </section>
  );
}

/** `/sales/quote-requests/:quoteRequestId` — same, for the intake register. */
export function IntakeDossierPage() {
  const { quoteRequestId = "" } = useParams();
  const navigate = useNavigate();
  return (
    <section className={`${pageShell.wide} space-y-4`}>
      <div className="micro">
        <Link
          to="/sales/quote-requests"
          className="text-muted-foreground hover:text-foreground"
        >
          ← Quote requests
        </Link>
      </div>
      <IntakeDossier
        quoteRequestId={quoteRequestId}
        titleAs="h1"
        onEdit={() => navigate(`/sales/quote-requests?edit=${quoteRequestId}`)}
      />
    </section>
  );
}
