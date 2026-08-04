/**
 * Shared data-fetch hooks — the four-states helper every wired screen uses.
 *
 * `useList(path)` fetches a tenant list endpoint into `{ rows, error, loading,
 * reload }`; `useResource(fn, deps)` does the same for a single/custom fetch.
 * 403 becomes a permission message (never a crash), matching FE_DESIGN_RULES §3.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE 2 (audit F8 / F16): these are now THIN SHIMS OVER TANSTACK QUERY.
 *
 * The public shape is deliberately byte-for-byte what it was, because 161 call
 * sites depend on it and this migration has to be incremental — a screen gets
 * caching, request deduplication and stale-while-revalidate without being
 * touched. New code that needs pagination, infinite lists, mutations or
 * optimistic updates should use `useQuery`/`useMutation` from
 * `@tanstack/react-query` directly rather than extending these.
 *
 * `error` is a FORMATTED STRING, not an Error. That is the contract, and 16
 * sites used to pass it through `errMsg()` a second time — which, because a
 * string is not an `ApiError`, fell to the default branch and replaced the real
 * server message (403 permission text included) with "Something went wrong."
 * Those are fixed; do not reintroduce the pattern. `errMsg` is for a caught
 * exception, never for the `error` these hooks return.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tenant, tenantPaged, ApiError } from "./api-client";
import { TENANT_KEY, tenantKey } from "./query-client";

/**
 * An untyped API row. The default `useList` element type, and what screens
 * rendering dynamic/report data work in. Relocated here from
 * `features/sales/ui.tsx:10`, where a shared type sat behind a feature folder.
 *
 * Prefer a real interface (`useList<Client>("/clients")`) wherever the shape is
 * known — `Row` is for genuinely dynamic payloads, not a shortcut past typing.
 */
export type Row = Record<string, unknown>;

/**
 * Turn a caught exception into a sentence for the user.
 *
 * THE ONE implementation (F6 — there were six: this file plus
 * `features/master/pages.tsx:22`, `features/sales/ui.tsx:12`,
 * `features/finance/pages.tsx:92`, `features/settings/master-data-pages.tsx:19`
 * and `features/settings/config-pages.tsx:23`).
 *
 * Five of the six were byte-identical. The sixth — Finance's `errMessage` — was
 * BETTER: it unpacked a 422's `details` into "field: message" instead of
 * showing the generic validation banner. Consolidating kept that behaviour and
 * gave it to the other five, rather than flattening to the lowest common
 * version. Every write surface in the ERP now tells the user WHICH field the
 * server rejected.
 *
 * (Routing those messages to the offending inputs rather than into one banner
 * is the remaining half of F12, and belongs to the Field/RHF work in PR2.)
 *
 * Call this in a `catch` block. Do NOT call it on the `error` string returned
 * by `useList`/`useResource` — that has already been through here.
 */
