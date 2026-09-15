/**
 * The KPI band's client mirror — pure, typed, and deliberately boring.
 *
 * WHY A MIRROR AT ALL WHEN THE SERVER RESOLVES. The band is resolved once,
 * server-side, from user pins + role config + eligibility + availability
 * (`kpi_catalog/resolve.js` — the precedence lives THERE, not here, so the
 * painted band and the picker's preview cannot disagree about "who decided").
 * What the client owns is the two things a server must not: the DRAWING
 * (formatting, units, icons) and the DRAFT (the picker's slot arithmetic,
 * which only exists after the user starts fiddling and only becomes truth on
 * save). `tower-model.ts` applies the same split to the shortcut grid — the
 * lesson that a launcher and an editor must not keep two copies of a rule.
 *
 * THE ZERO POLICY, client side (guide §6.3): a slot whose tile the server
 * painted carries a number, and 0 is a number — it renders. Nothing here hides
 * a zero; invisibility is reserved for what the server reports as `hidden`,
 * which is a selection that cannot render in this environment (module off in
 * this mode, grant revoked since) — and which the picker surfaces as a count
 * with a reason rather than a gap in the grid.
 */
import type { Tone } from "@/components/ui/pill";
import { millions } from "./model";

/* ── types mirroring the band payload (`dashboard.service.kpiBand`) ───────── */

export type BandUnit = "money" | "count" | "pct" | "pair" | "days";

export type BandDomain =
  | "money"
  | "operations"
  | "fleet_warehouse"
  | "sales_procurement"
  | "human_capital";

/** Catalog metadata as the server ships it — i18n KEYS, never strings. */
export type BandTileMeta = {
  id: string;
  domain: BandDomain;
  unit: BandUnit;
  module: string;
  status: "live" | "hidden";
  tone: Tone;
  icon: string;
  labelKey: string;
  hintKey: string;
  badgeKey: string | null;
  drillTo: string | null;
};

export type BandSlot = BandTileMeta & {
  /** Money: raw minor-unit sum. Count/pct/days: the figure. Pair: the n. */
  value: number;
  /** Pair/pct denominators (measured total); null for scalars. */
  denominator: number | null;
  /** False when a ratio's denominator is 0 — "nothing measured", not "all late". */
  measurable: boolean;
};

export type BandSource = "user" | "role" | "default";

export type KpiBand = {
  source: BandSource;
  currency: string;
  slots: BandSlot[];
  hidden: string[];
};

/** The picker's catalog (GET /dashboard/kpi-catalog). */
export type KpiCatalog = {
  maxTiles: number;
  tiles: BandTileMeta[];
  lockedIds: string[];
  roleDefaultIds: string[];
  currentIds: string[] | null;
  hiddenTileCount: number;
  totalLive: number;
  source: BandSource;
  roleNames: string[];
};

export const MAX_BAND_TILES = 4;

/** Group order = the server catalog's DOMAINS order; the two lists must march
 *  together (kpi-catalog.test.js pins the server half; this comment pins the
 *  contract, and the picker falls back to `other` for anything unmatched
 *  rather than hiding a tile a user is allowed to pick). */
export const BAND_DOMAINS: { key: BandDomain; labelKey: string }[] = [
  { key: "money", labelKey: "dash.kpiDomainMoney" },
  { key: "operations", labelKey: "dash.kpiDomainOperations" },
  { key: "fleet_warehouse", labelKey: "dash.kpiDomainFleetWarehouse" },
  { key: "sales_procurement", labelKey: "dash.kpiDomainSalesProcurement" },
  { key: "human_capital", labelKey: "dash.kpiDomainHumanCapital" },
];

/* ── the drawing ──────────────────────────────────────────────────────────── */

/**
 * The unit noun a `pair` renders after its denominator. A catalog-wide
 * `unitNoun` field was rejected in the guide for the same reason the icons
 * live here: it is a drawing, not a fact about the data.
 */
const PAIR_NOUN: Partial<Record<string, string>> = {
  fleet_utilisation: "dash.unitVehicles",
};

export type FormattedBandValue = {
  /** The figure — the big number. */
  text: string;
  /** Muted suffix after it — the unit, not the value (same split as the old
   *  four cards' `unit`). */
  unit: string | null;
};

export function formatBandValue(
  slot: BandSlot,
  currency: string,
  t: (key: string) => string,
): FormattedBandValue {
  switch (slot.unit) {
    case "money":
      return { text: millions(slot.value), unit: `M ${currency}` };
    case "pct":
      return { text: String(Math.round(slot.value)), unit: "%" };
    case "pair": {
      const denom = slot.denominator ?? 0;
      const nounKey = PAIR_NOUN[slot.id];
      return {
        text: String(Math.round(slot.value)),
        unit: `/${nounKey ? ` ${denom} ${t(nounKey)}` : ` ${denom}`}`,
      };
    }
    case "days":
      return { text: String(slot.value), unit: t("dash.unitDays") };
    case "count":
    default:
      return { text: String(slot.value), unit: null };
  }
}

/**
 * Grace for a client newer than its server (a rollout window where
 * `/dashboard/kpis` answers the legacy flat payload with no `band`): the old
 * four, in the old order, with the old hide-if-null behaviour — because the
 * OLD server had not been asked to assert zeros yet. When the server ships the
 * band, this path is dead code by construction, and the resolver owns the
 * policy; it exists so the deploy order can be either way.
 */
