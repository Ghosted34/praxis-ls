/**
 * KPI drill-downs — pure builders, one per Control Tower card.
 *
 * There is no dedicated drill-down endpoint and none is needed: every figure
 * here comes from a list the user is already entitled to read. Any source that
 * 403s (fleet is feature-gated, reports likewise) yields an empty drill-down
 * with an explanatory message rather than breaking the tower.
 *
 * WHAT CHANGED FROM THE IFRAME BUILD. The old builders returned HTML strings
 * with deliberate `<b>` markup, so every interpolated database value had to go
 * through a hand-written `escHtml` before being injected with `innerHTML` into a
 * frame running `allow-scripts allow-same-origin` — which the HTML spec
 * documents as effectively no sandbox at all. These return DATA. React escapes
 * it, `escHtml` is gone, and the whole class of bug goes with it.
 */
import type { Tone } from "@/components/ui/pill";
import { dateFmt } from "@/lib/format";
import { daysBetween, grouped, isLockedFinal, str, type Row } from "./model";

export type DrillCell = string | { text: string; tone: Tone };
export type DrillColumn = { label: string; align?: "right" };
export type DrillRow = { key: string; cells: DrillCell[] };

export type Drill = {
  title: string;
  badge: { tone: Tone; text: string };
  /** Headline figures above the table. */
  meta: { label: string; value: string }[];
  columns: DrillColumn[];
  rows: DrillRow[];
  /** Stated basis when the table ranks a sample rather than the whole set. */
  note?: string;
  cta: { label: string; to: string };
  empty: { title: string; hint: string };
};

/**
 * Where each card's CTA sends the user — keyed by CATALOG id now that the band
 * carries more than the original four. The old card keys (`sla`, `overdue`,
 * `fleet`) are gone deliberately: one name for a tile, from the catalog to the
 * drill to the route, because an alias table between the band's ids and the
 * drill's ids is a second source of truth waiting for the first divergence.
 */
export const KPI_ROUTE: Record<string, string> = {
  revenue: "/finance/invoices",
  receivables_overdue: "/finance/receivables",
  sla_on_time: "/operations/files",
  fleet_utilisation: "/fleet",
  proformas_open: "/finance/proformas",
  journals_unposted: "/finance/journals",
  files_active: "/operations/files",
  approvals_awaiting: "/approvals",
  compliance_open: "/vault/compliance-flags",
  needs_location: "/operations/files",
  // Human Capital (PR-4) — the module hubs the tiles drill into.
  headcount: "/hr/employees",
  attendance_today: "/hr/attendance",
  leave_pending: "/hr/leave",
  vacancies_open: "/hr/vacancies",
  payroll_run_state: "/hr/payroll",
  attrition_90d: "/hr/employees",
  // Operations, Fleet & Warehouse (PR-2) — folded in from the temporary
  // KPI_ROUTE_PR2 table now that the three domain PRs have all landed and
  // there is no longer a parallel branch whose lines this would collide with.
  late_vs_eta: "/operations/files",
  dwell_days: "/operations/milestones",
  fleet_docs_expiring: "/fleet/compliance",
  work_orders_open: "/fleet/work-orders",
  warehouse_occupancy: "/wms",
  // Money and Sales & Procurement (PR-3).
  cash_collected: "/finance/receivables",
  payables_overdue: "/finance/debt",
  cash_requests_awaiting: "/costing/cash-requests",
  margin_closed: "/commercial/margin-simulation",
  dso: "/finance/receivables",
  pipeline_won: "/sales/opportunities",
  quote_requests_open: "/sales/quote-requests",
  pos_in_flight: "/procurement/purchase-orders",
  purchase_requests: "/procurement/purchase-requests",
};

/** Catalog tile ids are the drill ids; anything else opens no drill. */
export type KpiId = string;

export type ClientNames = Record<string, string>;

/**
 * Revenue → locked FINAL invoices, ranked by client.
 *
 * `authoritativeTotal` comes from `/dashboard/kpis`, which is a SQL SUM over
 * every locked FINAL invoice. The rows come from `/final-invoices`, which the
 * API clamps to 200. Those two can disagree on a tenant with more than 200
 * invoices, and quietly showing a ranking that sums to less than the headline is
 * exactly the kind of unreconciled pair the receivables card was rebuilt to
 * avoid. So the headline stays authoritative, the shares are computed over what
 * was actually read, and `note` states the basis when the two differ.
 */
export function buildRevenueDrill(
  invoices: Row[] | null,
  clientName: ClientNames,
  currency: string,
  authoritativeTotal: number | null,
  availableCount: number,
): Drill {
  const finals = (invoices || []).filter(isLockedFinal);
  const byClient = new Map<string, { total: number; count: number }>();
  finals.forEach((r) => {
    const key = str(r.client_id) || "—";
    const prev = byClient.get(key) || { total: 0, count: 0 };
    byClient.set(key, {
      total: prev.total + (Number(r.total_ttc) || 0),
      count: prev.count + 1,
    });
  });
  const scannedTotal = finals.reduce(
    (s, r) => s + (Number(r.total_ttc) || 0),
    0,
  );
  const ranked = [...byClient.entries()].sort(
    (a, b) => b[1].total - a[1].total,
  );
  const headline = authoritativeTotal ?? scannedTotal;
  const sampled = availableCount > (invoices || []).length;

  return {
    title: "Revenue · locked invoices",
    badge: {
      tone: "orange",
      text: `${finals.length} locked invoice${finals.length === 1 ? "" : "s"}`,
    },
    meta: [
      { label: "Revenue", value: `${grouped(headline)} ${currency}` },
      { label: "Locked invoices", value: String(finals.length) },
      { label: "Clients", value: String(ranked.length) },
      ...(ranked.length
        ? [{ label: "Top", value: clientName[ranked[0][0]] || "Unattributed" }]
        : []),
    ],
    columns: [
      { label: "Client" },
      { label: "Invoices", align: "right" },
      { label: currency, align: "right" },
      { label: "Share", align: "right" },
    ],
    rows: ranked.slice(0, 8).map(([id, v]) => ({
      key: id,
      cells: [
        clientName[id] || "Unattributed",
        String(v.count),
        grouped(v.total),
        scannedTotal > 0
          ? `${Math.round((v.total / scannedTotal) * 100)}%`
          : "—",
      ],
    })),
    note: sampled
      ? `Ranked over the ${(invoices || []).length} most recent invoices of ${availableCount}. The revenue figure above covers all of them.`
      : undefined,
    cta: { label: "Open invoices", to: KPI_ROUTE.revenue },
    empty: {
      title: "No revenue posted yet",
      hint: "Revenue lands here as final invoices are issued and locked.",
    },
  };
}

/** SLA → dossiers with both an ETA and an ATA. Late ones surface first, worst
 *  slip at the top: that is what a controller opens this card to see. */
