/**
 * Meeting 5 (21 Sep 2026) — changing what a dictionary line costs.
 *
 *   · "Apply to all shipping lines" opens with EVERY carrier ticked; the person
 *     unticks the exceptions, and only the carriers left ticked are sent.
 *   · A rate is in the tenant's base currency unless someone deliberately picks
 *     another — the currency is a statement, not a free box on every line.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const applyAll = vi.fn();
const supersede = vi.fn();
vi.mock("@/lib/masterdata-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/masterdata-api")>()),
  applyDictRateToProviders: (...a: unknown[]) => applyAll(...a),
  supersedeDictRate: (...a: unknown[]) => supersede(...a),
}));

import { ApplyToCarriersModal, SetRateModal } from "./rate-modals";

const CURRENCIES = [
  { code: "XAF", name: "CFA franc", is_base: true, is_active: true },
  { code: "EUR", name: "Euro", is_base: false, is_active: true },
];
const carrier = (id: string, name: string) => ({
  rate_provider_id: id,
  kind: "SHIPPING_LINE" as const,
  code: name.toUpperCase(),
  name,
  is_active: true,
});
const CARRIERS = [carrier("p1", "Maersk"), carrier("p2", "MSC"), carrier("p3", "CMA CGM")];

beforeEach(() => {
  applyAll.mockReset().mockResolvedValue({ applied: 2, evolution: {} });
  supersede.mockReset().mockResolvedValue({});
});

describe("Apply one rate to all carriers", () => {
  it("starts with every carrier ticked and sends only the ones left ticked", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderScreen(
      <ApplyToCarriersModal
        itemId="i1"
        kindLabel="sea carriers"
        providers={CARRIERS as never}
        onClose={() => {}}
        onSaved={onSaved}
      />,
      { routes: { "/currencies": CURRENCIES } },
    );

    for (const name of ["Maersk", "MSC", "CMA CGM"])
      expect(screen.getByRole("checkbox", { name })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "MSC" }));
    await user.type(screen.getByRole("spinbutton"), "72700");
    await user.click(screen.getByRole("button", { name: /apply to 2 carriers/i }));

    expect(applyAll).toHaveBeenCalledTimes(1);
    const [itemId, body] = applyAll.mock.calls[0];
    expect(itemId).toBe("i1");
    expect(body.rate_provider_ids).toEqual(["p1", "p3"]);
    expect(body.rate).toBe(72700);
    // No currency chosen → the server applies the base currency.
    expect(body.currency).toBeUndefined();
    expect(onSaved).toHaveBeenCalledWith(2);
  });

  it("cannot be saved with every carrier unticked", async () => {
    const user = userEvent.setup();
    renderScreen(
      <ApplyToCarriersModal
        itemId="i1"
        kindLabel="sea carriers"
        providers={CARRIERS as never}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { routes: { "/currencies": CURRENCIES } },
    );
    await user.click(screen.getByRole("checkbox", { name: "All" }));
    await user.type(screen.getByRole("spinbutton"), "10");
    expect(screen.getByRole("button", { name: /apply to 0 carriers/i })).toBeDisabled();
  });
});

describe("Set rate", () => {
  it("shows the base currency as a fact and sends none unless another is picked", async () => {
    const user = userEvent.setup();
    renderScreen(
      <SetRateModal
        itemId="i1"
        providerLabel="Standard rate"
        providerId={null}
        containerTypeId={null}
        containerTypeLabel={null}
        current={null}
        onClose={() => {}}
        onSaved={() => {}}
      />,
      { routes: { "/currencies": CURRENCIES } },
    );
    expect(await screen.findByText("XAF")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /other currency/i })).toBeInTheDocument();

    await user.type(screen.getByRole("spinbutton"), "20000");
    await user.click(screen.getByRole("button", { name: /save rate/i }));
    expect(supersede).toHaveBeenCalledTimes(1);
    const [, body] = supersede.mock.calls[0];
    expect(body).toMatchObject({ rate: 20000, rate_provider_id: null, container_type_ref_id: null });
    expect(body.currency).toBeUndefined();
  });
});