export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "You don't have permission to do this.";
    if (e.status === 422 && e.details && typeof e.details === "object") {
      const parts = Object.entries(e.details as Record<string, string[] | string>).map(
        ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`,
      );
      if (parts.length) return parts.join("; ");
    }
    return e.message || "Something went wrong.";
  }
  return "Something went wrong.";
}

/**
 * Invalidate every tenant query, so all mounted screens refetch.
 *
 * This replaces the `const [nonce, setNonce] = useState(0)` +
 * `reload = () => setNonce(n => n + 1)` pattern that the shadow
 * `features/sales/ui.tsx` `useList(path, nonce)` forced on its callers. Call it
 * after a write:
 *
 * @example
 * const refresh = useRefresh();
 * async function save() {
 *   await tenant("/clients", { method: "POST", body });
 *   refresh();
 * }
 *
 * It is deliberately coarse. A write in an ERP usually invalidates more than
 * the list it happened on (posting a journal entry moves the trial balance, the
 * ageing report and the dossier's cost roll-up), and the old per-page nonce
 * silently refreshed none of them. When you know the blast radius precisely,
 * prefer `queryClient.invalidateQueries({ queryKey: tenantKey("/clients") })`.
 */
export function useRefresh(): () => void {
  const qc = useQueryClient();
  return React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: [TENANT_KEY] });
  }, [qc]);
}

export function useList<T = Record<string, unknown>>(path: string | null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: tenantKey(path ?? ""),
    queryFn: () => tenant<T[]>(path as string),
    enabled: !!path,
    // The API returns a bare array; a non-array body means the endpoint changed
    // shape, and rendering a table off it would throw. Coerce, as before.
    select: (d) => (Array.isArray(d) ? d : ([] as T[])),
  });

  const reload = React.useCallback(() => {
    if (path) void qc.invalidateQueries({ queryKey: tenantKey(path) });
  }, [qc, path]);

  // The ONE correct errMsg call on a hook error: q.error is a thrown ApiError,
  // not the formatted string. Callers receive the string — see the header.
  const error = q.error ? errMsg(q.error) : null;

  return {
    rows: q.data ?? null,
    error,
    // Matches the previous `rows === null && !error`: a disabled hook (null
    // path) reports loading, exactly as the old effect-early-return did.
    loading: q.data === undefined && !error,
    reload,
  };
}

/** Query-string params for {@link useListPaged}. `q` is the free-text search. */
export type ListParams = {
  /** ZERO-based, matching `<Pagination>`'s `page` prop. */
  page?: number;
  pageSize?: number;
  q?: string;
} & Record<string, string | number | undefined>;

/** What {@link useListPaged} hands back, on top of `useList`'s shape. */
export type PagedList<T> = {
  rows: T[] | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  /** Rows matching the filter across ALL pages, not just the loaded one. */
  total: number;
  /** ZERO-based, echoing the `page` param. */
  page: number;
  pageSize: number;
  pageCount: number;
};

/**
 * A SERVER-PAGED list — one page of rows plus the true total.
 *
 * Use this, not `useList`, for any screen that renders a table the user
 * searches or scrolls. `useList` fetches whatever the API's default `LIMIT`
 * allows (50) and gives no indication that more exist, so a screen that filters
 * its result in the browser is filtering a truncated set. That is not a
 * performance nit: the Finance hub told users "No invoices match" for invoices
 * that existed, because the match sat past row 50. Paging and searching both
 * have to happen server-side for the answer to be correct.
 *
 * `total` comes from the `X-Total-Count` header. Endpoints that don't send one
 * report `total: 0` and `pageCount: 1`, which renders as a single page rather
 * than as a broken pager.
 *
 * @example
 * const [page, setPage] = React.useState(0);
 * const invoices = useListPaged<InvoiceRow>("/final-invoices", { page, pageSize: 25, q });
 * <DataList rows={invoices.rows} … />
 * <Pagination page={invoices.page} pageSize={invoices.pageSize}
 *             total={invoices.total} onPageChange={setPage} />
 */
export function useListPaged<T = Record<string, unknown>>(
  path: string | null,
  params: ListParams = {},
): PagedList<T> {
  const qc = useQueryClient();
  const { page: pageNo = 0, pageSize = 25, ...filters } = params;
  const safePage = Math.max(pageNo, 0);

  // Build the query string here so the cache key and the request cannot drift:
  // the key IS the URL. Empty/undefined filters are dropped so that clearing a
  // search box returns to the same cache entry as never having typed.
  const search = new URLSearchParams();
  search.set("limit", String(pageSize));
  search.set("offset", String(safePage * pageSize));
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== "") search.set(k, String(v).trim());
  });
  const url = path ? `${path}?${search.toString()}` : null;

  const query = useQuery({
    queryKey: tenantKey(url ?? ""),
    queryFn: () => tenantPaged<T[]>(url as string),
    enabled: !!url,
    // Without this the table blanks to the loading skeleton on every page step
    // and every keystroke, which reads as the data vanishing.
    placeholderData: (prev) => prev,
  });

  const reload = React.useCallback(() => {
    if (url) void qc.invalidateQueries({ queryKey: tenantKey(url) });
  }, [qc, url]);

  const error = query.error ? errMsg(query.error) : null;
  const raw = query.data?.data;
  const rows = raw === undefined ? null : Array.isArray(raw) ? raw : [];
  const total = query.data?.total ?? 0;

  return {
    rows,
    error,
    loading: query.data === undefined && !error,
    reload,
    total,
    page: safePage,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Stable cache key for a `useResource` call site.
 *
 * `deps` alone is not enough to identify a query: two `useResource` calls in
 * one component with the same deps (`useResource(() => getA(id), [id])` and
 * `useResource(() => getB(id), [id])`) would collide and serve each other's
 * data. The fetcher's source text discriminates them — it is stable per call
 * site across renders, and distinct between different function bodies in both
 * dev and minified builds.
 */
function resourceKey(fn: () => unknown, deps: React.DependencyList) {
  const serialisedDeps = deps.map((d) => {
    if (d === null || d === undefined) return String(d);
    if (typeof d === "object" || typeof d === "function") {
      try {
        return JSON.stringify(d);
      } catch {
        return "[unserialisable]";
      }
    }
    return String(d);
  });
  return [TENANT_KEY, "resource", fn.toString(), serialisedDeps] as const;
}

export function useResource<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const qc = useQueryClient();
  // The fetcher closes over render-scope values, so it must not be frozen into
  // the query — the KEY is what identifies the request; the latest closure is
  // what runs. Without this a stale closure would refetch with old arguments.
  const fnRef = React.useRef(fn);
  fnRef.current = fn;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const key = React.useMemo(() => resourceKey(fn, deps), deps);

  const q = useQuery({ queryKey: key, queryFn: () => fnRef.current() });

  const reload = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: key });
  }, [qc, key]);

  // The ONE correct errMsg call on a hook error: q.error is a thrown ApiError,
  // not the formatted string. Callers receive the string — see the header.
  const error = q.error ? errMsg(q.error) : null;

  return {
    data: (q.data ?? null) as T | null,
    error,
    loading: q.data === undefined && !error,
    reload,
  };
}