export function buildSlaDrill(dossiers: Row[] | null): Drill {
  const measured = (dossiers || []).filter((d) => d.eta && d.ata);
  const scored = measured.map((d) => {
    const slip = daysBetween(new Date(str(d.eta)), new Date(str(d.ata)));
    return { d, slip, onTime: slip <= 0 };
  });
  const late = scored.filter((s) => !s.onTime);
  const pct = measured.length
    ? Math.round(((measured.length - late.length) / measured.length) * 100)
    : null;
  const route = (d: Row) =>
    [str(d.pol), str(d.pod)].filter(Boolean).join(" → ") || "—";

  return {
    title: "On-time delivery",
    badge: {
      tone: late.length ? "warn" : "ok",
      text: `${measured.length} arrival${measured.length === 1 ? "" : "s"} measured`,
    },
    meta: [
      { label: "On time", value: pct === null ? "—" : `${pct}%` },
      { label: "Measured", value: String(measured.length) },
      { label: "Late", value: String(late.length) },
    ],
    columns: [
      { label: "File" },
      { label: "Route" },
      { label: "ETA" },
      { label: "Result" },
    ],
    rows: [
      ...late.sort((a, b) => b.slip - a.slip),
      ...scored.filter((s) => s.onTime),
    ]
      .slice(0, 8)
      .map((s) => ({
        key: str(s.d.dossier_id) || str(s.d.ref),
        cells: [
          str(s.d.ref),
          route(s.d),
          dateFmt(s.d.eta),
          {
            text: s.onTime
              ? "On time"
              : `${s.slip} day${s.slip === 1 ? "" : "s"} late`,
            tone: (s.onTime ? "ok" : s.slip > 3 ? "bad" : "warn") as Tone,
          },
        ],
      })),
    cta: { label: "Open operations files", to: KPI_ROUTE.sla_on_time },
    empty: {
      title: "No arrivals recorded yet",
      hint: "An on-time rate needs both an ETA and an ATA on an operations file.",
    },
  };
}

/**
 * Overdue → `GET /receivables/overdue`.
 *
 * Amounts are `outstanding` (total_ttc net of payment_allocation), the same
 * basis as the KPI card's total, so these rows sum to the headline figure by
 * construction. That reconciliation was the point of MOD-52: previously the card
 * came from the ageing buckets (net of receipts) and the list from raw invoices
 * (not), and they could disagree on screen.
 */
export function buildOverdueDrill(
  payload: {
    total?: number;
    count?: number;
    clients?: number;
    invoices?: Row[];
  } | null,
  clientName: ClientNames,
  currency: string,
): Drill {
  const invoices = payload?.invoices || [];
  const oldest = invoices.length ? Number(invoices[0].days_overdue) || 0 : 0;

  return {
    title: "Receivables · past due",
    badge: { tone: "warn", text: "Outstanding past due date" },
    meta: [
      {
        label: "Outstanding",
        value: `${grouped(Number(payload?.total) || 0)} ${currency}`,
      },
      { label: "Invoices", value: String(payload?.count ?? invoices.length) },
      { label: "Clients", value: String(payload?.clients ?? 0) },
      ...(invoices.length
        ? [{ label: "Oldest", value: `${oldest} days` }]
        : []),
    ],
    columns: [
      { label: "Invoice" },
      { label: "Client" },
      { label: currency, align: "right" },
      { label: "Age" },
    ],
    rows: invoices.slice(0, 8).map((r) => {
      const age = Number(r.days_overdue) || 0;
      return {
        key: str(r.invoice_id) || str(r.doc_number),
        cells: [
          str(r.doc_number) || str(r.invoice_id).slice(0, 8),
          clientName[str(r.client_id)] || "—",
          grouped(Number(r.outstanding) || 0),
          { text: `${age} days`, tone: (age > 30 ? "bad" : "warn") as Tone },
        ],
      };
    }),
    cta: { label: "Open receivables", to: KPI_ROUTE.receivables_overdue },
    empty: {
      title: "Nothing past due",
      hint: "Every locked invoice is within its payment terms.",
    },
  };
}

/** Fleet → the vehicle register (feature-gated `fleet`; empty when off). */
export function buildFleetDrill(vehicles: Row[] | null): Drill {
  const all = vehicles || [];
  const active = all.filter((v) => str(v.status).toUpperCase() === "ACTIVE");

  return {
    title: "Fleet utilisation",
    badge: { tone: "blue", text: `${active.length} of ${all.length} active` },
    meta: [
      { label: "Active", value: String(active.length) },
      { label: "Fleet size", value: String(all.length) },
      {
        label: "Utilisation",
        value: all.length
          ? `${Math.round((active.length / all.length) * 100)}%`
          : "—",
      },
    ],
    columns: [{ label: "Vehicle" }, { label: "Category" }, { label: "Status" }],
    rows: all.slice(0, 8).map((v) => ({
      key: str(v.vehicle_id) || str(v.registration),
      cells: [
        str(v.registration) || str(v.vehicle_id).slice(0, 8),
        str(v.category) || "—",
        {
          text: str(v.status) || "—",
          tone: (str(v.status).toUpperCase() === "ACTIVE"
            ? "blue"
            : "mute") as Tone,
        },
      ],
    })),
    cta: { label: "Open fleet", to: KPI_ROUTE.fleet_utilisation },
    empty: {
      title: "No vehicles visible",
      hint: "The fleet module may be switched off for this tenant, or you may not have the grant to read it.",
    },
  };
}

/* ── the band's second six (PR-1 tiles whose counts already existed) ─────────
 *
 * Same contract as the four originals — data in, a `Drill` out, React escapes
 * it, no HTML strings — and the same honesty rule: a source that failed shows
 * its failure in `empty`, and rows are a scan of the list the caller can
 * already read (the count headline above them stays authoritative because it
 * is the SQL aggregate, not this page).
 */

/** Operations · active → the open work, the one number that needs no source
 *  beyond the dossier list the SLA card already pulls. */
export function buildFilesActiveDrill(dossiers: Row[] | null): Drill {
  const open = (dossiers || []).filter((d) => {
    const s = str(d.status).toUpperCase();
    return s === "OPEN" || s === "IN_PROGRESS";
  });
  const inProgress = open.filter((d) => str(d.status).toUpperCase() === "IN_PROGRESS").length;
  return {
    title: "Active operations files",
    badge: { tone: "blue", text: `${open.length} active` },
    meta: [
      { label: "Active", value: String(open.length) },
      { label: "In progress", value: String(inProgress) },
      { label: "Not started", value: String(open.length - inProgress) },
    ],
    columns: [
      { label: "File" },
      { label: "Route" },
      { label: "Status" },
      { label: "Opened", align: "right" },
    ],
    rows: open.slice(0, 8).map((d) => ({
      key: str(d.dossier_id) || str(d.ref),
      cells: [
        str(d.ref) || str(d.dossier_id).slice(0, 8),
        [str(d.pol), str(d.pod)].filter(Boolean).join(" → ") || "—",
        {
          text: str(d.status).toUpperCase() === "IN_PROGRESS" ? "In progress" : "Open",
          tone: (str(d.status).toUpperCase() === "IN_PROGRESS" ? "blue" : "mute") as Tone,
        },
        dateFmt(d.created_at),
      ],
    })),
    cta: { label: "Open operations files", to: KPI_ROUTE.files_active },
    empty: {
      title: "Nothing moving",
      hint: "No files are open or in progress right now.",
    },
  };
}

/** Location queue → files the map cannot honestly plot, straight from the
 *  tower's own filtered read (`?verified=UNVERIFIED`), so the drill and the
 *  map's badge agree by construction, not by a re-derived heuristic. */
export function buildNeedsLocationDrill(shipments: Row[] | null): Drill {
  const list = shipments || [];
  return {
    title: "Files that need a verified place",
    badge: { tone: "warn", text: `${list.length} in the queue` },
    meta: [{ label: "Needs a location", value: String(list.length) }],
    columns: [{ label: "File" }, { label: "Origin named" }, { label: "Destination named" }, { label: "Status" }],
    rows: list.slice(0, 8).map((d) => ({
      key: str(d.dossier_id) || str(d.ref),
      cells: [
        str(d.ref) || str(d.dossier_id).slice(0, 8),
        str(d.origin) || "—",
        str(d.destination) || "—",
        str(d.status) || "—",
      ],
    })),
    cta: { label: "Open operations files", to: KPI_ROUTE.needs_location },
    empty: {
      title: "The map can plot everything",
      hint: "Every file with named endpoints resolves to a verified place.",
    },
  };
}

