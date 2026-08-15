/**
 * What the navigation shell is allowed to render — `GET /permissions/mine`.
 *
 * The taxonomy is the SERVER'S. `groups` is the ordered list of workflow verbs
 * this user has any module in, and `byGroup` says which modules fall under
 * each; both come from `platform.module_catalogue.group_key`, so there is no
 * second copy of the grouping in this codebase to drift from it. The client's
 * only contribution is presentation — a label and a glyph per verb
 * (`app/layout/ribbon-model.ts`), and the route a module key belongs to
 * (`app/screen-registry.json`).
 *
 * `version` is a short digest the server recomputes per request. The shell uses
 * it as a CHEAP "did anything move" hint and nothing more — the decision about
 * what to DO with a change is made by comparing the `modules` sets, in
 * `nav-access-cache.ts`. That split is deliberate: the digest answers "is this
 * the same answer as last time", which is not the same question as "did this
 * user lose something", and only the second one may throw away unsaved work.
 */
import { tenant } from "./api-client";

export type NavAccess = {
  /** MOD-xx keys this user can read, sorted. */
  modules: string[];
  /** The workflow verbs those keys fall into, in catalogue order. */
  groups: string[];
  /** verb → its visible module keys. Same partition as `groups`, spelled out. */
  byGroup: Record<string, string[]>;
  /** The CEO bypass the enforcement path applies, so the shell agrees with it. */
  isCeo: boolean;
  version: string;
};

/**
 * What the shell renders before the answer arrives, and if it never does.
 *
 * EMPTY, NOT EVERYTHING. A failed permissions fetch must not fall open into a
 * full ribbon: the destinations would 403 on click, which looks like a broken
 * product rather than a restricted one, and it would flash a CEO's surface at
 * someone who is not one. The icon rail's fixed entries (Control Tower, search)
 * are not gated on this, so the shell is still usable while it loads.
 */
export const NO_ACCESS: NavAccess = {
  modules: [],
  groups: [],
  byGroup: {},
  isCeo: false,
  version: "",
};

/**
 * Coerce whatever came back into the shape the shell indexes into.
 *
 * NOT DEFENSIVE PROGRAMMING FOR ITS OWN SAKE. The shell reads `groups.filter`
 * and `Object.entries(byGroup)` on the very first render, so a response that is
 * missing a key — an older API still deployed, a proxy returning an envelope, a
 * test fixture — is not a degraded ribbon, it is a TypeError inside a render
 * that takes the whole application down. The chrome is the one component that
 * cannot afford to be the thing that crashes: every screen is inside it.
 *
 * Exported because the OPTIMISTIC CACHE reads through it too. A record written
 * by an older build of this app is exactly the "older shape" case above, and it
 * arrives at first paint — before any network call — so an untrusted cache would
 * be a way to crash the shell with no server involved at all.
 */
export function coerceNavAccess(raw: unknown): NavAccess {
  const a = (raw ?? {}) as Partial<NavAccess>;
  return {
    modules: Array.isArray(a.modules) ? a.modules : [],
    groups: Array.isArray(a.groups) ? a.groups : [],
    byGroup:
      a.byGroup && typeof a.byGroup === "object" && !Array.isArray(a.byGroup)
        ? a.byGroup
        : {},
    isCeo: Boolean(a.isCeo),
    version: typeof a.version === "string" ? a.version : "",
  };
}

export const fetchNavAccess = async (): Promise<NavAccess> =>
  coerceNavAccess(await tenant<unknown>("/permissions/mine"));
