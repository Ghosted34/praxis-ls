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

/** Where each card's CTA sends the user. */
export const KPI_ROUTE = {
  revenue: "/finance/invoices",
  sla: "/operations/files",
  overdue: "/finance/receivables",
  fleet: "/fleet",
} as const;

export type KpiId = keyof typeof KPI_ROUTE;

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
    cta: { label: "Open operations files", to: KPI_ROUTE.sla },
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
    cta: { label: "Open receivables", to: KPI_ROUTE.overdue },
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
    cta: { label: "Open fleet", to: KPI_ROUTE.fleet },
    empty: {
      title: "No vehicles visible",
      hint: "The fleet module may be switched off for this tenant, or you may not have the grant to read it.",
    },
  };
}