/** Approvals · awaiting → the runtime queue (`/approvals` — the rows are
 *  already narrowed to what the caller could act on; the count on the tile is
 *  tenant-wide, so the note says which scan this is). */
export function buildApprovalsDrill(rows: Row[] | null): Drill {
  const list = rows || [];
  return {
    title: "Approvals awaiting",
    badge: { tone: "orange", text: `${list.length} open task${list.length === 1 ? "" : "s"}` },
    meta: [{ label: "Pending", value: String(list.length) }],
    columns: [{ label: "Record" }, { label: "Module" }, { label: "Raised", align: "right" }],
    rows: list.slice(0, 8).map((r) => ({
      key: str(r.task_id) || str(r.entity_ref),
      cells: [
        str(r.entity_ref) || str(r.workflow_id).slice(0, 8) || "—",
        str(r.module_key) || "—",
        dateFmt(r.created_at),
      ],
    })),
    cta: { label: "Open approvals", to: KPI_ROUTE.approvals_awaiting },
    empty: {
      title: "Nothing waiting",
      hint: "No approval task is pending — or the approvals queue is not yours to open.",
    },
  };
}

/** Compliance · open flags → the vault's flag list (`/compliance`), severity
 *  first because that is what the register is for. */
export function buildComplianceDrill(rows: Row[] | null): Drill {
  const list = rows || [];
  const sevTone = (s: string): Tone =>
    s === "HIGH" || s === "CRITICAL" ? "bad" : s === "MEDIUM" ? "warn" : "mute";
  return {
    title: "Open compliance flags",
    badge: { tone: "bad", text: `${list.length} unresolved` },
    meta: [
      { label: "Open flags", value: String(list.length) },
      {
        label: "High",
        value: String(list.filter((r) => sevTone(str(r.severity).toUpperCase()) === "bad").length),
      },
    ],
    columns: [{ label: "Flag" }, { label: "Severity" }, { label: "Raised", align: "right" }],
    rows: list.slice(0, 8).map((r) => ({
      key: str(r.flag_id) || String(r.id ?? ""),
      cells: [
        str(r.title) || str(r.note).slice(0, 48) || str(r.flag_id).slice(0, 8) || "—",
        { text: str(r.severity).toUpperCase() || "—", tone: sevTone(str(r.severity).toUpperCase()) },
        dateFmt(r.created_at),
      ],
    })),
    cta: { label: "Open the register", to: KPI_ROUTE.compliance_open },
    empty: {
      title: "No open flags",
      hint: "Nothing is unresolved in the compliance register right now.",
    },
  };
}

/** Proformas · open → the advances/proforma list. `kpis().proformas` counts
 *  ALL proformas, so the headline stays the aggregate and the table shows
 *  the recent ones with their money. */
export function buildProformasDrill(rows: Row[] | null, currency: string, authoritativeCount: number | null): Drill {
  const list = rows || [];
  const total = list.reduce((s, r) => s + (Number(r.total_ttc ?? r.amount) || 0), 0);
  return {
    title: "Proforma invoices",
    badge: {
      tone: "blue",
      text: `${authoritativeCount ?? list.length} issued`,
    },
    meta: [
      { label: "Proformas", value: String(authoritativeCount ?? list.length) },
      { label: `Value (page)`, value: `${grouped(total)} ${currency}` },
    ],
    columns: [
      { label: "Document" },
      { label: "Status" },
      { label: currency, align: "right" },
    ],
    rows: list.slice(0, 8).map((r) => ({
      key: str(r.advance_id) || str(r.doc_number),
      cells: [
        str(r.doc_number) || str(r.advance_id).slice(0, 8),
        str(r.status) || "—",
        grouped(Number(r.total_ttc ?? r.amount) || 0),
      ],
    })),
    note:
      list.length && authoritativeCount !== null && authoritativeCount > list.length
        ? `Ranked over the ${list.length} most recent of ${authoritativeCount}.`
        : undefined,
    cta: { label: "Open proformas", to: KPI_ROUTE.proformas_open },
    empty: {
      title: "No proformas issued",
      hint: "Proforma invoices land here as commercial quotes are raised.",
    },
  };
}

/** Journals · unposted → draft journal entries, the accounting backlog the
 *  briefing has long mentioned in passing. */
export function buildJournalsDrill(rows: Row[] | null): Drill {
  const drafts = (rows || []).filter((r) => str(r.status).toLowerCase() === "draft");
  return {
    title: "Unposted journal entries",
    badge: { tone: "mute", text: `${drafts.length} draft${drafts.length === 1 ? "" : "s"}` },
    meta: [
      { label: "Drafts", value: String(drafts.length) },
      { label: "Of which today", value: String(drafts.filter((r) => str(r.posted_date || r.created_at).startsWith(new Date().toISOString().slice(0, 10))).length) },
    ],
    columns: [{ label: "Entry" }, { label: "Date" }, { label: "Status" }],
    rows: drafts.slice(0, 8).map((r) => ({
      key: str(r.journal_entry_id) || str(r.entry_number) || String(r.id ?? ""),
      cells: [
        str(r.entry_number) || str(r.journal_entry_id).slice(0, 8) || "—",
        dateFmt(r.posted_date ?? r.created_at),
        str(r.status) || "—",
      ],
    })),
    cta: { label: "Open journals", to: KPI_ROUTE.journals_unposted },
    empty: {
      title: "Ledger is current",
      hint: "No draft journal entries — everything raised has been posted.",
    },
  };
}

/* ── PR-2: Operations, Fleet & Warehouse (guide §12) ─────────────────────────
 *
 * Same contract as everything above: data in, a `Drill` out, one page cap
 * (200) per the existing pattern, and the count on the tile stays the SQL
 * aggregate — these tables are the scan behind it. The 403 rule holds too: the
 * builders never see an error, because `useKpiDrilldown` returns the source's
 * error BEFORE calling them, so a user without the grant reads "you don't have
 * permission", never an empty-state that sounds like "all clear".
 *
 * `stock_value` has no builder on purpose: it is still hidden (no cost column
 * on `inventory_item` — see the catalog entry) and a drill for a tile that
 * cannot paint would be the two-place lie the band exists to end.
 */

/** Route for a tile id, or null when the tile opens no hub. One table again:
 *  `KPI_ROUTE_PR2` was a merge-ordering device, not a second vocabulary, and
 *  two route tables are two places to look when a drill sends you nowhere. */
export function kpiRoute(id: string): string | null {
  return KPI_ROUTE[id] ?? null;
}

const dayNoun = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Start of today in the browser's clock, for a DATE-typed ETA comparison —
 *  the server counts `eta < CURRENT_DATE`, so a file due today is not late. */
const startOfToday = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/**
 * Past ETA · undelivered → open files whose ETA is behind us with no ATA.
 * Same predicate as the tile's SQL (`status ∈ {OPEN, IN_PROGRESS} ∧ eta <
 * today ∧ ata IS NULL`), most overdue first — the one a controller phones
 * about before the others.
 */
