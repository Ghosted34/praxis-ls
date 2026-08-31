import * as React from "react";
import {
  isFeatureDisabled,
  listServices,
  type ServiceCard,
} from "./services-api";

/**
 * Published service profiles, fetched once per page load and shared.
 *
 * WHY A MODULE CACHE AND NOT A QUERY LIBRARY. The homepage, the services index,
 * the service page and the footer all want the same eleven rows, and `client`
 * solves that with TanStack Query. This app has no session, no cache
 * invalidation to coordinate and no mutating queries — and pulling in a query
 * library to memoise one GET is how a 100 kB budget becomes 140. A promise in
 * module scope is the same benefit at nine lines, with the one trade worth
 * naming out loud: it never revalidates, so a service published in the admin
 * appears on the next navigation from outside this app rather than instantly.
 * For a marketing page that is the right side of the bargain.
 */
let cache: Promise<ServiceCache> | null = null;

type ServiceCache = {
  services: ServiceCard[];
  /** The `website` feature is off for this tenant — no profiles exist to show,
   *  which is a configuration state, not an outage. */
  disabled: boolean;
  failed: boolean;
};

const EMPTY: ServiceCache = { services: [], disabled: false, failed: false };

function load(): Promise<ServiceCache> {
  if (!cache) {
    cache = listServices()
      .then((rows) => ({
        services: Array.isArray(rows) ? rows : [],
        disabled: false,
        failed: false,
      }))
      .catch((e) => {
        const disabled = isFeatureDisabled(e);
        // A FEATURE_DISABLED is a configuration answer, so it is cached like a
        // success — re-asking on every navigation would be re-asking a question
        // nobody changed. Anything else (timeout, 500, a dead dev proxy) drops
        // the cache so the next mount retries, which is what you want after a
        // transient failure and not what you want inside a redirect loop.
        if (!disabled) cache = null;
        return {
          services: [],
          disabled,
          failed: true,
        } satisfies ServiceCache;
      });
  }
  return cache;
}

/** Reset for tests and for a tenant re-brand in dev. Not called in the app. */
export function __resetServiceCache(): void {
  cache = null;
}

/**
 * `loading` exists because the absence of services has two causes and they need
 * two different screens. Before this flag the hook answered `{services: [],
 * disabled: false, failed: false}` BOTH while the request was in flight and
 * after a 200 that carried an empty array, so `/public/services` — whose ternary
 * reads "rows, else failed/disabled, else skeleton" — fell through to the
 * skeleton and stayed there for a tenant that has published nothing. A visitor
 * saw grey placeholder bars pulsing forever on a page that had already finished
 * loading. A caller that wants to distinguish "still asking" from "asked, and
 * the answer was none" cannot do it from three booleans that are identical in
 * both states.
 */
export function usePublishedServices(): ServiceCache & { loading: boolean } {
  const [state, setState] = React.useState<ServiceCache | null>(null);
  React.useEffect(() => {
    let alive = true;
    load().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);
  return { ...(state ?? EMPTY), loading: state === null };
}
