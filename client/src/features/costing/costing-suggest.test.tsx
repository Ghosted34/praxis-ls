/**
 * Suggest charges after meeting 5:
 *   · CORE lines are offered ticked; every other mapped charge sits unticked
 *     under a collapsed, searchable "More charges" — no Basic/Advanced/Full.
 *   · Unticking works. It used not to: the sheet handed in a new Set of
 *     existing keys every render and the effect that ticks the defaults re-ran
 *     after every click, ticking everything again (01:40:51).
 */
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { SuggestDialog } from "./costing-suggest";

const line = (id: string, label: string, tier: string) => ({
  dictionary_item_id: id,
  item_code: `#D${id}`,
  label,
  label_en: label,
  label_fr: label,
  is_disbursement: true,
  is_billable: true,
  disbursement_vat_transparent: true,
  tax_code_id: null,
  tax_code: null,
  tax_rate_percent: null,
  tier,
  sort_order: 1,
  container_type_ref_id: null,
  container_type_code: null,
  container_type_label: null,
  qty: 1,
  qty_basis: "DEFAULT",
  unit_cost: 1000,
  currency: "XAF",
  price_source: "EXPENSE_RATE",
  price_note: null,
  expense_rate_id: null,
  effective_from: null,
  rate_scope: "DEFAULT",
});

const SUGGESTION = {
  file: { dossier_id: "d1", ref: "F-1", service_name_en: "Sea freight import", rate_provider_name: null, containers: [] },
  tier: "FULL",
  bands: [
    { tier: "BASIC", lines: [line("001", "Documentation Fee", "BASIC"), line("002", "THC", "BASIC")] },
    { tier: "ADVANCED", lines: [line("003", "Bank Charges", "ADVANCED")] },
    { tier: "FULL", lines: [line("004", "GPS Tracking", "FULL")] },
  ],
  counts: { total: 4, priced: 4, needs_price: 0, needs_quantity: 0, disbursements: 4 },
  defaults: { tax_code_id: "t1", tax_code: "TVA_STD", vat_regime: null },
};

/** Re-renders with a NEW Set every time, as the costing sheet does. */
function Harness({ onImport }: { onImport: (n: number) => void }) {
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  return (
    <div onClickCapture={() => force()}>
      <SuggestDialog
        dossierId="d1"
        currency="XAF"
        existingKeys={new Set<string>()}
        onImport={(lines) => onImport(lines.length)}
        onClose={() => {}}
      />
    </div>
  );
}

describe("Suggest charges — core ticked, more charges collapsed", () => {
  it("ticks the core lines only, and hides the rest behind 'More charges'", async () => {
    renderScreen(<Harness onImport={() => {}} />, { routes: { "/costings/suggest": SUGGESTION } });
    expect(await screen.findByRole("checkbox", { name: /Documentation Fee/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /THC/ })).toBeChecked();
    expect(screen.queryByText("GPS Tracking")).toBeNull();
    expect(screen.queryByText(/Basic|Advanced|Full/)).toBeNull();
    expect(screen.getByRole("button", { name: /More charges for this service \(2\)/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("unticking a line keeps it unticked through re-renders (the meeting-5 bug)", async () => {
    const user = userEvent.setup();
    renderScreen(<Harness onImport={() => {}} />, { routes: { "/costings/suggest": SUGGESTION } });
    const doc = await screen.findByRole("checkbox", { name: /Documentation Fee/ });
    await user.click(doc);
    expect(doc).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /THC/ }));
    expect(screen.getByRole("checkbox", { name: /Documentation Fee/ })).not.toBeChecked();
  });

  it("'select all' unticks and reticks the whole core list", async () => {
    const user = userEvent.setup();
    renderScreen(<Harness onImport={() => {}} />, { routes: { "/costings/suggest": SUGGESTION } });
    const all = await screen.findByRole("checkbox", { name: "Core charges" });
    await user.click(all);
    expect(screen.getByRole("checkbox", { name: /Documentation Fee/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /THC/ })).not.toBeChecked();
    await user.click(all);
    expect(screen.getByRole("checkbox", { name: /THC/ })).toBeChecked();
  });

  it("'More charges' opens, searches, and its lines start unticked", async () => {
    const user = userEvent.setup();
    renderScreen(<Harness onImport={() => {}} />, { routes: { "/costings/suggest": SUGGESTION } });
    await user.click(await screen.findByRole("button", { name: /More charges for this service/ }));
    expect(screen.getByRole("checkbox", { name: /GPS Tracking/ })).not.toBeChecked();
    await user.type(screen.getByRole("textbox", { name: /Search more charges/ }), "bank");
    expect(screen.getByRole("checkbox", { name: /Bank Charges/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /GPS Tracking/ })).toBeNull();
  });
});