export function buildLateVsEtaDrill(dossiers: Row[] | null, now: Date = new Date()): Drill {
  const today = startOfToday(now);
  const late = (dossiers || [])
    .filter((d) => {
      const s = str(d.status).toUpperCase();
      if (s !== "OPEN" && s !== "IN_PROGRESS") return false;
      if (!d.eta || d.ata) return false;
      const eta = new Date(str(d.eta));
      return !Number.isNaN(eta.getTime()) && eta < today;
    })
    .map((d) => ({ d, days: daysBetween(new Date(str(d.eta)), today) }))
    .sort((a, b) => b.days - a.days);
  const worst = late.length ? late[0].days : 0;
  return {
    title: "Past ETA · undelivered",
    badge: { tone: late.length ? "bad" : "ok", text: `${late.length} late` },
    meta: [
      { label: "Past ETA", value: String(late.length) },
      { label: "Over a week", value: String(late.filter((l) => l.days > 7).length) },
      ...(late.length ? [{ label: "Worst", value: dayNoun(worst) }] : []),
    ],
    columns: [{ label: "File" }, { label: "Route" }, { label: "ETA" }, { label: "Overdue by", align: "right" }],
    rows: late.slice(0, 8).map(({ d, days }) => ({
      key: str(d.dossier_id) || str(d.ref),
      cells: [
        str(d.ref) || str(d.dossier_id).slice(0, 8),
        [str(d.pol), str(d.pod)].filter(Boolean).join(" → ") || "—",
        dateFmt(d.eta),
        { text: dayNoun(days), tone: (days > 7 ? "bad" : "warn") as Tone },
      ],
    })),
    cta: { label: "Open operations files", to: KPI_ROUTE.late_vs_eta },
    empty: {
      title: "Nothing past its ETA",
      hint: "Every open file with an ETA is either not due yet or already has an arrival recorded.",
    },
  };
}

/* ── Human Capital (PR-4, guide §5.5/D12) — the six HR tiles ────────────────
 *
 * Same contract as everything above: data from a list the caller can already
 * read (the `/employees`, `/attendance`, `/leave`, `/vacancies` and `/payroll`
 * pages, one API page each), a `Drill` out, and an honest `note` whenever the
 * table is a scan rather than the aggregate the tile counted.
 */

/** Payroll's terminal states — the client mirror of the tile's SQL predicate
 *  (`status NOT IN ('DISBURSED','REJECTED')`), kept beside the builder so the
 *  headline and the drill's "in flight" count cannot drift. */
const PAYROLL_TERMINAL = new Set(["DISBURSED", "REJECTED"]);

/** A payroll status pill — the state machine's stages, coloured the way the
 *  payroll hub colours them. */
function payrollStatusTone(status: string): Tone {
  if (status === "DISBURSED" || status === "VALIDATED") return "ok";
  if (status === "REJECTED") return "bad";
  if (status === "SUBMITTED" || status === "APPROVED") return "warn";
  return "blue";
}

/** Headcount → the active staff register (`/employees?active=true`).
 *
 *  The register's list endpoint carries no `meta.total` (it predates the
 *  shared kit's paged shape), so this drill is an honest PAGE SCAN, like the
 *  proformas one: the figures count the page, and the note names the basis
 *  when the page sits at its cap — never a total the endpoint never sent.
 */
export function buildHeadcountDrill(employees: Row[] | null): Drill {
  const list = employees || [];
  const departments = new Set(
    list.map((e) => str(e.department).trim()).filter(Boolean),
  );
  return {
    title: "Active employees",
    badge: { tone: "blue", text: `${list.length} active` },
    meta: [
      { label: "Active (page)", value: String(list.length) },
      { label: "Departments", value: String(departments.size) },
    ],
    columns: [
      { label: "Employee" },
      { label: "Department" },
      { label: "Job title" },
    ],
    rows: list.slice(0, 8).map((e) => ({
      key: str(e.employee_id) || str(e.full_name),
      cells: [
        str(e.full_name) || str(e.employee_id).slice(0, 8) || "—",
        str(e.department) || "—",
        str(e.job_title) || "—",
      ],
    })),
    note:
      list.length >= 200
        ? "The table lists the 200 most recent active employees; the tile's headcount covers the whole register."
        : undefined,
    cta: { label: "Open the staff register", to: KPI_ROUTE.headcount },
    empty: {
      title: "No active employees",
      hint: "The staff register is empty — add employees and the headcount follows.",
    },
  };
}

/**
 * Dwell → the milestone engine's delay attribution (`/milestones/attribution`),
 * which is the closest read the module exposes to "where does the time go":
 * settled slips by owner tier. The headline days come from the tile (the
 * anchor→target-lock average), so the caller passes it through; the table
 * explains it, it does not recompute it.
 */
export function buildDwellDrill(
  attribution: { by_tier?: Row[]; by_stage?: Row[] } | null,
  dwellDays: number | null,
): Drill {
  const tiers = attribution?.by_tier || [];
  const stages = attribution?.by_stage || [];
  const totalHours = tiers.reduce((s, t) => s + (Number(t.total_hours) || 0), 0);
  const tierName = (t: string) =>
    ({ INTERNAL: "Internal", CARRIER: "Carrier", TERMINAL: "Terminal", AUTHORITY: "Authority", CLIENT: "Client" })[t] || t || "—";
  return {
    title: "Dwell · arrival to delivery",
    badge: { tone: "mute", text: dwellDays === null ? "No delivery measured" : `${dayNoun(dwellDays)} average` },
    meta: [
      { label: "Average dwell", value: dwellDays === null ? "—" : dayNoun(dwellDays) },
      { label: "Slips attributed", value: String(tiers.reduce((s, t) => s + (Number(t.slips) || 0), 0)) },
      { label: "Hours lost", value: String(Math.round(totalHours)) },
    ],
    columns: [{ label: "Stage" }, { label: "Charged to" }, { label: "Slips", align: "right" }, { label: "Avg hours", align: "right" }],
    rows: stages.slice(0, 8).map((r, i) => ({
      key: `${str(r.code)}-${str(r.owner_tier)}-${i}`,
      cells: [
        str(r.label) || str(r.code) || "—",
        tierName(str(r.owner_tier).toUpperCase()),
        String(Number(r.slips) || 0),
        String(Number(r.avg_hours) || 0),
      ],
    })),
    note: stages.length ? "Slips are settled milestone variances; force-majeure stays counted, never netted away." : undefined,
    cta: { label: "Open milestones", to: KPI_ROUTE.dwell_days },
    empty: {
      title: "No slips to attribute",
      hint: "Attribution fills in as milestones complete late and are charged to a tier.",
    },
  };
}

/**
 * Attendance · today → the day's punches (`/attendance?date=<today>`).
 *
 * The tile carries the pair the drill cannot re-derive from one page: how many
 * people were EXPECTED (the roster's working days, minus leave and holidays)
 * is a server-side fact. The table is the raw punch log — distinct employees,
 * not punch rows, because a person who badges in and out is one present, not
 * two.
 */
export function buildAttendanceDrill(punches: Row[] | null): Drill {
  const list = punches || [];
  const byEmployee = new Map<string, Row>();
  list.forEach((p) => {
    const key = str(p.employee_id) || str(p.employee_name) || String(p.attendance_id ?? "");
    if (!key || !byEmployee.has(key)) byEmployee.set(key, p);
  });
  const present = [...byEmployee.values()];
  const stillIn = present.filter((p) => !p.clock_out_at).length;
  return {
    title: "Attendance · today",
    badge: {
      tone: "ok",
      text: `${present.length} clocked in`,
    },
    meta: [
      { label: "Clocked in", value: String(present.length) },
      { label: "Punches", value: String(list.length) },
      { label: "Still clocked in", value: String(stillIn) },
    ],
    columns: [
      { label: "Employee" },
      { label: "Department" },
      { label: "Clock in" },
      { label: "Clock out" },
    ],
    rows: present.slice(0, 8).map((p) => ({
      key: str(p.attendance_id) || str(p.employee_id),
      cells: [
        str(p.employee_name) || str(p.employee_id).slice(0, 8) || "—",
        str(p.department) || "—",
        p.clock_in_at ? dateFmt(p.clock_in_at) : "—",
        p.clock_out_at ? dateFmt(p.clock_out_at) : { text: "In", tone: "ok" as Tone },
      ],
    })),
    note:
      list.length >= 200
        ? "The table lists the 200 most recent punches of the day."
        : undefined,
    cta: { label: "Open attendance", to: KPI_ROUTE.attendance_today },
    empty: {
      title: "Nobody has clocked in yet",
      hint: "Punches land here as the team badges in. The tile's expected count comes from the roster's working days.",
    },
  };
}

