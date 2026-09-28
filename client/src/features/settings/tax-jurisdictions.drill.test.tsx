/**
 * Tax jurisdiction 360 → the count tiles open the codes they count.
 *
 * Pinned: Tax codes / Retenues / Paie & social are buttons; each lists one row
 * per CODE (a code with two dated versions is one row, as the tile counts it)
 * with the version in force; Retenues lists only withholding codes; TVA
 * standard and IS are rates and stay inert.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { TaxJurisdictionsPage } from "./tax-jurisdictions";

const CODES = [
  // Two versions of one code: the 2025 rate, superseded by the 2026 one.
  {
    tax_code_id: "t1",
    code: "TVA_STD",
    kind: "VAT",
    rate_percent: 17.5,
    effective_from: "2025-01-01",
    effective_to: "2025-12-31",
  },
  {
    tax_code_id: "t2",
    code: "TVA_STD",
    kind: "VAT",
    rate_percent: 19.25,
    effective_from: "2026-01-01",
    effective_to: null,
  },
  {
    tax_code_id: "t3",
    code: "IS_STD",
    kind: "INCOME",
    rate_percent: 33,
    effective_from: "2026-01-01",
  },
  {
    tax_code_id: "t4",
    code: "WHT_SERV",
    kind: "WHT",
    rate_percent: 5.5,
    effective_from: "2026-01-01",
  },
  {
    tax_code_id: "t5",
    code: "CNPS",
    kind: "PAYROLL",
    rate_percent: 4.2,
    effective_from: "2026-01-01",
  },
];
const ROUTES = {
  "/tax-jurisdictions": [
    {
      jurisdiction_id: "tj1",
      country_code: "CM",
      name: "Cameroon",
      currency: "XAF",
      is_active: true,
    },
  ],
  "/tax-jurisdictions/tj1": {
    jurisdiction_id: "tj1",
    country_code: "CM",
    name: "Cameroon",
    currency: "XAF",
    is_active: true,
    tax_codes: CODES,
  },
};

describe("Tax jurisdiction 360 · drill-ins", () => {
  it("lists one row per code, the version in force, and leaves the rates inert", async () => {
    renderScreen(<TaxJurisdictionsPage />, { routes: ROUTES });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^open tax codes$/i }),
    );
    const dialog = await screen.findByRole("dialog");
    const rows = within(dialog).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    const tva = rows.find((r) =>
      r.textContent?.includes("TVA_STD"),
    ) as HTMLElement;
    expect(tva).toHaveTextContent("19.25%");
    expect(tva).not.toHaveTextContent("17.5%");

    expect(
      screen.queryByRole("button", { name: /^open tva standard$/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^open is$/i })).toBeNull();
  });

  it("Retenues lists only the withholding codes", async () => {
    renderScreen(<TaxJurisdictionsPage />, { routes: ROUTES });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: /^open retenues$/i }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("WHT_SERV")).toBeInTheDocument();
    expect(within(dialog).queryByText("CNPS")).toBeNull();
    expect(within(dialog).queryByText("TVA_STD")).toBeNull();
  });
});
