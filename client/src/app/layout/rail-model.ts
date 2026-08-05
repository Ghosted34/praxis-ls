/**
 * What is in the icon rail — shared by the rail itself and by the editor on
 * My appearance, so the two cannot disagree about what "pinned" means.
 *
 * THE RAIL IS NOT A SECOND RIBBON. It is deliberately CONSTANT: the same
 * shortcuts whichever family the ribbon is showing. A rail that changed with
 * the ribbon would be a slower copy of it — you would have to look at the
 * ribbon first to know what the rail currently meant, which is the opposite of
 * what a fixed strip of icons is for. So this holds the Control Tower, search,
 * whatever the user pinned, and the quick actions, and nothing route-dependent.
 */
import { AREAS, areaRoute, type Area } from "./areas";
import type { RibbonFamily } from "./ribbon-model";

/**
 * What a first login gets.
 *
 * NOT EMPTY, AND THAT IS THE POINT. An empty rail with a `+` at the bottom
 * teaches nobody what the rail is for — a user has to guess that the strip of
 * two icons is customisable before they will ever customise it. Starting with
 * the four areas most people in a logistics business open daily makes the rail
 * useful before it is ever configured, and makes the `+` legible as "add
 * another one" rather than as "this thing is broken".
 *
 * Filtered by access, and backfilled if a user can see none of them — see
 * `resolveRailPins`.
 */
export const DEFAULT_RAIL_PINS = ["operations", "finance", "comms", "workspace"];

/** How many shortcuts a rail may hold. Bounded by the strip's height on a
 *  laptop, not by the API — the server caps at 16, this is the honest number. */
export const MAX_RAIL_PINS = 10;

/** Every area this user can actually reach, in ribbon order — the candidate set
 *  the editor offers and the set a pin must survive. */
export function pinnableAreas(families: RibbonFamily[]): Area[] {
  return families.flatMap((f) => f.areas.map((a) => a.area));
}

/**
 * The rail's shortcuts for one user.
 *
 * `saved === null` is a first login (the API's "never chosen"), so the default
 * set applies. `saved === []` is a rail somebody deliberately cleared, and it
 * stays cleared — the rail still has its fixed entries, so "cleared" never
 * means "empty".
 *
 * A pin whose area the user can no longer see is dropped rather than rendered
 * dead: losing a grant should take a shortcut away, not leave one that 403s.
 */
export function resolveRailPins(saved: string[] | null | undefined, families: RibbonFamily[]): Area[] {
  const available = pinnableAreas(families);
  const byKey = new Map(available.map((a) => [a.key, a]));

  if (saved) {
    return saved.map((k) => byKey.get(k)).filter((a): a is Area => !!a).slice(0, MAX_RAIL_PINS);
  }

  const defaults = DEFAULT_RAIL_PINS.map((k) => byKey.get(k)).filter((a): a is Area => !!a);
  // A user who can see none of the defaults — a warehouse-only or finance-only
  // role — would otherwise get the empty rail this function exists to prevent.
  return (defaults.length > 0 ? defaults : available.slice(0, 4)).slice(0, MAX_RAIL_PINS);
}

/** A pin's destination. */
export const pinRoute = (area: Area): string => areaRoute(area);

/** Label for a stored key even when the area is not currently visible — the
 *  editor lists what you pinned, not only what you can reach today. */
export const areaLabel = (key: string): string => AREAS.find((a) => a.key === key)?.label ?? key;