/**
 * Fleet docs → `/vehicle-compliance/expiring?days=30`, the same window and the
 * same "lapsed counts too" rule as the tile's SQL. Lapsed first, then soonest.
 */
export function buildFleetDocsDrill(rows: Row[] | null): Drill {
  const list = [...(rows || [])].sort((a, b) => (Number(a.days_left) || 0) - (Number(b.days_left) || 0));
  const lapsed = list.filter((r) => (Number(r.days_left) || 0) < 0).length;
  const kindName = (k: string) =>
    ({ INSURANCE: "Insurance", VISITE_TECHNIQUE: "Technical inspection" })[k] || k || "—";
  return {
    title: "Fleet documents · expiring within 30 days",
    badge: { tone: lapsed ? "bad" : list.length ? "warn" : "ok", text: `${list.length} to renew` },
    meta: [
      { label: "Expiring", value: String(list.length) },
      { label: "Already lapsed", value: String(lapsed) },
      { label: "Vehicles", value: String(new Set(list.map((r) => str(r.vehicle_id))).size) },
    ],
    columns: [{ label: "Vehicle" }, { label: "Document" }, { label: "Expires" }, { label: "Status" }],
    rows: list.slice(0, 8).map((r) => {
      const left = Number(r.days_left) || 0;
      return {
        key: str(r.compliance_id) || `${str(r.vehicle_id)}-${str(r.kind)}`,
        cells: [
          str(r.registration) || str(r.vehicle_id).slice(0, 8) || "—",
          kindName(str(r.kind).toUpperCase()),
          dateFmt(r.expires_on),
          {
            text: left < 0 ? `Lapsed ${dayNoun(-left)} ago` : left === 0 ? "Expires today" : `${dayNoun(left)} left`,
            tone: (left < 0 ? "bad" : left <= 7 ? "warn" : "mute") as Tone,
          },
        ],
      };
    }),
    cta: { label: "Open fleet compliance", to: KPI_ROUTE.fleet_docs_expiring },
    empty: {
      title: "Nothing expiring",
      hint: "No insurance or inspection on the register falls due in the next 30 days.",
    },
  };
}

/** Leave · pending → the queue the Leave screen decides — the same filter
 *  (`status=REQUESTED`, salary advances excluded) so the tile, this table and
 *  the hub all count one queue. */
export function buildLeaveDrill(rows: Row[] | null): Drill {
  const list = (rows || []).filter((r) => str(r.status).toUpperCase() === "REQUESTED");
  const oldest = list.reduce<string | null>((acc, r) => {
    const on = str(r.starts_on || r.created_at);
    return on && (!acc || on < acc) ? on : acc;
  }, null);
  return {
    title: "Leave requests · pending",
    badge: { tone: "warn", text: `${list.length} awaiting a decision` },
    meta: [
      { label: "Pending", value: String(list.length) },
      ...(oldest ? [{ label: "Earliest starts", value: dateFmt(oldest) }] : []),
    ],
    columns: [
      { label: "Employee" },
      { label: "Type" },
      { label: "From" },
      { label: "To" },
    ],
    rows: list.slice(0, 8).map((r) => ({
      key: str(r.leave_request_id) || str(r.employee_id),
      cells: [
        str(r.employee_name) || str(r.employee_id).slice(0, 8) || "—",
        str(r.leave_type_name) || "Leave",
        dateFmt(r.starts_on),
        dateFmt(r.ends_on),
      ],
    })),
    cta: { label: "Open the leave queue", to: KPI_ROUTE.leave_pending },
    empty: {
      title: "Nothing awaiting a decision",
      hint: "Every leave request has been approved or rejected.",
    },
  };
}

/** Work orders → `/work-orders`, open and in-progress only, oldest first —
 *  the one that has waited longest is the one a workshop lead asks about. */
export function buildWorkOrdersDrill(rows: Row[] | null, now: Date = new Date()): Drill {
  const open = (rows || [])
    .filter((r) => {
      const s = str(r.status).toUpperCase();
      return s === "OPEN" || s === "IN_PROGRESS";
    })
    .map((r) => ({ r, age: r.opened_on ? daysBetween(new Date(str(r.opened_on)), now) : 0 }))
    .sort((a, b) => b.age - a.age);
  const corrective = open.filter(({ r }) => str(r.kind).toUpperCase() === "CORRECTIVE").length;
  return {
    title: "Open work orders",
    badge: { tone: "mute", text: `${open.length} open` },
    meta: [
      { label: "Open", value: String(open.length) },
      { label: "Corrective", value: String(corrective) },
      { label: "Preventive", value: String(open.length - corrective) },
    ],
    columns: [{ label: "Vehicle" }, { label: "Kind" }, { label: "Status" }, { label: "Open for", align: "right" }],
    rows: open.slice(0, 8).map(({ r, age }) => ({
      key: str(r.work_order_id),
      cells: [
        str(r.registration) || str(r.vehicle_id).slice(0, 8) || "Equipment",
        str(r.kind).toUpperCase() === "CORRECTIVE" ? "Corrective" : "Preventive",
        {
          text: str(r.status).toUpperCase() === "IN_PROGRESS" ? "In progress" : "Open",
          tone: (str(r.status).toUpperCase() === "IN_PROGRESS" ? "blue" : "mute") as Tone,
        },
        dayNoun(age),
      ],
    })),
    cta: { label: "Open work orders", to: KPI_ROUTE.work_orders_open },
    empty: {
      title: "Workshop is clear",
      hint: "No maintenance order is open or in progress.",
    },
  };
}

/** Vacancies · open → the open roles. The list endpoint has no status filter,
 *  so the OPEN filter is client-side over one page — and the note says so,
 *  because a page of recent closed roles can sit under a live count. */
export function buildVacanciesDrill(rows: Row[] | null): Drill {
  const list = (rows || []).filter((v) => str(v.status).toUpperCase() === "OPEN");
  const posted = list.filter((v) => v.posted_to_website).length;
  return {
    title: "Open vacancies",
    badge: { tone: "mute", text: `${list.length} open` },
    meta: [
      { label: "Open", value: String(list.length) },
      { label: "On the website", value: String(posted) },
    ],
    columns: [
      { label: "Role" },
      { label: "Department" },
      { label: "Posted", align: "right" },
    ],
    rows: list.slice(0, 8).map((v) => ({
      key: str(v.vacancy_id) || str(v.title),
      cells: [
        str(v.title) || str(v.vacancy_id).slice(0, 8) || "—",
        str(v.department) || "—",
        dateFmt(v.created_at),
      ],
    })),
    note:
      (rows || []).length >= 200
        ? "The table lists the 200 most recent vacancies; the count covers the open ones among them."
        : undefined,
    cta: { label: "Open recruitment", to: KPI_ROUTE.vacancies_open },
    empty: {
      title: "No open vacancies",
      hint: "Nothing is being hired for right now — open a vacancy and it lands here.",
    },
  };
}

/**
 * Warehouse occupancy → `/locations` joined client-side with `/inventory`
 * (the location list has no on-hand column; the join is exactly what §9
 * allows when a module endpoint lacks a foreign figure). Only locations with
 * a recorded capacity count — the same basis as the tile — and the headline
 * ratio is the TILE's pair, passed in, so the modal cannot contradict the card
 * when either list is clipped at its page cap.
 */