export function legacyBand(k: {
  revenue: number | null;
  currency: string;
  sla: number | null;
  overdue: number | null;
  fleetActive: number | null;
  fleetTotal: number | null;
}): KpiBand {
  const meta = (id: string, labelKey: string, hintKey: string, extra: Partial<BandSlot>): BandSlot => ({
    id,
    domain: "operations",
    unit: "count",
    module: "MOD-00A",
    status: "live",
    tone: "mute",
    icon: id,
    labelKey,
    hintKey,
    badgeKey: null,
    drillTo: null,
    value: 0,
    denominator: null,
    measurable: true,
    ...extra,
  });
  const slots: BandSlot[] = [];
  if (k.revenue !== null)
    slots.push(
      meta("revenue", "dash.revenue", "dash.revenueHint", {
        domain: "money",
        unit: "money",
        tone: "orange",
        icon: "revenue",
        badgeKey: "dash.locked",
        value: k.revenue,
      }),
    );
  if (k.sla !== null)
    slots.push(
      meta("sla_on_time", "dash.onTime", "dash.onTimeHint", {
        unit: "pct",
        tone: "ok",
        icon: "sla",
        badgeKey: "dash.slaBadge",
        value: k.sla,
      }),
    );
  if (k.overdue !== null)
    slots.push(
      meta("receivables_overdue", "dash.pastDue", "dash.pastDueHint", {
        domain: "money",
        unit: "money",
        tone: "warn",
        icon: "overdue",
        badgeKey: "dash.pastDueBadge",
        value: k.overdue,
      }),
    );
  if (k.fleetTotal !== null && k.fleetTotal > 0)
    slots.push(
      meta("fleet_utilisation", "dash.fleetUtil", "dash.fleetUtilHint", {
        domain: "fleet_warehouse",
        unit: "pair",
        tone: "blue",
        icon: "fleet",
        badgeKey: "dash.fleetBadge",
        value: k.fleetActive ?? 0,
        denominator: k.fleetTotal,
      }),
    );
  return { source: "default", currency: k.currency, slots, hidden: [] };
}

/* ── the draft (picker slot arithmetic) ───────────────────────────────────── */

/**
 * Add a tile to the draft: first free slot, unless it is already in. A full
 * band answers the same draft — the picker DISABLES the row visually, but the
 * function stays total rather than throwing, because a draft mutation is the
 * kind of code that gets called from a keyboard handler where an exception
 * means a dead key on the app's busiest screen.
 */
export function draftAdd(draft: string[], id: string): string[] {
  if (draft.includes(id)) return draft;
  if (draft.length >= MAX_BAND_TILES) return draft;
  return [...draft, id];
}

/** Remove a tile — refused for locked ids (they can be re-ordered, never
 *  removed: "locked" means the ROLE decided, the user only arranges). */
export function draftRemove(draft: string[], id: string, locked: readonly string[]): string[] {
  if (locked.includes(id)) return draft;
  return draft.filter((x) => x !== id);
}

/** Move a tile one slot. Reordering is always allowed — even for locked tiles
 *  (an exec band that reads identically can still be arranged to taste). */
export function draftMove(draft: string[], id: string, delta: -1 | 1): string[] {
  const i = draft.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= draft.length) return draft;
  const next = [...draft];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/**
 * The draft the picker opens with: the user's own pins if they have any, else
 * the role default, else the current resolved band. `null` pins are NOT an
 * empty draft — that distinction is the whole preference doctrine (never
 * chosen ≠ chose to clear), and the picker must show what WILL paint, not an
 * editorial "nothing yet".
 */
export function draftInitial(
  catalog: Pick<KpiCatalog, "currentIds" | "roleDefaultIds">,
  bandSlots: readonly string[],
): string[] {
  if (catalog.currentIds) return [...catalog.currentIds];
  if (catalog.roleDefaultIds.length) return [...catalog.roleDefaultIds];
  return [...bandSlots];
}

/** Drafts differ from what is stored iff the ORDER or CONTENT moved. */
export function draftDirty(draft: readonly string[], stored: readonly string[]): boolean {
  if (draft.length !== stored.length) return true;
  return draft.some((id, i) => id !== stored[i]);
}

/**
 * Translate the draft into the value to PERSIST (`PUT /me/preferences/shell
 * { kpiPins }`).
 *
 * A draft that exactly re-states the role default, in order, saves as NULL —
 * "no choice made" — so the band keeps following the role's next change
 * instead of freezing at the moment someone pressed Restore. And a cleared
 * draft with no role default to match stays `[]`: EMPTY is a real answer (the
 * doctrine from the rail picker — never-chosen and chose-nothing are
 * different facts), and quietly turning it into null would hand the user back
 * the product default they just refused.
 */
export function draftToPins(
  draft: readonly string[],
  roleDefaultIds: readonly string[],
): string[] | null {
  const sameOrder =
    draft.length === roleDefaultIds.length &&
    draft.every((id, i) => id === roleDefaultIds[i]);
  if (roleDefaultIds.length > 0 && sameOrder) return null;
  return [...draft];
}
