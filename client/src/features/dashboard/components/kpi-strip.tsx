/**
 * The KPI band — the resolved four, painted.
 *
 * WHAT CHANGED (PR-1 of doc/KPI_BAND_ENGINEERING_GUIDE.md). This used to be
 * four hardcoded cards with a per-card hide-if-null rule that three sources
 * disagreed about: SLA hid when nothing was measured, fleet hid at zero total,
 * revenue ASSERTED 0.0 from a COALESCE'd sum on a tenant with no invoices. The
 * band now renders what the server resolved — the user's pick, else the role
 * default, else the product four — and one policy covers all tiles:
 *
 *   a number (including 0) renders; an unavailable tile is not painted and
 *   appears in the footer as a counted, explained gap. "0 vehicles" is a
 *   truth about a fleet that exists; a missing tile is a fact about access or
 *   installation — the two states the old rule kept collapsing into each
 *   other, and the reason LIVE and TEST showed different bands.
 *
 * They are real `<button>`s (audit F13: keyboard reachability, inherited by
 * every new tile) and they are never `<div onclick>`s. State reads through
 * colour, not a translate: this screen opens forty times a day and a hover
 * lift is a landing-page idiom (F17).
 *
 * The grid reflows honestly — 4 → `xl:grid-cols-4`, 3 → 3 — because shrinking
 * was the chosen answer (guide §6.2, "never pad"). A silently substituted
 * tile is the CEO meeting a number they never picked.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { Pill, type Tone } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import { iconForKpi } from "./kpi-icons";
import { formatBandValue, type BandSlot, type KpiBand } from "../kpi-model";

const ICON_TONE: Record<Tone, string> = {
  orange:
    "bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] text-primary-ink",
  ok: "bg-[rgb(var(--ok-fill)_/_0.13)] text-[rgb(var(--ok))]",
  warn: "bg-[rgb(var(--warn-fill)_/_0.14)] text-[rgb(var(--warn))]",
  bad: "bg-[rgb(var(--bad-fill)_/_0.12)] text-[rgb(var(--bad))]",
  blue: "bg-[rgb(var(--brand-blue)_/_0.12)] text-[rgb(var(--brand-blue-ink))]",
  mute: "bg-[rgb(var(--ink)_/_0.06)] text-muted-foreground",
};

/** Static strings — Tailwind scans literals; a built className would purge
 *  the grid away at build time and the band would stack. Every count the
 *  resolver can produce (0–4) maps to one real class. */
const GRID_BY_COUNT: Record<number, string> = {
  1: "sm:grid-cols-1 xl:grid-cols-1",
  2: "sm:grid-cols-2 xl:grid-cols-2",
  3: "sm:grid-cols-2 xl:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
};

export type BandCard = {
  id: string;
  label: string;
  value: string;
  unit: string | null;
  hint: string;
  badge: string | null;
  tone: Tone;
  Icon: (p: React.SVGProps<SVGSVGElement>) => React.JSX.Element;
};

/**
 * Slots → paintable cards. Exported pure (like `kpiCards` was) so the band's
 * rendering rules have a unit test that does not need the DOM: the zero policy
 * is exactly the kind of rule that regresses silently. `t` is injectable for
 * the same reason; the component passes i18next's.
 */
export function bandCards(
  band: Pick<KpiBand, "slots" | "currency">,
  t: (key: string) => string = (k) => i18n.t(k),
): BandCard[] {
  return band.slots.map((s: BandSlot) => {
    const formatted = formatBandValue(s, band.currency, t);
    return {
      id: s.id,
      label: t(s.labelKey),
      value: formatted.text,
      unit: formatted.unit,
      hint: t(s.hintKey),
      badge: s.badgeKey ? t(s.badgeKey) : null,
      tone: s.tone,
      Icon: iconForKpi(s.icon, s.domain),
    };
  });
}

export function KpiStrip({
  band,
  onOpen,
  onEditTiles,
}: {
  band: KpiBand | null;
  onOpen: (id: string) => void;
  onEditTiles: () => void;
}) {
  const { t } = useTranslation();
  if (!band) return null;
  const cards = bandCards(band, t);
  const hiddenCount = band.hidden.length;

  if (!cards.length) {
    // An empty band is a CHOICE or a consequence — never a dead screen. One
    // row saying so, with the door open.
    return (
      <section
        aria-label="Headline metrics"
        className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-dashed bg-card/40 px-4 py-3"
      >
        <p className="text-label text-muted-foreground">
          {hiddenCount
            ? t("dash.kpiHiddenHint")
            : t("dash.kpiPickerDesc")}
        </p>
        <EditTilesButton t={t} onClick={onEditTiles} />
      </section>
    );
  }

  return (
    <section aria-label="Headline metrics" className="mb-5">
      <div
        className={cn("grid gap-3", GRID_BY_COUNT[cards.length] ?? GRID_BY_COUNT[4])}
      >
        {cards.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onOpen(c.id)}
            aria-haspopup="dialog"
            className={cn(
              "flex flex-col rounded-lg border bg-card p-4 text-left shadow-[var(--shadow-s)]",
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
              {c.badge && <Pill tone={c.tone}>{c.badge}</Pill>}
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
      </div>
      <div className="mt-2 flex items-center justify-end gap-3">
        {hiddenCount > 0 && (
          <span
            className="text-label text-muted-foreground"
            title={t("dash.kpiHiddenHint")}
          >
            {t("dash.kpiHiddenInBand", { n: hiddenCount })}
          </span>
        )}
        <EditTilesButton t={t} onClick={onEditTiles} />
      </div>
    </section>
  );
}

/** The one door for this choice (D6): a ghost button on the band itself. */
function EditTilesButton({
  t,
  onClick,
}: {
  t: (key: string) => string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-label text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={13}
        height={13}
        aria-hidden
      >
        <path d="M4 20h4L19.5 8.5a2.1 2.1 0 00-3-3L5 17v3z" />
        <path d="M13.5 6.5l3 3" />
      </svg>
      {t("dash.kpiEditTiles")}
    </button>
  );
}
