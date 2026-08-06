/**
 * Data hook for the Control Tower's "Recent activity" widget — a self-scoped
 * page over `GET /tenant/audit/my-feed`.
 *
 * WHY DIRECT `useQuery` INSTEAD OF `useList` / `useListPaged`. The endpoint
 * ships a `{ data, meta }` envelope with a bespoke `window` flag ('24h' |
 * 'all_time') that the shared hooks don't surface. `apiPaged` (see
 * `client/src/lib/api-client.ts:202-227`) preserves the whole envelope, so the
 * meta rides through untouched and the widget can label the section head
 * accordingly.
 *
 * WHY `env` IS IN THE QUERY KEY. `tokenStore.getEnv()` (`'live' | 'sandbox'`)
 * is the value api-client sends as `X-Praxis-Env`, and the endpoint returns
 * different rows in each — so keying only by URL would leak sandbox rows into
 * a live view (or vice versa) when a user flips the environment toggle. The
 * env belongs in the cache key, not just the request.
 *
 * WHY `placeholderData: (prev) => prev`. Without this the page blanks to the
 * loading skeleton on every page-step, which reads as the list disappearing.
 * Same treatment as `useListPaged`.
 */
import { useQuery } from "@tanstack/react-query";
import { apiPaged } from "@/lib/api-client";
import { tenantKey } from "@/lib/query-client";
import { tokenStore } from "@/lib/token-store";

export type AuditFeedWindow = "24h" | "all_time";

export type AuditFeedMeta = {
  window: AuditFeedWindow;
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
};

export type AuditFeedRow = {
  ledger_id: number | string;
  created_at: string;
  action: string;
  module_key: string | null;
  entity_ref: string | null;
  metadata: Record<string, unknown> | null;
  is_sensitive: boolean;
  actor_name_snapshot: string | null;
};

/**
 * The server envelope, verbatim. The controller emits `{ data, meta }`; the
 * client's `apiPaged` unwraps `{ data }` and surfaces meta separately (see
 * `Paged<T>` in api-client.ts). We reassemble the two here into one object
 * the widget can consume.
 */
export type AuditFeedPage = {
  rows: AuditFeedRow[];
  meta: AuditFeedMeta | null;
};

const DEFAULT_META: AuditFeedMeta = {
  window: "all_time",
  page: 1,
  page_size: 10,
  total: 0,
  has_more: false,
};

export function useMyAuditFeed(page = 1) {
  const env = tokenStore.getEnv();
  return useQuery({
    // Include env in the key so a live→sandbox toggle can't serve the other
    // environment's cached page. The `page` is part of the key too so the
    // cache holds one entry per page instead of trampling it.
    queryKey: [...tenantKey("/audit/my-feed"), env, page] as const,
    queryFn: async (): Promise<AuditFeedPage> => {
      const res = await apiPaged<AuditFeedRow[]>(`/tenant/audit/my-feed?page=${page}`);
      const rows = Array.isArray(res.data) ? res.data : [];
      // Prefer the raw meta — the endpoint ships a bespoke `window` flag
      // ('24h' | 'all_time') that the shared numeric fields don't cover.
      // Falls back to the typed fields when the raw envelope is missing.
      const raw = res.meta || null;
      const rawWindow = raw && (raw.window === "24h" || raw.window === "all_time")
        ? (raw.window as AuditFeedWindow)
        : DEFAULT_META.window;
      const meta: AuditFeedMeta | null =
        typeof res.total === "number"
          ? {
              window: rawWindow,
              page: typeof raw?.page === "number" ? raw.page : page,
              page_size: typeof raw?.page_size === "number" ? raw.page_size : 10,
              total: res.total,
              has_more: res.hasMore,
            }
          : null;
      return { rows, meta };
    },
    // Same defaults as `queryClient.ts` (30s), but we also revalidate the top
    // page on a slow tempo so a coworker's action shows up without a manual
    // refresh. Deeper pages are stable snapshots — no polling.
    staleTime: 30_000,
    refetchInterval: page === 1 ? 60_000 : false,
    // 4xx are decisions the server has already made; retrying is pure latency.
    // Default retry policy already handles that — this stays explicit so a
    // reviewer can see the intent.
    retry: 1,
    // Keep the previous page's rows visible during a paged fetch — without
    // this every "Next" click blinks the list away.
    placeholderData: (prev) => prev,
  });
}
