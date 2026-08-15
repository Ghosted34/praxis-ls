/**
 * The four headline cards. Each opens its drill-down.
 *
 * A card whose metric resolves to `null` HIDES rather than rendering a zero: the
 * source query is guarded server-side and returns null when the module is off
 * or the grant is missing, and "0 vehicles" is a different — and wrong —
 * statement from "you cannot see the fleet".
 *
 * They are real `<button>`s. In the iframe these were `<div onclick=…>` inside a
 * frame outside the parent's focus order, so the drill-downs were unreachable by
 * keyboard from the app at all (audit F13).
 *
 * A CORRECTION THE REBUILD FOUND. The mock's markup badged the revenue card
 * "MTD", and the live-data injection script only ever rewrote the value and the
 * caption — never the badge. `revenue_final_ttc` is `SUM(total_ttc)` over every
 * locked FINAL invoice with no period predicate at all (`dashboard.repo.js`), so
 * production has been labelling an all-time total as month-to-date. The badge
 * now says what the query does.
 */
import * as React from "react";
import { Pill, type Tone } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { millions } from "../model";
import type { KpiId } from "../drilldowns";
import type { ControlTowerKpis } from "../use-control-tower";

type IP = React.SVGProps<SVGSVGElement>;
const ic = (p: IP) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: 18,
  height: 18,
  "aria-hidden": true,
  ...p,
});
const RevenueIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M4 19V5M4 19h16M8 15l3-4 3 3 4-6" />
  </svg>
);
const SlaIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
const OverdueIcon = (p: IP) => (
  <svg {...ic(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4l3 2" />
  </svg>
);
const FleetIcon = (p: IP) => (
  <svg {...ic(p)}>
    <path d="M3 7h13l5 5v5h-3" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
  </svg>
);

const ICON_TONE: Record<Tone, string> = {
  orange:
    "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary-ink",
  ok: "bg-[rgb(var(--ok-fill)_/_0.13)] text-[rgb(var(--ok))]",
  warn: "bg-[rgb(var(--warn-fill)_/_0.14)] text-[rgb(var(--warn))]",
  bad: "bg-[rgb(var(--bad-fill)_/_0.12)] text-[rgb(var(--bad))]",
  blue: "bg-[rgb(var(--brand-blue)_/_0.12)] text-[rgb(var(--brand-blue-ink))]",
  mute: "bg-[rgb(var(--ink)_/_0.06)] text-muted-foreground",
};

type Card = {
  id: KpiId;
  label: string;
  value: string;
  /** Rendered smaller and muted after the value — the unit, not the figure. */
  unit?: string;
  hint: string;
  badge: string;
  tone: Tone;
  Icon: (p: IP) => React.JSX.Element;
};

/** The visible cards, in fixed order. `null` metrics drop out entirely. */
export function kpiCards(k: ControlTowerKpis): Card[] {
  const cards: Card[] = [];
  if (k.revenue !== null) {
    cards.push({
      id: "revenue",
      label: "Revenue · turnover",
      value: millions(k.revenue),
      unit: `M ${k.currency}`,
      hint: "Locked final invoices, all periods",
      badge: "Locked",
      tone: "orange",
      Icon: RevenueIcon,
    });
  }
  if (k.sla !== null) {
    cards.push({
      id: "sla",
      label: "On-time delivery",
      value: String(k.sla),
      unit: "%",
      hint: "Dossiers with an ETA and an ATA",
      badge: "SLA",
      tone: "ok",
      Icon: SlaIcon,
    });
  }
  if (k.overdue !== null) {
    cards.push({
      id: "overdue",
      label: "Receivables · past due",
      value: millions(k.overdue),
      unit: `M ${k.currency}`,
      hint: "Outstanding past the due date",
      badge: "Past due",
      tone: "warn",
      Icon: OverdueIcon,
    });
  }
  if (k.fleetTotal !== null && k.fleetTotal > 0) {
    cards.push({
      id: "fleet",
      label: "Fleet utilisation",
      value: String(k.fleetActive ?? 0),
      unit: `/ ${k.fleetTotal} vehicles`,
      hint: "Active now",
      badge: "On road",
      tone: "blue",
      Icon: FleetIcon,
    });
  }
  return cards;
}

export function KpiStrip({
  kpis,
  onOpen,
}: {
  kpis: ControlTowerKpis;
  onOpen: (id: KpiId) => void;
}) {
  const cards = kpiCards(kpis);
  if (!cards.length) return null;

  return (
    <section
      aria-label="Headline metrics"
      className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {cards.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpen(c.id)}
          aria-haspopup="dialog"
          className={cn(
            "flex flex-col rounded-lg border bg-card p-4 text-left shadow-[var(--shadow-s)]",
            // State reads through colour, not a translate. A hover lift on a
            // screen an operator opens forty times a day is a landing-page
            // idiom (F17).
            "transition-colors hover:border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] hover:bg-accent/40",
          )}
        >
          <span className="mb-3 flex items-center justify-between gap-2">
            <span
              aria-hidden
              className={cn(
                "grid h-9 w-9 place-items-center rounded-md",
                ICON_TONE[c.tone],
              )}
            >
              <c.Icon />
            </span>
            <Pill tone={c.tone}>{c.badge}</Pill>
          </span>
          <span className="text-micro uppercase text-muted-foreground">
            {c.label}
          </span>
          <span className="num font-display mt-1.5 text-[26px] font-semibold leading-none">
            {c.value}
            {c.unit && (
              <small className="ml-1.5 text-sm font-medium text-muted-foreground">
                {c.unit}
              </small>
            )}
          </span>
          <span className="mt-1.5 text-label text-muted-foreground">
            {c.hint}
          </span>
        </button>
      ))}
    </section>
  );
}