export function buildWarehouseOccupancyDrill(
  locations: Row[] | null,
  items: Row[] | null,
  pair: { value: number; denominator: number } | null,
): Drill {
  const onHand = new Map<string, number>();
  (items || []).forEach((i) => {
    if (str(i.state).toUpperCase() === "DISPATCHED" || !i.location_id) return;
    const k = str(i.location_id);
    onHand.set(k, (onHand.get(k) || 0) + (Number(i.qty_on_hand) || 0));
  });
  const withCap = (locations || [])
    .filter((l) => Number(l.capacity_units) > 0)
    .map((l) => {
      const cap = Number(l.capacity_units);
      const used = onHand.get(str(l.location_id)) || 0;
      return { l, cap, used, pct: Math.round((used / cap) * 100) };
    })
    .sort((a, b) => b.pct - a.pct);
  const measurable = !!pair && pair.denominator > 0;
  const headline = measurable ? `${Math.round(pair.value)}%` : "—";
  const label = (l: Row) =>
    str(l.label) || [str(l.zone), str(l.aisle), str(l.rack), str(l.bin), str(l.yard)].filter(Boolean).join("-") || str(l.location_id).slice(0, 8);
  return {
    title: "Warehouse occupancy",
    badge: {
      tone: measurable ? (pair.value >= 90 ? "warn" : "orange") : "mute",
      text: measurable ? `${headline} of recorded capacity` : "No capacity recorded",
    },
    meta: [
      { label: "Occupancy", value: headline },
      { label: "Capacity units", value: measurable ? grouped(pair.denominator) : "—" },
      { label: "Locations with capacity", value: String(withCap.length) },
      { label: "Full (≥ 90 %)", value: String(withCap.filter((x) => x.pct >= 90).length) },
    ],
    columns: [{ label: "Location" }, { label: "On hand", align: "right" }, { label: "Capacity", align: "right" }, { label: "Occupied", align: "right" }],
    rows: withCap.slice(0, 8).map(({ l, cap, used, pct }) => ({
      key: str(l.location_id),
      cells: [
        label(l),
        grouped(used),
        grouped(cap),
        { text: `${pct}%`, tone: (pct >= 90 ? "warn" : pct === 0 ? "mute" : "orange") as Tone },
      ],
    })),
    note: measurable
      ? "Units are whatever each location records as capacity; a site mixing pallets and bags reads approximately."
      : "Give locations a capacity (Warehouse → Locations) and this ratio becomes measurable.",
    cta: { label: "Open warehouse", to: KPI_ROUTE.warehouse_occupancy },
    empty: {
      title: "No location has a recorded capacity",
      hint: "Occupancy is units on hand against capacity — with no capacity recorded there is nothing to divide by.",
    },
  };
}

/**
 * Payroll → the runs, in-flight first (`/payroll`, plus the latest in-flight
 * run's payslips for the money figures).
 *
 * THE SALARY RULE (guide §9): figures a salary-masked reader cannot see arrive
 * NULL from the API, and a null figure renders as "—" here — NEVER as 0,
 * because "Net: 0 XAF" over a payroll that was simply withheld from the
 * reader is the leak-shaped answer this drill exists not to give. (Today the
 * tile itself is unavailable to a masked reader — §4.3 — so this is the
 * defence in depth for the day `sensitive_scope: "drill"` makes the count
 * visible while the figures stay masked.)
 */
export function buildPayrollDrill(
  runs: Row[] | null,
  detail: { items?: Row[] } | null,
  currency: string,
): Drill {
  const all = runs || [];
  const inFlight = all.filter((r) => !PAYROLL_TERMINAL.has(str(r.status).toUpperCase()));
  const settled = all.filter((r) => PAYROLL_TERMINAL.has(str(r.status).toUpperCase()));
  const items = detail?.items || [];
  const net = items.reduce((s, it) => {
    const v = Number(it.net_pay);
    return Number.isFinite(v) ? s + v : s;
  }, 0);
  const figuresComplete = items.length > 0 && items.every((it) => it.net_pay !== null && it.net_pay !== undefined);
  return {
    title: "Payroll runs",
    badge: {
      tone: "orange",
      text: inFlight.length
        ? `${inFlight.length} in flight`
        : "All runs settled",
    },
    meta: [
      { label: "In flight", value: String(inFlight.length) },
      { label: "Latest period", value: str(all[0]?.period_code) || "—" },
      { label: "Payslips (in flight)", value: items.length ? String(items.length) : "—" },
      {
        label: `Net (in flight), ${currency}`,
        value: figuresComplete ? `${grouped(net)} ${currency}` : "—",
      },
    ],
    columns: [
      { label: "Period" },
      { label: "Status" },
      { label: "Updated", align: "right" },
    ],
    rows: [...inFlight, ...settled].slice(0, 8).map((r) => {
      const status = str(r.status).toUpperCase() || "—";
      return {
        key: str(r.payroll_run_id) || str(r.period_code),
        cells: [
          str(r.period_code) || str(r.payroll_run_id).slice(0, 8) || "—",
          { text: status, tone: payrollStatusTone(status) },
          dateFmt(r.updated_at ?? r.created_at),
        ],
      };
    }),
    note: all.length >= 200
      ? "The table lists the 200 most recent runs; the in-flight count is the tile's figure over all periods."
      : undefined,
    cta: { label: "Open payroll", to: KPI_ROUTE.payroll_run_state },
    empty: {
      title: "No payroll runs yet",
      hint: "A run appears here each payroll period is opened — the count stays 0 until then, truthfully.",
    },
  };
}

/** The attrition window, in days — the client half of the tile's rolling
 *  `interval '90 days'`, used only to rank the register the drill lists. */
const ATTRITION_WINDOW_DAYS = 90;

/**
 * Attrition · 90 days → the non-active register (`/employees?status=TERMINATED,SUSPENDED`).
 *
 * THE NOTE IS THE HONESTY (guide §9): the tile counts employee.deactivated
 * EVENTS in the rolling window — an event log, append-only, immune to a
 * reactivation rewriting history — while this table is the register's CURRENT
 * state: who is off the active list now, terminations with their leaving
 * date, suspensions without one. Two different truths, named side by side
 * rather than blurred into one.
 */
export function buildAttritionDrill(rows: Row[] | null): Drill {
  const list = rows || [];
  const now = new Date();
  const leftWithinWindow = list.filter((e) => {
    const on = str(e.terminated_on);
    if (!on) return false;
    const days = daysBetween(new Date(on), now);
    return Number.isFinite(days) && days <= ATTRITION_WINDOW_DAYS;
  }).length;
  return {
    title: "Attrition · 90 days",
    badge: { tone: "bad", text: `${leftWithinWindow} left within 90 days` },
    meta: [
      { label: "Left within 90 days", value: String(leftWithinWindow) },
      { label: "Off the active register", value: String(list.length) },
    ],
    columns: [
      { label: "Employee" },
      { label: "Status" },
      { label: "Left on", align: "right" },
    ],
    rows: list.slice(0, 8).map((e) => {
      const status = str(e.status).toUpperCase();
      return {
        key: str(e.employee_id) || str(e.full_name),
        cells: [
          str(e.full_name) || str(e.employee_id).slice(0, 8) || "—",
          { text: status || "—", tone: (status === "TERMINATED" ? "bad" : "warn") as Tone },
          e.terminated_on ? dateFmt(e.terminated_on) : "—",
        ],
      };
    }),
    note:
      "The headline counts employee.deactivated events over the last 90 days; the rows are the current non-active register (suspensions and terminations).",
    cta: { label: "Open the staff register", to: KPI_ROUTE.attrition_90d },
    empty: {
      title: "Nobody has left",
      hint: "No employee has been deactivated in the last 90 days, and the register holds no one off the active list.",
    },
  };
}

