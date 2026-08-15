/**
 * The data hooks: the F12 defect, the shim contract, and the F8 cache win.
 *
 * The double-wrap bug is the one live defect the audit found, and it is the kind
 * that reappears the moment someone reads `error` and reaches for `errMsg`
 * out of habit — so it is pinned here rather than only fixed at the call sites.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import { ApiError } from "./api-client";
import * as apiClient from "./api-client";
import { makeQueryClient } from "./query-client";
import { tokenStore } from "./token-store";
import { errMsg, useList, useResource } from "./use-resource";

function wrapper() {
  // A fresh client per test: retries off and no gc, so one test's cache can
  // never satisfy another's assertion about request counts.
  const qc = makeQueryClient();
  qc.setDefaultOptions({
    queries: { retry: false, gcTime: 0, staleTime: 30_000 },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// Typed from the spied function, not `ReturnType<typeof vi.spyOn>` — see the
// note in use-list-paged.test.tsx for why that idiom breaks under vitest 3.
let tenantSpy: MockInstance<typeof apiClient.tenant>;
beforeEach(() => {
  tenantSpy = vi.spyOn(apiClient, "tenant");
});
afterEach(() => {
  vi.restoreAllMocks();
});

/* ─────────────────────────── F12: the double wrap ────────────────────────── */

describe("errMsg (F12 — the double-wrap defect)", () => {
  it("turns a 403 into the permission sentence", () => {
    expect(errMsg(new ApiError("FORBIDDEN", "nope", 403))).toBe(
      "You don't have permission to do this.",
    );
  });

  it("keeps the server's own message for other statuses", () => {
    expect(
      errMsg(
        new ApiError("CONFLICT", "Period 2026-03 is already closed.", 409),
      ),
    ).toBe("Period 2026-03 is already closed.");
  });

  it("unpacks 422 details into field-level text (Finance's version, now canonical)", () => {
    const e = new ApiError("VALIDATION", "Invalid", 422, {
      amount: ["must be positive"],
      date: "required",
    });
    expect(errMsg(e)).toBe("amount: must be positive; date: required");
  });

  /**
   * THE BUG. `useList`/`useResource` return `error` as an already-formatted
   * STRING. 16 sites passed that string through `errMsg` again — and because a
   * string is not an ApiError, it fell to the default branch and replaced the
   * real server message with the generic one. A 403's "You don't have permission
   * to do this." became "Something went wrong.", which is precisely the message
   * the helper exists to avoid.
   */
  it("DESTROYS an already-formatted message if applied twice — why the 16 sites were a bug", () => {
    const once = errMsg(new ApiError("FORBIDDEN", "nope", 403));
    expect(once).toBe("You don't have permission to do this.");
    expect(errMsg(once)).toBe("Something went wrong.");
    expect(errMsg(once)).not.toBe(once);
  });
});

/* ────────────────────────── the shim's public shape ──────────────────────── */

function ListProbe({ path }: { path: string | null }) {
  const { rows, error, loading } = useList<{ id: string }>(path);
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <span data-testid="count">{rows === null ? "null" : rows.length}</span>
    </div>
  );
}

