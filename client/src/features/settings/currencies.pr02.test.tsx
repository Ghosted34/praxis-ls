/**
 * C-PR-02 — FX sync operations + rate-history contract (client).
 *
 * WHAT THESE PIN
 *   - The sync-status banner (audit #6) surfaces no-key, scheduler-disabled,
 *     last-error and stale states — an administrator can see whether sync is
 *     working without reading logs.
 *   - The rate-history table shows WHO set a manual override (audit #9).
 *   - The history table pages beyond the first page via GET /currencies/rate-history
 *     (audit #3), appending rows and hiding "Load more" when exhausted.
 *   - The page no longer prefetches the unused /currencies/rates (audit #10).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

const gets: string[] = [];
const posts: { path: string; init?: { method?: string; body?: unknown } }[] = [];
let rateHistoryReply: unknown = { data: [], total: 0, limit: 50, offset: 0, has_more: false };

vi.mock("@/lib/api-client", async () => {
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method) posts.push({ path, init });
      else gets.push(path);
      if (path.startsWith("/currencies/rate-history")) return Promise.resolve(rateHistoryReply);
      return base.tenant(path);
    },
  };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { CurrenciesPage } from "./currencies";

const LIST = [
  { code: "XAF", name: "CFA Franc BEAC", symbol: "FCFA", is_base: true, is_active: true, decimals: 0, usage_count: 5, most_used: true },
  { code: "USD", name: "US Dollar", symbol: "$", is_base: false, is_active: true, decimals: 2, usage_count: 2 },
];

function usdDossier(extra: Record<string, unknown> = {}) {
  return {
    currency: LIST[1],
    base: "XAF",
    is_base: false,
    catalogue: { code: "USD", name: "US Dollar", symbol: "$", decimals: 2, numeric: "840" },
    countries: [],
    rate_history: [
      { rate: 0.00163, as_of_date: "2026-09-19", source: "manual", is_override: true, fetched_at: "2026-09-19T08:00:00.000Z", set_by_name: "Marie NGO" },
      { rate: 0.00162, as_of_date: "2026-09-18", source: "exchangerate-api", is_override: false, fetched_at: "2026-09-18T00:05:00.000Z" },
    ],
    rate_history_total: 4,
    rate_history_page_size: 50,
    rate_history_has_more: true,
    latest_rate: { rate: 0.00163, as_of_date: "2026-09-19", source: "manual", is_override: true },
    last_sync: { rate: 0.00162, as_of_date: "2026-09-18", source: "exchangerate-api", fetched_at: "2026-09-18T00:05:00.000Z" },
    overrides: [{ rate: 0.00163, as_of_date: "2026-09-19", source: "manual", fetched_at: "2026-09-19T08:00:00.000Z", set_by_name: "Marie NGO" }],
    usage: [],
    usage_total: 0,
    ...extra,
  };
}

function routes(syncStatus: unknown, extra: Record<string, unknown> = {}) {
  return {
    "/currencies": LIST,
    "/currencies/sync-status": { data: syncStatus },
    "/currencies/XAF/360": { ...usdDossier(), currency: LIST[0], is_base: true, rate_history: [], rate_history_total: 0, rate_history_has_more: false, latest_rate: null, last_sync: null, overrides: [] },
    "/currencies/USD/360": usdDossier(),
    ...extra,
  };
}

beforeEach(() => {
  gets.length = 0;
  posts.length = 0;
  rateHistoryReply = { data: [], total: 4, limit: 50, offset: 2, has_more: false };
  fixtures.current = {};
});

describe("Currencies page — C-PR-02 sync ops & rate history", () => {
  it("does not prefetch the unused /currencies/rates endpoint", async () => {
    renderScreen(<CurrenciesPage />, { routes: routes({ key_configured: true, scheduler_enabled: true, base: "XAF", last_run: null }) });
    await screen.findByRole("heading", { name: /Currencies & FX/i });
    await waitFor(() => expect(gets.length).toBeGreaterThan(0));
    expect(gets.some((p) => p === "/currencies/rates" || p.startsWith("/currencies/rates?"))).toBe(false);
  });

  it("warns when no provider key is configured", async () => {
    renderScreen(<CurrenciesPage />, { routes: routes({ key_configured: false, scheduler_enabled: true, base: "XAF", last_run: null }) });
    expect(await screen.findByText(/no provider key is configured/i)).toBeInTheDocument();
  });

  it("warns when the nightly scheduler is disabled", async () => {
    renderScreen(<CurrenciesPage />, {
      routes: routes({
        key_configured: true,
        scheduler_enabled: false,
        base: "XAF",
        last_run: { base_code: "XAF", trigger: "manual", status: "ok", updated_count: 3, unsupported: [], reason: null, started_at: "2026-09-19T08:00:00.000Z", finished_at: "2026-09-19T08:00:05.000Z" },
      }),
    });
    expect(await screen.findByText(/Nightly sync is disabled/i)).toBeInTheDocument();
  });

  it("surfaces the last sync error", async () => {
    renderScreen(<CurrenciesPage />, {
      routes: routes({
        key_configured: true,
        scheduler_enabled: true,
        base: "XAF",
        last_run: { base_code: "XAF", trigger: "cron", status: "error", updated_count: 0, unsupported: [], reason: "exchangerate-api: HTTP 500", started_at: "2026-09-19T00:00:00.000Z", finished_at: "2026-09-19T00:00:02.000Z" },
      }),
    });
    expect(await screen.findByText(/Last sync failed/i)).toBeInTheDocument();
    expect(await screen.findByText(/HTTP 500/i)).toBeInTheDocument();
  });

  it("shows who set a manual override in the rate-history table", async () => {
    const user = userEvent.setup();
    renderScreen(<CurrenciesPage />, { routes: routes({ key_configured: true, scheduler_enabled: true, base: "XAF", last_run: null }) });
    await screen.findByRole("heading", { name: /Currencies & FX/i });
    await user.click(await screen.findByText("US Dollar"));
    // The override row names the actor.
    expect(await screen.findByText("Marie NGO")).toBeInTheDocument();
  });

  it("loads more history via /currencies/rate-history and appends rows", async () => {
    const user = userEvent.setup();
    rateHistoryReply = {
      data: [
        { rate: 0.00161, as_of_date: "2026-09-17", source: "exchangerate-api", is_override: false, fetched_at: "2026-09-17T00:05:00.000Z" },
        { rate: 0.0016, as_of_date: "2026-09-16", source: "exchangerate-api", is_override: false, fetched_at: "2026-09-16T00:05:00.000Z" },
      ],
      total: 4,
      limit: 50,
      offset: 2,
      has_more: false,
    };
    renderScreen(<CurrenciesPage />, { routes: routes({ key_configured: true, scheduler_enabled: true, base: "XAF", last_run: null }) });
    await screen.findByRole("heading", { name: /Currencies & FX/i });
    await user.click(await screen.findByText("US Dollar"));
    // First page: 2 rows, "Showing 2 of 4".
    expect(await screen.findByText(/Showing 2 of 4/i)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /Load more/i }));
    await waitFor(() =>
      expect(gets.some((p) => p.startsWith("/currencies/rate-history") && p.includes("offset=2"))).toBe(true),
    );
    expect(await screen.findByText(/Showing 4 of 4/i)).toBeInTheDocument();
    // Exhausted → no more button.
    expect(screen.queryByRole("button", { name: /Load more/i })).not.toBeInTheDocument();
  });
});
