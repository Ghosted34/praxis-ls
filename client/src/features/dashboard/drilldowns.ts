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

/** Which drill each new tile opens; appended rather than spliced into
 *  KPI_ROUTE so the three domain PRs merge without touching each other's
 *  lines. Read through `kpiRoute()` below so callers see one table. */
export const KPI_ROUTE_PR2: Record<string, string> = {
  late_vs_eta: "/operations/files",
  dwell_days: "/operations/milestones",
  fleet_docs_expiring: "/fleet/compliance",
  work_orders_open: "/fleet/work-orders",
  warehouse_occupancy: "/wms",
};

/** Route for a tile id across every domain block, or null. */
export function kpiRoute(id: string): string | null {
  return KPI_ROUTE[id] ?? KPI_ROUTE_PR2[id] ?? null;
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
    cta: { label: "Open operations files", to: KPI_ROUTE_PR2.late_vs_eta },
    empty: {
      title: "Nothing past its ETA",
      hint: "Every open file with an ETA is either not due yet or already has an arrival recorded.",
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
    cta: { label: "Open milestones", to: KPI_ROUTE_PR2.dwell_days },
    empty: {
      title: "No slips to attribute",
      hint: "Attribution fills in as milestones complete late and are charged to a tier.",
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
    cta: { label: "Open fleet compliance", to: KPI_ROUTE_PR2.fleet_docs_expiring },
    empty: {
      title: "Nothing expiring",
      hint: "No insurance or inspection on the register falls due in the next 30 days.",
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
    cta: { label: "Open work orders", to: KPI_ROUTE_PR2.work_orders_open },
    empty: {
      title: "Workshop is clear",
      hint: "No maintenance order is open or in progress.",
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
    cta: { label: "Open warehouse", to: KPI_ROUTE_PR2.warehouse_occupancy },
    empty: {
      title: "No location has a recorded capacity",
      hint: "Occupancy is units on hand against capacity — with no capacity recorded there is nothing to divide by.",
    },
  };
}