describe("useList", () => {
  it("returns rows, and reports loading until they arrive", async () => {
    tenantSpy.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    render(<ListProbe path="/clients" />, { wrapper: wrapper() });

    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    await waitFor(() =>
      expect(screen.getByTestId("count")).toHaveTextContent("2"),
    );
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  it("surfaces error as a FORMATTED STRING, not an Error — the contract F12 depends on", async () => {
    tenantSpy.mockRejectedValue(new ApiError("FORBIDDEN", "nope", 403));
    render(<ListProbe path="/clients" />, { wrapper: wrapper() });

    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent(
        "You don't have permission to do this.",
      ),
    );
  });

  it("does not fetch when the path is null (the shadow hook's `enabled` argument)", async () => {
    render(<ListProbe path={null} />, { wrapper: wrapper() });
    await waitFor(() =>
      expect(screen.getByTestId("loading")).toHaveTextContent("true"),
    );
    expect(tenantSpy).not.toHaveBeenCalled();
  });

  it("coerces a non-array body to [] rather than letting a table throw", async () => {
    tenantSpy.mockResolvedValue({ unexpected: "shape" } as unknown as {
      id: string;
    }[]);
    render(<ListProbe path="/clients" />, { wrapper: wrapper() });
    await waitFor(() =>
      expect(screen.getByTestId("count")).toHaveTextContent("0"),
    );
  });

  /**
   * F8. finance/hub.tsx fires nine concurrent unpaginated requests on load, and
   * /clients + /operations are pulled by many screens purely to build an
   * id→name map. Deduplication is the whole reason TanStack Query is here.
   */
  it("deduplicates concurrent readers of the same path to ONE request (F8)", async () => {
    tenantSpy.mockResolvedValue([{ id: "a" }]);
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <ListProbe path="/clients" />
        <ListProbe path="/clients" />
        <ListProbe path="/clients" />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("count")[0]).toHaveTextContent("1"),
    );
    expect(tenantSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * THE STALE-TOGGLE REGRESSION. Before env was in the cache key, this
   * sequence would return the LIVE payload to the sandbox render — the exact
   * defect the reporter saw in the screenshots (LIVE data on-screen after
   * switching to TEST, until a browser reload wiped the QueryClient).
   *
   * The assertion has two halves:
   *   (a) `tenant` is called TWICE — once for each env — proving the sandbox
   *       render didn't just satisfy itself from LIVE's cached entry;
   *   (b) the render actually shows the sandbox payload, proving the mount
   *       consumed the correct entry rather than the leftover LIVE one.
   */
  it("does NOT serve one env's cached data to the other after a switch", async () => {
    // Route responses by the header the api-client is sending. This models the
    // real backend (which returns different data per env) inside the spy.
    tenantSpy.mockImplementation(async () => {
      const env = tokenStore.getEnv();
      return env === "sandbox"
        ? [{ id: "sandbox-1" }, { id: "sandbox-2" }]
        : [{ id: "live-1" }];
    });

    const originalEnv = tokenStore.getEnv();
    try {
      tokenStore.setEnv("live");
      const Wrapper = wrapper();

      // First mount under LIVE — should see the single LIVE row.
      const { unmount } = render(
        <Wrapper>
          <ListProbe path="/clients" />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("count")).toHaveTextContent("1"),
      );

      // The env-switch: header flips, and the shell would remount its content
      // under `key={env}` in real life. Simulate the remount by unmounting and
      // rendering a fresh probe under the SAME wrapper (same QueryClient) so
      // the cache is genuinely shared across the two envs.
      unmount();
      tokenStore.setEnv("sandbox");

      render(
        <Wrapper>
          <ListProbe path="/clients" />
        </Wrapper>,
      );

      // The sandbox count is 2. Before the fix this waitFor would time out
      // because the LIVE-keyed cache entry answered instantly with count=1
      // and TanStack considered it fresh (staleTime=30s).
      await waitFor(() =>
        expect(screen.getByTestId("count")).toHaveTextContent("2"),
      );
      expect(tenantSpy).toHaveBeenCalledTimes(2);
    } finally {
      tokenStore.setEnv(originalEnv);
    }
  });
});

/* ───────────────────────────────  useResource  ───────────────────────────── */

function ResourceProbe({
  label,
  fetcher,
}: {
  label: string;
  fetcher: () => Promise<{ v: string }>;
}) {
  const { data, error, loading } = useResource(fetcher, [label]);
  return (
    <div>
      <span data-testid={`${label}-loading`}>{String(loading)}</span>
      <span data-testid={`${label}-error`}>{error ?? "none"}</span>
      <span data-testid={`${label}-value`}>{data?.v ?? "none"}</span>
    </div>
  );
}

describe("useResource", () => {
  it("returns data and a formatted error string", async () => {
    render(
      <ResourceProbe
        label="a"
        fetcher={() => Promise.resolve({ v: "hello" })}
      />,
      { wrapper: wrapper() },
    );
    await waitFor(() =>
      expect(screen.getByTestId("a-value")).toHaveTextContent("hello"),
    );
  });

  it("formats a rejection through errMsg exactly once", async () => {
    render(
      <ResourceProbe
        label="b"
        fetcher={() => Promise.reject(new ApiError("FORBIDDEN", "nope", 403))}
      />,
      { wrapper: wrapper() },
    );
    await waitFor(() =>
      expect(screen.getByTestId("b-error")).toHaveTextContent(
        "You don't have permission to do this.",
      ),
    );
  });

  /**
   * Two useResource calls with IDENTICAL deps must not collide. The cache key
   * includes the fetcher's source text for exactly this reason — keying on deps
   * alone would serve one call site the other's data, which in a ledger app
   * means showing the wrong account's balance.
   */
  it("keeps two fetchers with identical deps in separate cache entries", async () => {
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <ResourceProbe
          label="same"
          fetcher={() => Promise.resolve({ v: "FIRST" })}
        />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("same-value")).toHaveTextContent("FIRST"),
    );

    render(
      <Wrapper>
        <ResourceProbe
          label="same"
          fetcher={() => Promise.resolve({ v: "SECOND-DIFFERENT-BODY" })}
        />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId("same-value")
          .some((n) => n.textContent === "SECOND-DIFFERENT-BODY"),
      ).toBe(true),
    );
  });
});
