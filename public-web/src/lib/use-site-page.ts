import * as React from "react";
import { HOME_PAGE_KEY, getSitePage, type SitePage } from "./site-api";

/**
 * The tenant's home page, fetched once per load and shared.
 *
 * ── WHY A MODULE CACHE ─────────────────────────────────────────────────────
 *
 * Four bands on the marketing page now read this one row — the hero, the
 * figures strip, the how-it-works list and the quote band — and before this
 * hook the strip fetched it privately in its own effect. A second consumer
 * would have made that two requests for one page, a fourth would have made it
 * four, and each would have re-rendered on its own timeline so the hero could
 * settle a beat after the strip beneath it. Same reasoning as
 * `use-services.ts`, and deliberately the same nine lines rather than a query
 * library: this app has no session and no invalidation to coordinate, and
 * pulling in TanStack Query to memoise one GET is how a 100 kB budget becomes
 * 140.
 *
 * ── WHY `null` IS NOT THE SAME AS "STILL LOADING" ─────────────────────────
 *
 * `getSitePage` answers null for all three of: no such page, page unpublished,
 * `website` package off. Every one of them means "the tenant has not overridden
 * anything", which is a normal state and the state most tenants are in — so
 * consumers fall back to their dictionary copy rather than showing a spinner or
 * an error. `loading` exists only so a band can avoid painting the dictionary
 * text for one frame and then swapping it for the tenant's.
 */
const cache = new Map<string, Promise<SitePage | null>>();

function load(key: string): Promise<SitePage | null> {
  if (!cache.has(key)) {
    // `Promise.resolve().then(...)` rather than calling straight into a
    // `.catch()` chain: a `.catch` only ever sees a REJECTION, so if the read
    // threw synchronously — no `fetch` on the global, a bad base path — the
    // error would escape `load()` into the effect that called it and take the
    // whole marketing page down. Wrapping first makes every failure a rejection,
    // which is the one the caller is written to handle.
    cache.set(
      key,
      Promise.resolve()
        .then(() => getSitePage(key))
        .catch(() => null),
    );
  }
  return cache.get(key) as Promise<SitePage | null>;
}

/** Reset for tests and for a tenant re-brand in dev. Not called in the app. */
export function __resetSitePageCache(): void {
  cache.clear();
}

/**
 * Any published page by key, fetched once per load and shared.
 *
 * ── WHY THE CACHE IS KEYED NOW AND WAS NOT BEFORE ─────────────────────────
 *
 * It held a single promise because there was a single reader: four bands of the
 * marketing page, all asking for `home`. 13792 added a second key — the careers
 * page's own blocks — and with one slot the second reader would have been
 * served the FIRST key's answer, so the careers page would have rendered the
 * home page's feature list or nothing at all depending on which mounted first.
 * A Map keyed by page key keeps the original property (one request per key per
 * load, shared by every consumer) and removes the collision.
 *
 * `null` still means all three of: no such page, page unpublished, `website`
 * package off. Every one of them means "the tenant has not authored this", which
 * is a normal state and the state most tenants are in — so consumers fall back
 * to their dictionary copy rather than showing a spinner or an error.
 */
export function useSitePage(key: string): { page: SitePage | null; loading: boolean } {
  const [state, setState] = React.useState<{ page: SitePage | null } | null>(null);
  React.useEffect(() => {
    let alive = true;
    setState(null);
    load(key).then((page) => alive && setState({ page }));
    return () => {
      alive = false;
    };
  }, [key]);
  return { page: state?.page ?? null, loading: state === null };
}

export function useHomePage(): { page: SitePage | null; loading: boolean } {
  return useSitePage(HOME_PAGE_KEY);
}
