import * as React from "react";
import { cn } from "@/lib/cn";
import { tStatic } from "@/lib/i18n";
import { Pill, type Tone } from "@/components/ui/pill";
import {
  BoxIcon,
  CheckIcon,
  PlaneIcon,
  ShipIcon,
  TruckIcon,
  WarehouseIcon,
  DocumentIcon,
} from "@/components/ui/icons";
import { type IconComponent } from "@/components/ui/icon-tile";

/**
 * The shipment state vocabulary — `doc/PUBLIC_WEB_PLAN.md` §3.3.
 *
 * Four words, and they are the same four in the tracking page, the client
 * portal and anything else that ever renders a milestone chain:
 *
 *   COMPLETED  done, in the past          `public_state`
 *   CURRENT    happening now              `public_state`
 *   UPCOMING   not yet reached            `public_state`
 *   CLOSED     the whole file is finished `computed_status === "COMPLETED"`
 *
 * ── WHY THESE GET THEIR OWN TONE TABLE ─────────────────────────────────────
 *
 * `ui/pill.tsx` carries the ERP's status map, which is right for the forty
 * statuses it covers and wrong for exactly these: `CURRENT` and `UPCOMING` are
 * not in it, so both would fall to the neutral default and the stage a visitor
 * came to the page to find would look identical to the six after it. Adding them
 * to the shared map instead would re-tint those tokens across the staff app,
 * where they mean something else. A small explicit table beats both.
 *
 * ── WHAT IS NOT IN THIS VOCABULARY ─────────────────────────────────────────
 *
 * DELAYED, AT RISK, DUE, HELD, EXCEPTION. Resolved decision 2: delay
 * attribution stays internal, and the tracking endpoint does not send it. A
 * component here that could render a red "delayed" badge is a component someone
 * eventually feeds a guess — a due date in the past is not a delay, it is a
 * planning figure the desk has not revised. There is no such badge to reach for.
 */
export type MilestoneState = "COMPLETED" | "CURRENT" | "UPCOMING";

const MILESTONE_TONE: Record<MilestoneState, Tone> = {
  COMPLETED: "ok",
  CURRENT: "orange",
  UPCOMING: "mute",
};

/**
 * The state of one milestone, from the two fields the API sends for it.
 *
 * `public_state` is the authority and the booleans are its companions, but a
 * payload where they disagree must still render something: this reads the word
 * first and falls back to the flags, so a milestone is never stateless. An
 * unrecognised word answers UPCOMING — the state that promises the least.
 */
export function milestoneState(m: {
  public_state?: string | null;
  is_complete?: boolean | null;
  is_current?: boolean | null;
}): MilestoneState {
  const named = String(m.public_state || "").toUpperCase();
  if (named === "COMPLETED" || named === "CURRENT" || named === "UPCOMING") {
    return named;
  }
  if (m.is_complete) return "COMPLETED";
  if (m.is_current) return "CURRENT";
  return "UPCOMING";
}

/** Is the whole file finished? The one derived state, kept here so no page
 *  re-derives it from a percentage and disagrees by one milestone. */
export const isClosed = (computedStatus?: string | null) =>
  String(computedStatus || "").toUpperCase() === "COMPLETED";

/** The state as a word, translated. */
export const milestoneStateLabel = (state: MilestoneState) =>
  tStatic(`states.milestone.${state.toLowerCase()}`);

/** The state as a pill — the same three colours wherever a chain is drawn. */
export function MilestoneStatePill({
  state,
  className,
}: {
  state: MilestoneState;
  className?: string;
}) {
  return (
    <Pill tone={MILESTONE_TONE[state]} className={className}>
      {milestoneStateLabel(state)}
    </Pill>
  );
}

/**
 * The marker on the timeline rail.
 *
 * Three visually distinct treatments rather than three shades of one: filled
 * with a tick for done, ringed and accented for the current stage, hollow and
 * numbered for what is still ahead. §3.3 asks for the states to be *designed*,
 * and a chain where the only difference is opacity is a chain a visitor reads as
 * "all the same" — which is the one thing this page must not say.
 *
 * The current marker also carries a soft halo. It is the single element a
 * visitor is looking for, and it has to survive being found on a phone in
 * sunlight.
 */
