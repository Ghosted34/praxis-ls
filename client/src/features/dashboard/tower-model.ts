/**
 * What is in the Control Tower's shortcut grid — shared by the launcher itself
 * and by the editor on My appearance, so the two cannot disagree about what
 * "pinned to the tower" means.
 *
 * THE 11+1 GRID. Eleven user-chosen tiles fill row 1 (six across) and the
 * first five slots of row 2; the sixth slot on row 2 is a fixed "+1" trigger
 * that expands the grid inline to show the modules a user could pin but has
 * not. Twelve slots either way, so the block below the KPI band is always the
 * same height — a home screen that jumps when you toggle it teaches nobody to
 * trust it.
 *
 * WHY NOT SHARE THE RAIL'S PINS. The rail is a strip of icons down the left
 * that stays visible on every screen; the tower grid is the home screen's
 * Applications block. A person who lives in Warehouse probably pins WMS to
 * both, but the two are different questions ("what do I want one click from
 * anywhere?" vs "what should my dashboard put in front of me?") — and letting
 * them diverge lets a warehouse operator pin Ledger to the tower without
 * losing WMS from the rail. The picker for each lives in the same place (My
 * appearance) for the same reason: both are personal display preferences
 * scoped to the caller through `/me/preferences/shell`.
 *
 * THE CONTROL TOWER IS NOT PINNABLE TO ITSELF, and neither is the tower's
 * shortcut editor (My appearance). Both are always one click away — the rail
 * — so offering them here would spend a slot on a shortcut a user already has
 * in the chrome. Everything else in `pinnableAreas(families)` is fair game.
 */
import { AREAS, areaRoute, sectionRoute, type Area, type AreaSection } from "@/app/layout/areas";
import { pinnableAreas } from "@/app/layout/rail-model";
import type { RibbonFamily } from "@/app/layout/ribbon-model";

/**
 * The user-visible cap on the shortcut grid.
 *
 * ELEVEN, not twelve, because the twelfth slot is the "More" trigger and it
 * is not a shortcut. A user reading the picker as "pick 12" and finding only
 * 11 make it to the dashboard is the failure mode this cap prevents.
 */
export const MAX_TOWER_PINS = 11;

/**
 * Number of tiles the launcher actually paints (11 + the "More" card). Kept
 * here so the picker's copy and the launcher's grid math cannot drift.
 */
export const TOWER_TILE_COUNT = MAX_TOWER_PINS + 1;

/**
 * How many sub-navigation tabs a tile's subtitle previews.
 *
 * FOUR, because four fits on one line at the desktop tile width without
 * wrapping, and it is what the user asked for. Modules with fewer than four
 * sections just render fewer — the picker draws the same tile shape either
 * way.
 */
export const TOWER_SUBNAV_PREVIEW = 4;

/**
 * The starter set the tower shows before a user has arranged anything.
 *
 * ELEVEN AREAS mapped to the same modules the previous hardcoded launcher
 * covered — Operations, Fleet, Warehouse, Finance (invoices), Treasury (a
 * master-data account list), CRM, Procurement, HR, plus Commercial and Vault
 * that were missing from the twelve-tile launcher and are two of the modules
 * an operator actually opens daily. Settings is last because that is the one
 * every role ends up in but rarely first thing in the morning.
 *
 * Filtered by access at resolve time — a user without Fleet does not see
 * Fleet — so this list is what CAN appear, not what always does.
 */
export const DEFAULT_TOWER_PINS = [
  "operations",
  "fleet",
  "wms",
  "finance",
  "master",
  "sales",
  "commercial",
  "procurement",
  "hr",
  "vault",
  "settings",
];

/** Areas that are not shortcut targets in the tower even when the user can
 *  reach them: the Control Tower itself (we are already there) and Support &
 *  feedback (drawn as its own thing in the top nav, not a "module"). */
const NOT_PINNABLE_IN_TOWER = new Set(["tower", "support"]);

/** The candidate list the picker offers and the set a pin must survive. */
export function pinnableTowerAreas(families: RibbonFamily[]): Area[] {
  return pinnableAreas(families).filter((a) => !NOT_PINNABLE_IN_TOWER.has(a.key));
}

