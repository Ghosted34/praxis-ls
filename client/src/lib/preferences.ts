/**
 * Per-user preferences — backend `/me/preferences/*` (src/modules/preference).
 * Authenticated and always scoped to the caller; there is no user id in the
 * path, so this cannot read or write anyone else's.
 */
import { tenant } from "./api-client";

/**
 * A user's personal typography. Only the three type tokens are overridable —
 * colour, logo and favicon stay the company's (see preference.service.js).
 * `null` on a field means "inherit whatever the tenant set".
 */
export type UserAppearance = {
  fontDisplay: string | null;
  fontBody: string | null;
  fontMono: string | null;
};

export const EMPTY_USER_APPEARANCE: UserAppearance = {
  fontDisplay: null,
  fontBody: null,
  fontMono: null,
};

export const fetchUserAppearance = () => tenant<UserAppearance>("/me/preferences/appearance");

/** Partial — omit a key to leave it, send null to clear it back to the tenant's. */
export const saveUserAppearance = (patch: Partial<UserAppearance>) =>
  tenant<UserAppearance>("/me/preferences/appearance", { method: "PUT", body: patch });

/** Clear all three overrides at once. */
export const resetUserAppearance = () =>
  tenant<UserAppearance>("/me/preferences/appearance", { method: "DELETE" });

/**
 * How this user has arranged the application chrome.
 *
 * NULL MEANS "NEVER CHOSEN", NOT "OFF". `railPins: null` is a first login, and
 * the rail answers it with `DEFAULT_RAIL_PINS`; `railPins: []` is someone who
 * deliberately cleared it. Collapsing the two would either make the rail
 * impossible to empty or make it arrive empty for everybody — the state that
 * teaches nobody it can be customised at all.
 *
 * `towerPins` is the same rule for the Control Tower's Applications grid: null
 * shows the default eleven, [] is deliberately empty (nothing but the "More"
 * card). The two lists are independent — a rail arrangement and a home-screen
 * arrangement are not the same choice — and the client caps each one at its
 * own visible limit (rail: MAX_RAIL_PINS, tower: MAX_TOWER_PINS).
 */
export type ShellPrefs = {
  /** Is the ribbon's second row held open? Default (null) is pinned. */
  ribbonPinned: boolean | null;
  /** Area keys pinned to the icon rail, in the order they appear. */
  railPins: string[] | null;
  /** Area keys pinned to the Control Tower's 11+1 shortcut grid, in order. */
  towerPins: string[] | null;
  /** Has this user already been shown the "you can customise this" nudge? */
  railHintSeen: boolean | null;
};

export const EMPTY_SHELL_PREFS: ShellPrefs = {
  ribbonPinned: null,
  railPins: null,
  towerPins: null,
  railHintSeen: null,
};

/** Coerced at the boundary for the same reason `nav-access` is: the rail maps
 *  over `railPins` while rendering the chrome, so a body that is not the shape
 *  this expects would crash the app rather than lose a preference. `null` is a
 *  real value here — "never chosen" — so only the wrong TYPE is corrected. */
export const fetchShellPrefs = async (): Promise<ShellPrefs> => {
  const p = ((await tenant<unknown>("/me/preferences/shell")) ?? {}) as Partial<ShellPrefs>;
  return {
    ribbonPinned: typeof p.ribbonPinned === "boolean" ? p.ribbonPinned : null,
    railPins: Array.isArray(p.railPins) ? p.railPins.filter((k): k is string => typeof k === "string") : null,
    towerPins: Array.isArray(p.towerPins) ? p.towerPins.filter((k): k is string => typeof k === "string") : null,
    railHintSeen: typeof p.railHintSeen === "boolean" ? p.railHintSeen : null,
  };
};

/** Partial — omit a key to leave it, send null to clear it back to unchosen. */
export const saveShellPrefs = (patch: Partial<ShellPrefs>) =>
  tenant<ShellPrefs>("/me/preferences/shell", { method: "PUT", body: patch });
