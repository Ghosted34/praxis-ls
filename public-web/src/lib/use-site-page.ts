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
let cache: Promise<SitePage | null> | null = null;

function load(): Promise<SitePage | null> {
  if (!cache) {
    cache = getSitePage(HOME_PAGE_KEY).catch(() => null);
  }
  return cache;
}

/** Reset for tests and for a tenant re-brand in dev. Not called in the app. */
export function __resetSitePageCache(): void {
  cache = null;
}

export function useHomePage(): { page: SitePage | null; loading: boolean } {
  const [state, setState] = React.useState<{ page: SitePage | null } | null>(null);
  React.useEffect(() => {
    let alive = true;
    load().then((page) => alive && setState({ page }));
    return () => {
      alive = false;
    };
  }, []);
  return { page: state?.page ?? null, loading: state === null };
}
