/**
 * C-PR-01 — Currency master invariants (deletion, base rebase, reactivation).
 *
 * WHAT THESE PIN
 *   - The base currency has NO Delete action, and a non-base currency's Delete
 *     goes through a destructive confirm (no accidental deletion).
 *   - A used currency's DELETE surfaces the CURRENCY_IN_USE conflict as a
 *     readable message that points at deactivation, rather than a raw error.
 *   - The "Set as base" confirm explains the REBASE (Gate-0 decision) — it must
 *     NOT still promise "nothing is recalculated".
 *   - A deactivated currency shows Activate and re-activates via PATCH.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  apiError,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

const calls: { path: string; init?: { method?: string; body?: unknown } }[] = [];

vi.mock("@/lib/api-client", async () => {
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method) calls.push({ path, init });
      return base.tenant(path);
    },
  };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { CurrenciesPage } from "./currencies";

const LIST = [
  { code: "XAF", name: "CFA Franc BEAC", symbol: "FCFA", is_base: true, is_active: true, decimals: 0, usage_count: 12, most_used: true },
  { code: "USD", name: "US Dollar", symbol: "$", is_base: false, is_active: true, decimals: 2, usage_count: 3 },
  { code: "EUR", name: "Euro", symbol: "€", is_base: false, is_active: false, decimals: 2, usage_count: 0 },
];

function dossier(code: string) {
  const c = LIST.find((x) => x.code === code)!;
  return {
    currency: c,
    base: "XAF",
    is_base: c.is_base,
    catalogue: { code, name: c.name, symbol: c.symbol, decimals: c.decimals, numeric: "000" },
    countries: [],
    rate_history: [],
    latest_rate: null,
    last_sync: null,
    overrides: [],
    usage: [],
    usage_total: 0,
  };
}

function baseRoutes(extra: Record<string, unknown> = {}) {
  // The harness matches fixtures by longest bare-path prefix (query stripped
  // from the REQUEST, not from keys), so keys must be bare paths.
  return {
    "/currencies": LIST,
    "/currencies/rates": [],
    "/currencies/XAF/360": dossier("XAF"),
    "/currencies/USD/360": dossier("USD"),
    "/currencies/EUR/360": dossier("EUR"),
    ...extra,
  };
}

beforeEach(() => {
  calls.length = 0;
  fixtures.current = {};
});

describe("Currencies page — C-PR-01 master invariants", () => {
  it("hides Delete on the base currency", async () => {
    renderScreen(<CurrenciesPage />, { routes: baseRoutes() });
    // XAF is base and selected first.
    await screen.findByRole("heading", { name: /Currencies & FX/i });
    const dossierRegion = await screen.findByText("CFA Franc BEAC");
    expect(dossierRegion).toBeInTheDocument();
    // No Delete / Set as base for the base currency.
    expect(screen.queryByRole("button", { name: /^Delete$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Set as base/i })).not.toBeInTheDocument();
  });

  it("the Set as base confirm explains the rebase and does not promise 'nothing is recalculated'", async () => {
    const user = userEvent.setup();
    renderScreen(<CurrenciesPage />, { routes: baseRoutes() });
    await screen.findByRole("heading", { name: /Currencies & FX/i });
    await user.click(await screen.findByText("US Dollar"));
    await user.click(await screen.findByRole("button", { name: /Set as base/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/rebased/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/nothing is\s+recalculated/i)).not.toBeInTheDocument();
  });

  it("sends POST /currencies/base and shows the rebased-count note", async () => {
    const user = userEvent.setup();
    renderScreen(<CurrenciesPage />, {
      routes: baseRoutes({
        "/currencies/base": { base: "USD", previous_base: "XAF", rebased: [{ quote: "XAF", rate: 613.5 }, { quote: "EUR", rate: 0.93 }] },
      }),
    });
    await screen.findByRole("heading", { name: /Currencies & FX/i });
    await user.click(await screen.findByText("US Dollar"));
    await user.click(await screen.findByRole("button", { name: /Set as base/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Set as base/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.path === "/currencies/base" && c.init?.method === "POST")).toBe(true),
    );
    expect(await screen.findByText(/2 rates were rebased from XAF/i)).toBeInTheDocument();
  });

  it("surfaces a CURRENCY_IN_USE conflict as a deactivate-instead message", async () => {
    const user = userEvent.setup();
    renderScreen(<CurrenciesPage />, {
      routes: baseRoutes({
        "/currencies/USD": apiError(
          409,
          "This currency is used by existing records and cannot be deleted. Deactivate it instead to remove it from new transactions while keeping its history.",
          "CURRENCY_IN_USE",
        ),
      }),
    });
    await screen.findByRole("heading", { name: /Currencies & FX/i });
    await user.click(await screen.findByText("US Dollar"));
    await user.click(await screen.findByRole("button", { name: /^Delete$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^Delete$/i }));
    expect(
      await screen.findByText(/used by existing records and cannot be deleted/i),
    ).toBeInTheDocument();
  });

  it("offers Activate on a deactivated currency and re-activates via PATCH", async () => {
    const user = userEvent.setup();
    renderScreen(<CurrenciesPage />, {
      routes: baseRoutes({ "/currencies/EUR": { code: "EUR", is_active: true } }),
    });
    await screen.findByRole("heading", { name: /Currencies & FX/i });
    await user.click(await screen.findByText("Euro"));
    await user.click(await screen.findByRole("button", { name: /Activate/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Activate/i }));
    await waitFor(() => {
      const patch = calls.find((c) => c.path === "/currencies/EUR" && c.init?.method === "PATCH");
      expect(patch).toBeTruthy();
      expect((patch!.init!.body as { is_active: boolean }).is_active).toBe(true);
    });
  });
});
