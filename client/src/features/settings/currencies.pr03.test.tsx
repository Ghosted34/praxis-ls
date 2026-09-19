/**
 * C-PR-03 — Currency 360 discovery + chart UX (client).
 *
 * WHAT THESE PIN
 *   - The country list's "more" affordance is INTERACTIVE (audit #1): clicking
 *     "Show all N" reveals the rest and a search box; nothing dead-ends.
 *   - The rate chart is date-aware (audit #4): points expose date + exact rate
 *     via an accessible label, and the chart announces its date range.
 *   - The rate chart drills through: activating a point highlights the matching
 *     history row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { CurrenciesPage } from "./currencies";

// 20 countries so the preview (14) leaves 6 behind a "more" affordance.
const COUNTRIES = Array.from({ length: 20 }, (_, i) => ({
  code: ["FR", "DE", "IT", "ES", "PT", "NL", "BE", "AT", "IE", "FI", "GR", "SK", "SI", "LT", "LV", "EE", "LU", "MT", "CY", "HR"][i],
  name: `Country ${i + 1}`,
}));

const LIST = [
  { code: "XAF", name: "CFA Franc BEAC", symbol: "FCFA", is_base: true, is_active: true, decimals: 0 },
  { code: "EUR", name: "Euro", symbol: "€", is_base: false, is_active: true, decimals: 2 },
];

const EUR_DOSSIER = {
  currency: LIST[1],
  base: "XAF",
  is_base: false,
  catalogue: { code: "EUR", name: "Euro", symbol: "€", decimals: 2, numeric: "978" },
  countries: COUNTRIES,
  rate_history: [
    { rate: 656.1, as_of_date: "2026-09-19", source: "manual", is_override: true, fetched_at: "2026-09-19T08:00:00.000Z", set_by_name: "Marie NGO" },
    { rate: 655.9, as_of_date: "2026-09-18", source: "exchangerate-api", is_override: false, fetched_at: "2026-09-18T00:05:00.000Z" },
    { rate: 655.5, as_of_date: "2026-09-17", source: "exchangerate-api", is_override: false, fetched_at: "2026-09-17T00:05:00.000Z" },
  ],
  rate_history_total: 3,
  rate_history_page_size: 50,
  rate_history_has_more: false,
  latest_rate: { rate: 656.1, as_of_date: "2026-09-19", source: "manual", is_override: true },
  last_sync: { rate: 655.9, as_of_date: "2026-09-18", source: "exchangerate-api", fetched_at: "2026-09-18T00:05:00.000Z" },
  overrides: [],
  usage: [],
  usage_total: 0,
};

function routes() {
  return {
    "/currencies": LIST,
    "/currencies/sync-status": { data: { key_configured: true, scheduler_enabled: true, base: "XAF", last_run: null } },
    "/currencies/XAF/360": { ...EUR_DOSSIER, currency: LIST[0], is_base: true, countries: [], rate_history: [], rate_history_total: 0, latest_rate: null, last_sync: null },
    "/currencies/EUR/360": EUR_DOSSIER,
  };
}

beforeEach(() => {
  fixtures.current = {};
});

async function openEur(user: ReturnType<typeof userEvent.setup>) {
  renderScreen(<CurrenciesPage />, { routes: routes() });
  await screen.findByRole("heading", { name: /Currencies & FX/i });
  await user.click(await screen.findByText("Euro"));
}

describe("Currency 360 — C-PR-03 discovery & chart", () => {
  it("country list: only a preview shows until the interactive 'more' is used", async () => {
    const user = userEvent.setup();
    await openEur(user);
    // Preview shows 14; a "+6 more" / "Show all 20" affordance exists and is a button.
    expect(await screen.findByText(/Country 14/)).toBeInTheDocument();
    expect(screen.queryByText(/Country 20/)).not.toBeInTheDocument();
    // Both the header toggle ("Show all 20") and the inline chip ("+6 more") are
    // real buttons — neither is a dead-end label.
    expect(screen.getByRole("button", { name: /Show all 20/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\+6 more/i })).toBeInTheDocument();
  });

  it("country list: expanding reveals every country and a search box", async () => {
    const user = userEvent.setup();
    await openEur(user);
    await user.click(screen.getByRole("button", { name: /Show all 20/i }));
    expect(await screen.findByText(/Country 20/)).toBeInTheDocument();
    // Search narrows the expanded list.
    const search = screen.getByLabelText(/Search countries/i);
    await user.type(search, "Country 17");
    await waitFor(() => expect(screen.queryByText("Country 1")).not.toBeInTheDocument());
    expect(screen.getByText("Country 17")).toBeInTheDocument();
  });

  it("rate chart: is date-aware and announces its range", async () => {
    const user = userEvent.setup();
    await openEur(user);
    // The chart's accessible label carries the pair and date range.
    const chart = await screen.findByRole("img", { name: /Rate trend for XAF→EUR/i });
    expect(chart).toHaveAccessibleName(/2026-09-17 to 2026-09-19/);
    // Each point exposes its date + exact rate via an accessible button label.
    expect(within(chart).getByRole("button", { name: /2026-09-18: 1 XAF = 655.9 EUR/i })).toBeInTheDocument();
  });

  it("rate chart: activating a point highlights the matching history row", async () => {
    const user = userEvent.setup();
    await openEur(user);
    const chart = await screen.findByRole("img", { name: /Rate trend for XAF→EUR/i });
    // The oldest point (2026-09-17) is histIndex 2 → last table row.
    const point = within(chart).getByRole("button", { name: /2026-09-17:/i });
    await user.click(point);
    await waitFor(() => {
      const row = document.querySelector('[data-hist-row="2"]');
      expect(row?.className).toMatch(/bg-primary/);
    });
  });

  // Production feedback: the tooltip never showed because the hit target was a
  // 4px dot, and the growing hovered dot made the chart feel like it moved.
  // Hover is now owned by the whole SVG surface and maps to the NEAREST point.
  it("rate chart: hovering the surface (not a dot) reveals the nearest point's date + rate", async () => {
    const user = userEvent.setup();
    await openEur(user);
    const chart = await screen.findByRole("img", { name: /Rate trend for XAF→EUR/i });
    // jsdom rects are all-zero; give the SVG its real 220×44 box at (0,0).
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 220, bottom: 44,
      width: 220, height: 44, toJSON: () => ({}),
    } as DOMRect);
    // x=110 of 220 → middle of 3 points → 2026-09-18 @ 655.9.
    fireEvent.mouseMove(chart, { clientX: 110, clientY: 22 });
    expect(
      await screen.findByText("2026-09-18: 1 XAF = 655.9 EUR · exchangerate-api"),
    ).toBeInTheDocument();
    // Leaving the chart clears the tooltip back to the hint.
    fireEvent.mouseLeave(chart);
    await waitFor(() =>
      expect(
        screen.getByText("Hover or focus a point for its date and exact rate."),
      ).toBeInTheDocument(),
    );
  });
});
