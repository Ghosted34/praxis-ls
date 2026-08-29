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

export function usePublishedServices(): ServiceCache {
  const [state, setState] = React.useState<ServiceCache | null>(null);
  React.useEffect(() => {
    let alive = true;
    load().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);
  return state ?? EMPTY;
}