export function MilestoneMarker({
  state,
  index,
  icon,
}: {
  state: MilestoneState;
  index: number;
  /** The glyph for the CURRENT stage. Defaults to the truck; a page that knows
   *  the file's mode should pass `motionIcon(mode)` (UI_UPGRADE_PLAN §7.4). */
  icon?: IconComponent;
}) {
  const done = state === "COMPLETED";
  const current = state === "CURRENT";
  const Motion = icon || TruckIcon;
  return (
    <span
      aria-hidden
      className={cn(
        "relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background transition-colors",
        done && "border-[var(--brand-orange)] bg-[var(--brand-orange)] text-[var(--primary-foreground)]",
        current &&
          "border-[var(--brand-orange)] text-[var(--brand-orange)] ring-4 ring-[rgb(var(--accent-rgb,0_0_0)/0.10)]",
        !done && !current && "border-border text-muted-foreground",
      )}
    >
      {done ? (
        <CheckIcon size={13} />
      ) : current ? (
        // A MOVING glyph, not a clock. The clock that was here read as
        // "waiting" — the one thing the stage a file is actually on is not —
        // and it is the marker a visitor's eye goes to first
        // (UI_UPGRADE_PLAN §7.4; their own page uses `fa-truck-moving`).
        <Motion size={13} />
      ) : (
        <span className="num text-[10px] font-semibold">{index + 1}</span>
      )}
    </span>
  );
}

/**
 * The mode glyph, from `service_type.mode`.
 *
 * The mapping is exhaustive over the tokens `tracking_public.service.js`
 * produces, and OTHER is a real case rather than a fallback: service types are
 * user-creatable, so a tenant's own key legitimately has no mode, and a box is
 * the honest picture of "freight, kind unstated". A ship would not be.
 */
export type ServiceMode =
  | "SEA"
  | "AIR"
  | "RAIL"
  | "ROAD"
  | "WAREHOUSE"
  | "CUSTOMS"
  | "OTHER";

const MODE_ICON: Record<ServiceMode, React.ComponentType<{ size?: number; className?: string }>> = {
  SEA: ShipIcon,
  AIR: PlaneIcon,
  // No rail glyph in the set, and one drawn for a single use would be the
  // twelfth icon nobody maintains. A rail movement is surface freight; the
  // truck reads as that, and the service NAME sits beside it saying which.
  RAIL: TruckIcon,
  ROAD: TruckIcon,
  WAREHOUSE: WarehouseIcon,
  CUSTOMS: DocumentIcon,
  OTHER: BoxIcon,
};

/**
 * The glyph for the stage a file is ON, from its service mode.
 *
 * Deliberately narrower than `MODE_ICON`: the marker has to say "moving", so a
 * mode with no vehicle of its own — warehousing, customs, a tenant's own key —
 * answers the truck rather than a warehouse or a document, which at 13px inside
 * a ring read as another static badge. Sea and air are the two that carry more
 * meaning as themselves than as "in transit".
 */
const MOTION_ICON: Partial<Record<ServiceMode, IconComponent>> = {
  SEA: ShipIcon,
  AIR: PlaneIcon,
};

/** The mode's glyph as a COMPONENT, for an `IconTile` — which owns the glyph's
 *  size and so cannot take a rendered element. `ModeIcon` stays for the inline
 *  case; this is the same table, read differently. */
export function modeIconFor(mode?: string | null): IconComponent {
  const key = String(mode || "OTHER").toUpperCase() as ServiceMode;
  return MODE_ICON[key] || BoxIcon;
}

export function motionIcon(mode?: string | null): IconComponent {
  const key = String(mode || "").toUpperCase() as ServiceMode;
  return MOTION_ICON[key] || TruckIcon;
}

export function ModeIcon({
  mode,
  size = 18,
  className,
}: {
  mode?: string | null;
  size?: number;
  className?: string;
}) {
  const key = String(mode || "OTHER").toUpperCase() as ServiceMode;
  const Icon = MODE_ICON[key] || BoxIcon;
  return <Icon size={size} className={className} />;
}
