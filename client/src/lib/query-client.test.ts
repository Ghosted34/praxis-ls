/**
 * QueryClient defaults (F8/F16).
 *
 * The retry predicate is the one default with a user-visible consequence, so it
 * is pinned: retrying a 403 or a 422 adds latency to an answer the server has
 * already given, and it delays the specific message the F12 fix exists to
 * surface. Only transport failures are worth a second attempt.
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "./api-client";
import { makeQueryClient, tenantKey, TENANT_KEY } from "./query-client";

function retryFn() {
  const opts = makeQueryClient().getDefaultOptions().queries!;
  return opts.retry as (failureCount: number, error: Error) => boolean;
}

describe("query defaults", () => {
  it("never retries a 4xx — the server has already decided", () => {
    const retry = retryFn();
    expect(retry(0, new ApiError("FORBIDDEN", "nope", 403))).toBe(false);
    expect(retry(0, new ApiError("VALIDATION", "bad", 422))).toBe(false);
    expect(retry(0, new ApiError("NOT_FOUND", "gone", 404))).toBe(false);
  });

  it("retries a transport or server failure exactly once", () => {
    const retry = retryFn();
    expect(retry(0, new Error("network down"))).toBe(true);
    expect(retry(1, new Error("network down"))).toBe(false);
    expect(retry(0, new ApiError("SERVER", "boom", 500))).toBe(true);
  });

  it("caches long enough to make back-navigation and cross-screen lookups free", () => {
    const q = makeQueryClient().getDefaultOptions().queries!;
    expect(q.staleTime).toBe(30_000);
    expect(q.refetchOnWindowFocus).toBe(true);
  });

  it("roots every tenant key under one prefix so useRefresh can invalidate the lot", () => {
    expect(tenantKey("/clients")).toEqual([TENANT_KEY, "/clients"]);
  });
});