/**
 * What the launcher offers when the shell has NOT resolved yet — every
 * top-level area, unfiltered.
 *
 * Same principle as `useCanOpenRoute`: an unresolved read is
 * indistinguishable from a user with no access, and a home screen that
 * collapses to a single "More" card for a second on every first login teaches
 * the user the feature is broken. Over-offering for one frame is recoverable.
 *
 * The launcher renders these as ordinary tiles; a click that would 403 lands
 * on the same route-access page it does from any stale link, which is the
 * behaviour every other offering surface in the shell already has.
 */
export function unresolvedFallbackAreas(): Area[] {
  return AREAS.filter((a) => !NOT_PINNABLE_IN_TOWER.has(a.key));
}

/**
 * The tower's shortcuts for one user, resolved to real areas.
 *
 * Same rules as `resolveRailPins`, and for the same reasons:
 *   - `null` (never chosen) → the default set, filtered by what this user
 *     can actually reach;
 *   - `[]` (deliberately empty) → an empty top row and just the "More" card;
 *   - a saved list has its stale keys dropped rather than rendered dead, so a
 *     revoked grant takes the tile away instead of leaving one that 403s;
 *   - the length is capped at MAX_TOWER_PINS on the way out — a stored list
 *     from a client that ignored the cap must not overflow the grid.
 */
export function resolveTowerPins(saved: string[] | null | undefined, families: RibbonFamily[]): Area[] {
  const available = pinnableTowerAreas(families);
  const byKey = new Map(available.map((a) => [a.key, a]));

  if (saved) {
    return saved.map((k) => byKey.get(k)).filter((a): a is Area => !!a).slice(0, MAX_TOWER_PINS);
  }

  const defaults = DEFAULT_TOWER_PINS.map((k) => byKey.get(k)).filter((a): a is Area => !!a);
  // A user who can see none of the defaults — a warehouse-only or finance-only
  // role — would otherwise get an empty tower this function exists to
  // prevent. Fall through to whatever they CAN see, in ribbon order.
  return (defaults.length > 0 ? defaults : available.slice(0, MAX_TOWER_PINS)).slice(0, MAX_TOWER_PINS);
}

/** The pinnable areas this user has NOT pinned — what the "More" card
 *  reveals. Preserves ribbon order rather than pin order so the expanded
 *  grid reads the same way for everyone. */
export function unpinnedTowerAreas(pinned: Area[], families: RibbonFamily[]): Area[] {
  const pinnedKeys = new Set(pinned.map((a) => a.key));
  return pinnableTowerAreas(families).filter((a) => !pinnedKeys.has(a.key));
}

/** One deep-link in a tile's subtitle: a section's label and its route. */
export type TowerSubnav = { key: string; label: string; to: string };

/**
 * The first N sections of an area, as deep links.
 *
 * SECTIONS COME FROM THE RIBBON, NOT FROM `AREAS` DIRECTLY, because the
 * ribbon has already filtered them by what this user can read. A tile that
 * previewed sections the user cannot open would render three deep links that
 * 403, which is the opposite of the promise the tile makes ("here is what is
 * inside"). For an area not on the ribbon at all (a role with only the
 * area's landing page) this returns `[]` and the caller renders the tile
 * without a subtitle strip.
 */
export function previewSections(
  area: Area,
  families: RibbonFamily[],
  count: number = TOWER_SUBNAV_PREVIEW,
): TowerSubnav[] {
  const found = families
    .flatMap((f) => f.areas)
    .find((ra) => ra.area.key === area.key);
  const sections: AreaSection[] = found ? found.sections : [];
  return sections.slice(0, count).map((s) => ({
    key: s.key,
    label: s.label,
    to: sectionRoute(area, s),
  }));
}

/** An area's own landing page — the destination the tile's body opens. */
export const towerLandingRoute = (area: Area): string => areaRoute(area);

/** Label for a stored key even when the area is not currently visible — the
 *  editor lists what you pinned, not only what you can reach today. */
export const towerAreaLabel = (key: string): string => AREAS.find((a) => a.key === key)?.label ?? key;
