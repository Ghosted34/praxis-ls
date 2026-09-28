/**
 * Lead and quote-request 360s → the KPI tiles open the rows they count.
 *
 * "3 proposals, 1 sent" is a question the tile cannot answer — which three,
 * what did they quote, has the client opened them. Each list tile now opens the
 * shared drill-in dialog (`components/kpi-details-modal`) with those rows, a
 * destination per row, and a way out to the module that owns them.
 *
 * THE ROWS ARE THE PAYLOAD'S. `sales-360.service.js` reads each collection with
 * `LIMIT 25` and computes the tiles FROM those same arrays, so the list here and
 * the number on the tile cannot disagree — both stop at 25. At the cap the
 * dialog says so and points at the module for the rest.
 *
 * WHERE A ROW GOES. A quote request has its own route. Meetings, proposals and
 * deals open as dialogs on their registers, which read `?focus=` for this
 * (`useFocusOpen`). An intake attachment has no page of its own, so it is a row
 * that answers "which files" and goes nowhere — a link to nowhere is worse.
 *
 * WHAT STAYS INERT. "Days open" is an age and "Converted deal" is one deal's
 * value — figures, not lists.
 */
import { Pill, StatusPill } from "@/components/ui/pill";
import { cell, dateFmt, enumLabel, money, num } from "@/lib/format";
import {
  KpiDetailsModal,
  type KpiDetailHeader,
  type KpiDetailRow,
} from "@/components/kpi-details-modal";
import type {
  IntakeDossierData,
  LeadDossierData,
  Meeting360,
  Opportunity360,
  Proposal360,
  QuoteRequest360Row,
} from "./sales-360";

/** The five lead tiles that open something. */
export type LeadKpiKind =
  "meetings" | "quote_requests" | "proposals" | "open_deals" | "pipeline";
/** The two quote-request tiles that open something. */
export type IntakeKpiKind = "attachments" | "proposals";

/** Mirrors `LIMIT` in sales-360.service.js. */
const CAP = 25;
const capHint = (n: number) =>
  n >= CAP
    ? `Showing the ${CAP} most recent — open the module for the rest.`
    : undefined;

const focus = (base: string, id: string) =>
  `${base}?focus=${encodeURIComponent(id)}`;
const MEETINGS = "/sales/meetings";
const QUOTE_REQUESTS = "/sales/quote-requests";
const PROPOSALS = "/sales/proposals";
const OPPORTUNITIES = "/sales/opportunities";

/** Money the viewer may not see arrives as null — a dash, never a zero. */
const maybeMoney = (v: number | null | undefined, cur?: string | null) =>
  v === null || v === undefined ? "—" : money(v, cur || undefined);

type Drill = {
  title: string;
  description: string;
  headers: KpiDetailHeader[];
  rows: KpiDetailRow[];
  empty: string;
  viewAll?: { label: string; href: string };
  moreHint?: string;
};

function proposalsDrill(proposals: Proposal360[], via: string): Drill {
  return {
    title: "Proposals",
    description: `${via} Click a row to open the proposal.`,
    headers: [
      { label: "Number" },
      { label: "Title" },
      { label: "Status" },
      { label: "Total", right: true },
      { label: "Client engagement" },
    ],
    rows: proposals.map((p) => ({
      id: p.proposal_id,
      href: focus(PROPOSALS, p.proposal_id),
      cells: [
        cell(p.doc_number) === "—" ? "Draft" : cell(p.doc_number),
        cell(p.title),
        <StatusPill key="s" status={String(p.status || "")} />,
        maybeMoney(p.total, p.currency),
        p.viewed_at
          ? `Opened ${dateFmt(p.viewed_at)}${p.downloaded_at ? " · downloaded" : ""}`
          : p.share_live
            ? "Shared, not opened"
            : "Not shared",
      ],
    })),
    empty: "No proposals drafted yet.",
    viewAll: { label: "View more in Proposals", href: PROPOSALS },
    moreHint: capHint(proposals.length),
  };
}

function dealsDrill(deals: Opportunity360[], pipeline: boolean): Drill {
  const open = deals.filter((o) => String(o.status || "") === "OPEN");
  // The pipeline figure is the sum of these deals; ranked by what they weigh,
  // the biggest contributors to it come first.
  const ordered = pipeline
    ? [...open].sort(
        (a, b) => Number(b.weighted_value ?? 0) - Number(a.weighted_value ?? 0),
      )
    : open;
  return {
    title: pipeline ? "Open pipeline" : "Open deals",
    description: pipeline
      ? "The open deals that make up the pipeline, largest weighted value first. Click a row to open the deal."
      : "Deals still open on the pipeline board. Click a row to open the deal.",
    headers: [
      { label: "Deal" },
      { label: "Stage" },
      { label: "Value", right: true },
      { label: "Win %", right: true },
      { label: "Weighted", right: true },
    ],
    rows: ordered.map((o) => ({
      id: o.opportunity_id,
      href: focus(OPPORTUNITIES, o.opportunity_id),
      cells: [
        cell(o.name),
        cell(o.stage_name || o.stage_code),
        maybeMoney(o.estimated_value, o.currency),
        o.probability === null || o.probability === undefined
          ? "—"
          : `${num(o.probability)}%`,
        maybeMoney(o.weighted_value, o.currency),
      ],
    })),
    empty: "Nothing is open on the pipeline board for this lead.",
    viewAll: { label: "View more in Opportunities", href: OPPORTUNITIES },
    moreHint: capHint(deals.length),
  };
}