/* ── Money + Sales & Procurement (PR-3, guide §5.1/§5.4) ────────────────────
 *
 * Same contract as everything above: data from a list the caller can already
 * read, a `Drill` out, one 200-row page, and an honest `note` whenever the
 * table is a scan rather than the aggregate the tile counted. The builders
 * never see an error — `useKpiDrilldown` returns the source's error before
 * calling them — so a reader without the grant gets the permission message,
 * never an empty state that sounds like "all clear".
 *
 * Two of these take the tile's own resolved figure rather than recomputing it
 * from the page: `margin_closed` is an average and `dso` a weighted average,
 * and an average over a clipped page is a different number from the one on
 * the card. The modal must not contradict the tile it opened from.
 */

/** Cash collected · MTD → posted receipts this month (`/payments`). */
export function buildCashCollectedDrill(rows: Row[] | null, currency: string): Drill {
  const list = rows || [];
  const total = list.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  return {
    title: "Cash collected this month",
    badge: { tone: "ok", text: `${grouped(total)} ${currency}` },
    meta: [
      { label: "Receipts", value: String(list.length) },
      { label: `Collected (${currency})`, value: grouped(total) },
    ],
    columns: [{ label: "Received" }, { label: "Method" }, { label: currency, align: "right" }],
    rows: list.slice(0, 8).map((r) => ({
      key: str(r.receipt_id),
      cells: [dateFmt(r.received_on), str(r.method) || "—", grouped(Number(r.amount) || 0)],
    })),
    note: list.length >= 200 ? "The table lists the 200 most recent receipts; the tile totals the month." : undefined,
    cta: { label: "Open receivables", to: KPI_ROUTE.cash_collected },
    empty: {
      title: "Nothing collected yet this month",
      hint: "Posted receipts land here as payments are recorded. The month is young, not empty.",
    },
  };
}

/** Payables · past due → supplier invoices past their due date (`/supplier-invoices`). */
export function buildPayablesDrill(rows: Row[] | null, currency: string): Drill {
  const today = new Date();
  const due = (rows || []).filter(
    (r) =>
      ["MATCHED", "POSTED_LOCKED"].includes(str(r.status)) &&
      r.due_on &&
      new Date(str(r.due_on)) < today &&
      (Number(r.amount_ttc) || 0) > (Number(r.amount_paid) || 0),
  );
  const outstanding = (r: Row) => (Number(r.amount_ttc) || 0) - (Number(r.amount_paid) || 0);
  const total = due.reduce((sum, r) => sum + outstanding(r), 0);
  const ranked = [...due].sort((a, b) => outstanding(b) - outstanding(a));
  return {
    title: "Supplier invoices past due",
    badge: { tone: "warn", text: `${grouped(total)} ${currency}` },
    meta: [
      { label: "Invoices", value: String(due.length) },
      { label: `Outstanding (${currency})`, value: grouped(total) },
    ],
    columns: [{ label: "Document" }, { label: "Due" }, { label: "Days" , align: "right" }, { label: currency, align: "right" }],
    rows: ranked.slice(0, 8).map((r) => ({
      key: str(r.supplier_invoice_id) || str(r.doc_number),
      cells: [
        str(r.doc_number) || str(r.supplier_ref) || "—",
        dateFmt(r.due_on),
        String(daysBetween(new Date(str(r.due_on)), today)),
        grouped(outstanding(r)),
      ],
    })),
    note: (rows || []).length >= 200 ? "Ranked over the 200 most recent invoices; the tile totals them all." : undefined,
    cta: { label: "Open supplier debt", to: KPI_ROUTE.payables_overdue },
    empty: {
      title: "Nothing past due",
      hint: "Every supplier invoice is either settled or not yet at its due date.",
    },
  };
}

/** Cash requests · awaiting → submitted or validated (`/cash-requests`). */
export function buildCashRequestsDrill(rows: Row[] | null, currency: string): Drill {
  const waiting = (rows || []).filter((r) => ["SUBMITTED", "VALIDATED"].includes(str(r.status)));
  const total = waiting.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  return {
    title: "Cash requests awaiting a decision",
    badge: { tone: "bad", text: `${waiting.length} waiting` },
    meta: [
      { label: "Requests", value: String(waiting.length) },
      { label: `Requested (${currency})`, value: grouped(total) },
    ],
    columns: [{ label: "Document" }, { label: "Stage" }, { label: "Raised" }, { label: currency, align: "right" }],
    rows: waiting.slice(0, 8).map((r) => ({
      key: str(r.cash_request_id) || str(r.doc_number),
      cells: [
        str(r.doc_number) || str(r.cash_request_id).slice(0, 8),
        // SUBMITTED waits on a validator, VALIDATED on an approver — naming
        // which desk it sits at is the point of opening this modal.
        str(r.status) === "SUBMITTED" ? "Awaiting validation" : "Awaiting approval",
        dateFmt(r.created_at),
        grouped(Number(r.amount) || 0),
      ],
    })),
    cta: { label: "Open cash requests", to: KPI_ROUTE.cash_requests_awaiting },
    empty: {
      title: "No request is waiting",
      hint: "Every raised cash request has been decided.",
    },
  };
}

/**
 * Margin · closed files → approved simulations on completed files
 * (`/margin-simulations`, the MOD-27 read the tile is gated on).
 *
 * `marginPct` and `closedCount` come from the TILE: the average is computed
 * server-side over every closed file, and re-averaging a 200-row page would
 * put a different number in the modal than on the card.
 *
 * Per-file margin renders "—" whenever the row carries no `margin_percent`.
 * That is deliberately NOT a client-side permission test: masking is decided
 * server-side by `field_visibility`, and a client that decided for itself
 * which figures to blank would be a hint pretending to be a rule. If the
 * server sends the number, the reader was allowed it; if it withholds it, the
 * dash is already the honest rendering.
 */
export function buildMarginDrill(
  rows: Row[] | null,
  marginPct: number | null,
  closedCount: number,
): Drill {
  const list = (rows || []).filter((r) => str(r.status) === "APPROVED");
  const withheld = list.some(
    (r) => r.margin_percent === null || r.margin_percent === undefined,
  );
  return {
    title: "Margin on closed files",
    badge: { tone: "orange", text: marginPct === null ? "Not measurable" : `${marginPct} %` },
    meta: [
      { label: "Closed files measured", value: String(closedCount) },
      { label: "Average margin", value: marginPct === null ? "—" : `${marginPct} %` },
    ],
    columns: [{ label: "Simulation" }, { label: "Approved" }, { label: "Margin", align: "right" }],
    rows: list.slice(0, 8).map((r) => ({
      key: str(r.margin_simulation_id),
      cells: [
        str(r.margin_simulation_id).slice(0, 8),
        dateFmt(r.approved_at),
        r.margin_percent === null || r.margin_percent === undefined
          ? "—"
          : `${Number(r.margin_percent)} %`,
      ],
    })),
    note: withheld
      ? "Some per-file margins are not shown for your role; the average above is the aggregate you may read."
      : undefined,
    cta: { label: "Open margin simulations", to: KPI_ROUTE.margin_closed },
    empty: {
      title: "No closed file has an approved margin",
      hint: "Margin is measured once a file completes with its simulation approved.",
    },
  };
}

/**
 * DSO → the unpaid final invoices behind the figure (`/final-invoices`).
 *
 * `dsoDays` is the tile's weighted average over every open invoice; the table
 * ranks the page by age so the reader sees what is pulling it up.
 */
