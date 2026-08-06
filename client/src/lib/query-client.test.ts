/**
 * QueryClient defaults (F8/F16).
 *
 * The retry predicate is the one default with a user-visible consequence, so it
 * is pinned: retrying a 403 or a 422 adds latency to an answer the server has
 * already given, and it delays the specific message the F12 fix exists to
 * surface. Only transport failures are worth a second attempt.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ApiError } from "./api-client";
import { makeQueryClient, tenantKey, TENANT_KEY } from "./query-client";
import { tokenStore } from "./token-store";

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
    // TENANT_KEY must be the FIRST element — `useRefresh` invalidates that
    // prefix and every tenant query has to be swept. The env slot in the
    // middle is a sub-prefix (see the env-scoped tests below); a switch
    // never wants the other env's data, but a write in the current env
    // wants everything refreshed under either.
    expect(tenantKey("/clients")[0]).toBe(TENANT_KEY);
  });

  /*
   * ENV-SCOPED CACHING — the fix for the LIVE ↔ TEST stale-toggle defect.
   *
   * Before this, live and sandbox shared one cache entry per path. Switching
   * environments returned the other env's cached response for `staleTime`
   * (30 s), and even outside that flashed the wrong data during the
   * background revalidation. A browser reload appeared to fix it only because
   * it wiped the in-memory QueryClient.
   *
   * These tests pin the two properties the fix depends on: the key CHANGES
   * with env (so TanStack treats a switch as a new query), and it does so at
   * CALL TIME (so a state-driven env change produces the new key on the very
   * next render, without waiting for anything to invalidate).
   */
  describe("env-scoped cache keys (stale-toggle regression)", () => {
    let originalEnv: string;
    beforeEach(() => {
      originalEnv = tokenStore.getEnv();
    });
    afterEach(() => {
      tokenStore.setEnv(originalEnv);
    });

    it("names the env in the key so LIVE and TEST cannot alias each other", () => {
      tokenStore.setEnv("live");
      const live = tenantKey("/dashboard/control-tower");
      tokenStore.setEnv("sandbox");
      const sandbox = tenantKey("/dashboard/control-tower");
      expect(live).not.toEqual(sandbox);
      // And the difference is specifically the env slot, not the path.
      expect(live[live.length - 1]).toBe(sandbox[sandbox.length - 1]);
    });

    it("reads env fresh on each call so a switch reflects immediately", () => {
      tokenStore.setEnv("live");
      expect(tenantKey("/clients")).toContain("live");
      tokenStore.setEnv("sandbox");
      // The same tenantKey call now returns a sandbox-scoped key without any
      // module reload — this is what makes `key={env}`-driven remounts
      // produce a fresh fetch instead of a cache hit on the previous env.
      expect(tenantKey("/clients")).toContain("sandbox");
    });

    it("keeps TENANT_KEY as the outermost prefix so useRefresh still sweeps everything", () => {
      // useRefresh invalidates `[TENANT_KEY]`; the env slot must sit UNDER
      // that so a write in the current env still refreshes lists in both.
      // (Writes only happen in the current env, but a leftover cache under
      // the other env is only stale, not wrong — it will refetch on switch.)
      tokenStore.setEnv("live");
      expect(tenantKey("/clients")[0]).toBe(TENANT_KEY);
      tokenStore.setEnv("sandbox");
      expect(tenantKey("/clients")[0]).toBe(TENANT_KEY);
    });
  });
});