function leadDrill(kind: LeadKpiKind, d: LeadDossierData): Drill {
  if (kind === "meetings") {
    const meetings: Meeting360[] = d.meetings || [];
    return {
      title: "Meetings",
      description:
        "Meetings captured against this lead, newest first. Click a row to open the meeting.",
      headers: [
        { label: "When" },
        { label: "Subject" },
        { label: "Location" },
        { label: "Organiser" },
        { label: "Discovery" },
      ],
      rows: meetings.map((m) => ({
        id: m.meeting_id,
        href: focus(MEETINGS, m.meeting_id),
        cells: [
          dateFmt(m.scheduled_at || m.created_at),
          cell(m.subject),
          cell(m.location),
          cell(m.organiser_name),
          m.sections.length === 0
            ? "Not started"
            : `${num(m.sections.filter((s) => s.has_body).length)} of ${num(m.sections.length)} sections`,
        ],
      })),
      empty: "No meetings captured against this lead.",
      viewAll: { label: "View more in Meetings", href: MEETINGS },
      moreHint: capHint(meetings.length),
    };
  }
  if (kind === "quote_requests") {
    const qrs: QuoteRequest360Row[] = d.quote_requests || [];
    return {
      title: "Quote requests",
      description:
        "Quote requests from this lead, newest first. Click a row to open the request.",
      headers: [
        { label: "Reference" },
        { label: "Status" },
        { label: "Route" },
        { label: "Incoterm" },
        { label: "Received" },
      ],
      rows: qrs.map((q) => ({
        id: q.quote_request_id,
        href: `${QUOTE_REQUESTS}/${encodeURIComponent(q.quote_request_id)}`,
        cells: [
          cell(q.public_ref),
          <StatusPill key="s" status={String(q.status || "")} />,
          [cell(q.origin_location), cell(q.destination_location)]
            .filter((x) => x !== "—")
            .join(" → ") || "—",
          cell(q.incoterm),
          dateFmt(q.created_at),
        ],
      })),
      empty: "No quote requests from this lead.",
      viewAll: { label: "View more in Quote requests", href: QUOTE_REQUESTS },
      moreHint: capHint(qrs.length),
    };
  }
  if (kind === "proposals") {
    return proposalsDrill(
      d.proposals || [],
      "Proposals drafted for this lead.",
    );
  }
  return dealsDrill(d.opportunities || [], kind === "pipeline");
}

function intakeDrill(kind: IntakeKpiKind, d: IntakeDossierData): Drill {
  if (kind === "proposals") {
    return proposalsDrill(
      d.proposals || [],
      "Proposals reach a quote request through its lead, so these are the lead's.",
    );
  }
  const files = d.attachments || [];
  return {
    title: "Attachments",
    description:
      "The files attached to this request — the primary document first.",
    headers: [
      { label: "File" },
      { label: "Role" },
      { label: "Type" },
      { label: "Uploaded by" },
      { label: "Date" },
    ],
    rows: files.map((a) => ({
      id: a.quote_request_attachment_id,
      cells: [
        cell(a.original_name),
        a.kind === "PRIMARY" ? (
          <Pill key="k" tone="ok">
            Primary
          </Pill>
        ) : (
          enumLabel(a.kind)
        ),
        cell(a.doc_type),
        cell(a.uploaded_by_name),
        dateFmt(a.created_at),
      ],
    })),
    empty: "Nothing is attached to this request yet.",
  };
}

function DrillModal({
  drill,
  subject,
  onClose,
}: {
  drill: Drill;
  subject: string;
  onClose: () => void;
}) {
  return (
    <KpiDetailsModal
      open
      onClose={onClose}
      title={`${drill.title} · ${subject}`}
      description={drill.description}
      headers={drill.headers}
      rows={drill.rows}
      emptyLabel={drill.empty}
      moreHint={drill.moreHint}
      viewAll={drill.viewAll}
    />
  );
}

/** The drill-in for a lead 360 tile. Mounted only while open. */
export function LeadKpiDrill({
  kind,
  data,
  onClose,
}: {
  kind: LeadKpiKind;
  data: LeadDossierData;
  onClose: () => void;
}) {
  return (
    <DrillModal
      drill={leadDrill(kind, data)}
      subject={String(data.lead.company_name || "Lead")}
      onClose={onClose}
    />
  );
}

/** The drill-in for a quote-request 360 tile. Mounted only while open. */
export function IntakeKpiDrill({
  kind,
  data,
  onClose,
}: {
  kind: IntakeKpiKind;
  data: IntakeDossierData;
  onClose: () => void;
}) {
  return (
    <DrillModal
      drill={intakeDrill(kind, data)}
      subject={String(data.request.public_ref || "Quote request")}
      onClose={onClose}
    />
  );
}
