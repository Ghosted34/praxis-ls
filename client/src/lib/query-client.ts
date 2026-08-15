/**
 * The app's single QueryClient (audit F8, F16).
 *
 * WHY THIS EXISTS. Before this, `useList`/`useResource` were bare
 * `useState` + `useEffect` with no cache, no deduplication and no
 * stale-while-revalidate, so every mount refetched from zero. The measured
 * consequence: `features/finance/hub.tsx` fires NINE concurrent unpaginated
 * requests on load — /clients, /operations, /final-invoices, /proformas/advances,
 * /receivables, /journal-entries, /treasury-accounts, trial balance and ageing —
 * filters the results entirely client-side, and then refetches all nine every
 * time the user navigates back to it. `/clients` and `/operations` in particular
 * are pulled by many screens purely to build an id→name map.
 *
 * With a shared cache those become one request each per `staleTime` window,
 * shared across every screen that asks for them, and returning to a hub renders
 * instantly from cache while revalidating behind the scenes.
 *
 * DEFAULTS, and the reasoning for each:
 *
 *   staleTime 30s          An ERP is not a live ticker. Thirty seconds is long
 *                          enough to make back-navigation and cross-screen
 *                          lookups free, short enough that a colleague's edit
 *                          shows up without a manual refresh. Writes call
 *                          `useRefresh()` and do not wait for it.
 *   gcTime 5m              Keeps a screen's data warm across a detour into
 *                          another module.
 *   refetchOnWindowFocus   ON. Operators leave a dossier open on one monitor
 *                          for hours; coming back to stale numbers in a system
 *                          of record is worse than one extra request.
 *   retry 1, not 3         The API returns 403 for permission and 422 for
 *                          validation, and retrying either is pure latency. The
 *                          predicate below retries transport failures only, so
 *                          the real server message still reaches the user fast
 *                          (which is the whole point of the F12 fix).
 */
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";
import { tokenStore } from "./token-store";

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          // 4xx is a decision the server has already made — do not re-ask.
          if (
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500
          )
            return false;
          return failureCount < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = makeQueryClient();

/**
 * Root of every tenant-scoped query key, so a single `invalidateQueries` after
 * a write can refresh everything the user is looking at. See `useRefresh()`.
 */
export const TENANT_KEY = "tenant" as const;

/**
 * Build the cache key for a tenant-scoped fetch.
 *
 * ENV IS PART OF THE KEY — do not remove it. The api-client sends
 * `X-Praxis-Env` on every request, so a response is inherently scoped to LIVE
 * or SANDBOX. Before env was in the key, both environments shared one entry
 * per path, and switching LIVE ↔ TEST would return the OTHER environment's
 * data from cache — visibly for `staleTime` (30 s) and, even outside that,
 * as a flash of wrong data while the background revalidation was in flight.
 * A browser refresh appeared to "fix" it only because it wiped the in-memory
 * QueryClient. See `EnvToggle` / `switchEnv` in `app/layout/app-shell.tsx`.
 *
 * The env is read at CALL SITE from `tokenStore.getEnv()` — the same source
 * the request header uses, so the key can never disagree with the header the
 * response arrived under. Callers that pass this to `useQuery` re-run on
 * every render, so a state-change env switch produces a NEW key immediately
 * and TanStack treats it as a distinct query (fresh fetch, no staleness).
 *
 * Order matters: `[TENANT_KEY, env, path]` keeps `useRefresh()` — which
 * invalidates the whole `[TENANT_KEY]` prefix — working for both envs.
 */
export const tenantKey = (path: string) =>
  [TENANT_KEY, tokenStore.getEnv(), path] as const;