export function buildDsoDrill(rows: Row[] | null, dsoDays: number | null, currency: string): Drill {
  const today = new Date();
  const open = (rows || []).filter(
    (r) => isLockedFinal(r) && (Number(r.total_ttc) || 0) > (Number(r.amount_paid) || 0),
  );
  const age = (r: Row) => daysBetween(new Date(str(r.created_at)), today);
  const ranked = [...open].sort((a, b) => age(b) - age(a));
  const outstanding = open.reduce(
    (sum, r) => sum + ((Number(r.total_ttc) || 0) - (Number(r.amount_paid) || 0)),
    0,
  );
  return {
    title: "Days sales outstanding",
    badge: { tone: "blue", text: dsoDays === null ? "Not measurable" : `${dsoDays} days` },
    meta: [
      { label: "Open invoices", value: String(open.length) },
      { label: `Outstanding (${currency})`, value: grouped(outstanding) },
      { label: "Weighted age", value: dsoDays === null ? "—" : `${dsoDays} days` },
    ],
    columns: [{ label: "Invoice" }, { label: "Issued" }, { label: "Age", align: "right" }, { label: currency, align: "right" }],
    rows: ranked.slice(0, 8).map((r) => ({
      key: str(r.invoice_id) || str(r.doc_number),
      cells: [
        str(r.doc_number) || str(r.invoice_id).slice(0, 8),
        dateFmt(r.created_at),
        String(age(r)),
        grouped((Number(r.total_ttc) || 0) - (Number(r.amount_paid) || 0)),
      ],
    })),
    note: (rows || []).length >= 200 ? "Ranked over the 200 most recent invoices; the tile weights them all." : undefined,
    cta: { label: "Open receivables", to: KPI_ROUTE.dso },
    empty: {
      title: "Nothing is outstanding",
      hint: "Every locked final invoice has been settled — there is no age to weigh.",
    },
  };
}

/** Won · this month → opportunities settled won (`/opportunities`). */
export function buildPipelineWonDrill(rows: Row[] | null, currency: string): Drill {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const won = (rows || []).filter(
    (r) => str(r.status) === "WON" && r.settled_at && new Date(str(r.settled_at)) >= monthStart,
  );
  const total = won.reduce((sum, r) => sum + (Number(r.estimated_value) || 0), 0);
  return {
    title: "Won this month",
    badge: { tone: "ok", text: `${grouped(total)} ${currency}` },
    meta: [
      { label: "Opportunities", value: String(won.length) },
      { label: `Value (${currency})`, value: grouped(total) },
    ],
    columns: [{ label: "Opportunity" }, { label: "Settled" }, { label: currency, align: "right" }],
    rows: won.slice(0, 8).map((r) => ({
      key: str(r.opportunity_id) || str(r.name),
      cells: [str(r.name) || "—", dateFmt(r.settled_at), grouped(Number(r.estimated_value) || 0)],
    })),
    cta: { label: "Open opportunities", to: KPI_ROUTE.pipeline_won },
    empty: {
      title: "Nothing won yet this month",
      hint: "Opportunities appear here as they are settled won. The month is young, not empty.",
    },
  };
}

/** Quote requests · open → what a client is still waiting on (`/quote-requests`). */
export function buildQuoteRequestsDrill(rows: Row[] | null): Drill {
  const OPEN = ["RECEIVED", "UNDER_REVIEW", "CLARIFICATION_REQUIRED"];
  const open = (rows || []).filter((r) => OPEN.includes(str(r.status)));
  const today = new Date();
  const waiting = (r: Row) => daysBetween(new Date(str(r.created_at)), today);
  const ranked = [...open].sort((a, b) => waiting(b) - waiting(a));
  return {
    title: "Quote requests awaiting an answer",
    badge: { tone: "blue", text: `${open.length} open` },
    meta: [
      { label: "Open requests", value: String(open.length) },
      { label: "Longest waiting", value: ranked.length ? `${waiting(ranked[0])} days` : "—" },
    ],
    columns: [{ label: "Reference" }, { label: "Requester" }, { label: "Stage" }, { label: "Waiting", align: "right" }],
    rows: ranked.slice(0, 8).map((r) => ({
      key: str(r.quote_request_id) || str(r.public_ref),
      cells: [
        str(r.public_ref) || str(r.quote_request_id).slice(0, 8),
        str(r.requester_company) || str(r.requester_name) || "—",
        str(r.status) || "—",
        `${waiting(r)} d`,
      ],
    })),
    cta: { label: "Open quote requests", to: KPI_ROUTE.quote_requests_open },
    empty: {
      title: "Every request has been answered",
      hint: "Nothing is waiting on a quote from us.",
    },
  };
}

/**
 * POs · awaiting receipt → issued orders with no goods in (`/purchase-orders`).
 *
 * The tile measures the absence of a `grn_inbound` row, not the PO's status,
 * so a PO whose goods arrived without anyone moving its status stops counting
 * when the GRN lands. The page cannot see GRNs, so the table lists issued POs
 * and the note says what the tile counted — an honest scan, not a second
 * definition.
 */
export function buildPosInFlightDrill(rows: Row[] | null, inFlight: number, currency: string): Drill {
  const ISSUED = ["ISSUED_LOCKED", "APPROVED_LOCKED", "PARTIAL"];
  const issued = (rows || []).filter((r) => ISSUED.includes(str(r.status)));
  const total = issued.reduce((sum, r) => sum + (Number(r.total_ttc) || 0), 0);
  return {
    title: "Purchase orders awaiting receipt",
    badge: { tone: "warn", text: `${inFlight} in flight` },
    meta: [
      { label: "Awaiting receipt", value: String(inFlight) },
      { label: `Issued value (${currency})`, value: grouped(total) },
    ],
    columns: [{ label: "Order" }, { label: "Supplier" }, { label: "Due" }, { label: currency, align: "right" }],
    rows: issued.slice(0, 8).map((r) => ({
      key: str(r.po_id) || str(r.doc_number),
      cells: [
        str(r.doc_number) || str(r.po_id).slice(0, 8),
        str(r.supplier_name) || "—",
        dateFmt(r.delivery_on ?? r.due_on),
        grouped(Number(r.total_ttc) || 0),
      ],
    })),
    note:
      issued.length !== inFlight
        ? "The table lists issued orders; the tile counts those with no goods received yet."
        : undefined,
    cta: { label: "Open purchase orders", to: KPI_ROUTE.pos_in_flight },
    empty: {
      title: "Nothing is awaiting receipt",
      hint: "Every issued order has had its goods received.",
    },
  };
}

/** Requests · awaiting PO → raised, not yet ordered (`/purchase-requests`). */
export function buildPurchaseRequestsDrill(rows: Row[] | null): Drill {
  const PENDING = ["SUBMITTED", "APPROVED"];
  const pending = (rows || []).filter((r) => PENDING.includes(str(r.status)));
  return {
    title: "Purchase requests awaiting an order",
    badge: { tone: "mute", text: `${pending.length} waiting` },
    meta: [
      { label: "Awaiting a PO", value: String(pending.length) },
      { label: "Approved", value: String(pending.filter((r) => str(r.status) === "APPROVED").length) },
    ],
    columns: [{ label: "Request" }, { label: "Department" }, { label: "Stage" }, { label: "Raised" }],
    rows: pending.slice(0, 8).map((r) => ({
      key: str(r.pr_id) || str(r.doc_number),
      cells: [
        str(r.doc_number) || str(r.pr_id).slice(0, 8),
        str(r.department) || "—",
        str(r.status) === "APPROVED" ? "Approved, awaiting PO" : "Awaiting approval",
        dateFmt(r.created_at),
      ],
    })),
    cta: { label: "Open purchase requests", to: KPI_ROUTE.purchase_requests },
    empty: {
      title: "Nothing is awaiting an order",
      hint: "Every approved request has been turned into a purchase order.",
    },
  };
}
