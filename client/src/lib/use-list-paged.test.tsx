/**
 * `useListPaged` — the hook that fixes the Finance hub's truncated lists (F8).
 *
 * THE BUG. The API clamps every list to 50 rows. `useList` requests no page and
 * reports no total, so a screen that filtered its result in the browser was
 * filtering the 50 newest records: an invoice at row 200 was invisible, and the
 * hub said "No invoices match" for an invoice that exists. These tests pin the
 * three things that make the answer correct — the request carries limit/offset,
 * the search reaches the SERVER, and the total comes from the header rather
 * than from `rows.length`.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

import * as apiClient from "./api-client";
import { makeQueryClient } from "./query-client";
import { useListPaged } from "./use-resource";

function wrapper() {
  const qc = makeQueryClient();
  qc.setDefaultOptions({ queries: { retry: false, gcTime: 0, staleTime: 0 } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/**
 * Typed from the function being spied on, NOT `ReturnType<typeof vi.spyOn>`.
 *
 * That idiom names the generic `vi.spyOn` without instantiating it, so it
 * resolves to `MockInstance<(this: unknown, ...args: unknown[]) => unknown>` —
 * the uninstantiated default. `MockInstance` is invariant in its parameter, so
 * the real spy (`MockInstance<typeof apiClient.tenantPaged>`) will not assign to
 * it and `tsc -b` fails. It happened to compile under vitest 4 and stopped when
 * the client was pinned to vitest 3 to match vite 5; deriving the type from
 * `apiClient` instead is both more precise and indifferent to which major is
 * installed.
 */
let pagedSpy: MockInstance<typeof apiClient.tenantPaged>;
beforeEach(() => {
  pagedSpy = vi.spyOn(apiClient, "tenantPaged");
});
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A complete `Paged` envelope, so the fake returns what the real client returns.
 *
 * Every `mockResolvedValue` here used to pass `{ data, total }` only. `Paged`
 * also requires `limit`, `offset` and `hasMore` — the API F-26 metadata added so
 * a list screen could stop presenting the first 50 rows as the whole set — and
 * the fake was handing the hook `undefined` for all three. Nothing complained,
 * because the old `ReturnType<typeof vi.spyOn>` annotation erased the signature
 * and `mockResolvedValue` accepted anything at all.
 *
 * That is the same failure this remediation keeps meeting from a different
 * angle: a fake that cannot disagree with the contract it is standing in for.
 * Typing the spy properly is what surfaced it. No test below reads these three
 * fields, so filling them changes no assertion — it just stops the fixture
 * lying about the shape.
 */
function paged<T>(
  p: { data: T; total: number | null } & Partial<apiClient.Paged<T>>,
): apiClient.Paged<T> {
  return { limit: null, offset: null, hasMore: false, meta: null, ...p };
}

/** Renders the hook's output as text so assertions read off the DOM. */
function Probe({
  path,
  params,
}: {
  path: string;
  params?: Parameters<typeof useListPaged>[1];
}) {
  const l = useListPaged<{ id: string }>(path, params);
  return (
    <div>
      <span data-testid="total">{l.total}</span>
      <span data-testid="pageCount">{l.pageCount}</span>
      <span data-testid="page">{l.page}</span>
      <span data-testid="rows">
        {(l.rows || []).map((r) => r.id).join(",")}
      </span>
      <span data-testid="error">{l.error || ""}</span>
    </div>
  );
}

const url = () => String(pagedSpy.mock.calls[0][0]);

describe("useListPaged request shape", () => {
  it("sends limit and offset derived from a ZERO-based page", async () => {
    pagedSpy.mockResolvedValue(paged({ data: [], total: 0 }));
    render(
      <Probe path="/final-invoices" params={{ page: 2, pageSize: 25 }} />,
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(pagedSpy).toHaveBeenCalled());
    const q = new URL(url(), "http://x").searchParams;
    expect(q.get("limit")).toBe("25");
    // Page 2 zero-based is the THIRD page: offset 50, not 25 and not 75.
    expect(q.get("offset")).toBe("50");
  });

  it("sends the search to the server rather than filtering locally", async () => {
    pagedSpy.mockResolvedValue(paged({ data: [], total: 0 }));
    render(<Probe path="/final-invoices" params={{ q: "SBX-2026" }} />, {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(pagedSpy).toHaveBeenCalled());
    expect(new URL(url(), "http://x").searchParams.get("q")).toBe("SBX-2026");
  });

  it("omits an empty or whitespace-only search, so clearing the box is not a new query", async () => {
    pagedSpy.mockResolvedValue(paged({ data: [], total: 0 }));
    render(<Probe path="/final-invoices" params={{ q: "   " }} />, {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(pagedSpy).toHaveBeenCalled());
    expect(new URL(url(), "http://x").searchParams.has("q")).toBe(false);
  });

  it("does not fetch at all when the path is null", () => {
    pagedSpy.mockResolvedValue(paged({ data: [], total: 0 }));
    render(<Probe path={null as unknown as string} />, { wrapper: wrapper() });
    expect(pagedSpy).not.toHaveBeenCalled();
  });
});

describe("useListPaged totals", () => {
  it("reports the SERVER total, not the number of rows on this page", async () => {
    // The exact bug shape: 25 rows returned, 300 matching. Reading rows.length
    // here is what made the hub claim a tenant had 50 invoices.
    pagedSpy.mockResolvedValue(
      paged({
        data: Array.from({ length: 25 }, (_, i) => ({ id: `r${i}` })),
        total: 300,
      }),
    );
    render(<Probe path="/final-invoices" params={{ pageSize: 25 }} />, {
      wrapper: wrapper(),
    });

    await waitFor(() =>
      expect(screen.getByTestId("total")).toHaveTextContent("300"),
    );
    expect(screen.getByTestId("pageCount")).toHaveTextContent("12"); // ceil(300/25)
  });

  it("degrades to a single page when the endpoint reports no total", async () => {
    // X-Total-Count absent (or hidden by CORS) surfaces as null. One page is
    // the honest fallback; a pager built on a guessed count would lie.
    pagedSpy.mockResolvedValue(paged({ data: [{ id: "a" }], total: null }));
    render(<Probe path="/final-invoices" />, { wrapper: wrapper() });

    await waitFor(() =>
      expect(screen.getByTestId("rows")).toHaveTextContent("a"),
    );
    expect(screen.getByTestId("total")).toHaveTextContent("0");
    expect(screen.getByTestId("pageCount")).toHaveTextContent("1");
  });

  it("a non-array payload yields an empty page rather than throwing in the table", async () => {
    pagedSpy.mockResolvedValue(
      paged({ data: { nope: true } as never, total: 0 }),
    );
    render(<Probe path="/final-invoices" />, { wrapper: wrapper() });

    await waitFor(() =>
      expect(screen.getByTestId("pageCount")).toHaveTextContent("1"),
    );
    expect(screen.getByTestId("rows")).toHaveTextContent("");
  });

  it("clamps a negative page to the first page instead of sending offset -25", async () => {
    pagedSpy.mockResolvedValue(paged({ data: [], total: 0 }));
    render(
      <Probe path="/final-invoices" params={{ page: -3, pageSize: 25 }} />,
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(pagedSpy).toHaveBeenCalled());
    expect(new URL(url(), "http://x").searchParams.get("offset")).toBe("0");
    expect(screen.getByTestId("page")).toHaveTextContent("0");
  });
});

describe("useListPaged caching", () => {
  it("refetches when the page changes, and reuses the cache when it changes back", async () => {
    pagedSpy.mockResolvedValue(paged({ data: [], total: 100 }));
    const W = wrapper();

    function Pager() {
      const [page, setPage] = React.useState(0);
      return (
        <>
          <button onClick={() => setPage((p) => (p === 0 ? 1 : 0))}>
            toggle
          </button>
          <Probe path="/final-invoices" params={{ page, pageSize: 25 }} />
        </>
      );
    }
    const { getByText } = render(<Pager />, { wrapper: W });
    await waitFor(() => expect(pagedSpy).toHaveBeenCalledTimes(1));

    getByText("toggle").click();
    await waitFor(() => expect(pagedSpy).toHaveBeenCalledTimes(2));
    // The key IS the URL, so page 1 is a distinct entry — offset must differ.
    expect(
      new URL(String(pagedSpy.mock.calls[1][0]), "http://x").searchParams.get(
        "offset",
      ),
    ).toBe("25");
  });

  it("surfaces a server error as a formatted string, not an Error object", async () => {
    pagedSpy.mockRejectedValue(
      new apiClient.ApiError("FORBIDDEN", "nope", 403),
    );
    render(<Probe path="/final-invoices" />, { wrapper: wrapper() });

    // F-GAP-09: errMsg keeps the server's 403 message rather than flattening it.
    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent("nope"),
    );
  });
});
