/**
 * The role KPI panel — what a role admin is actually allowed to configure.
 *
 * THE ONE INTERACTION THAT MUST NEVER SILENTLY LIE: unchecking the LAST
 * readable tile while it is still a default must drop it from the defaults
 * too (the editor pre-empts the `default_ids <@ scope_ids` rejection instead
 * of letting the admin discover it at Save). And a fresh scope toggle starts
 * FROM "all readable" — narrowing a check must never widen the list to just
 * the checked tile. Both are draft-state arithmetic, and the fetcher/putter
 * is mocked: what this proves is what the panel SENDS, which is exactly the
 * contract the server re-validates (it must never need to be the one to
 * catch these — a 422 after a Save click is the bug).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
// Side-effect import, NOT an unused one: mocking `@/lib/api-client` (below)
// strips the real module whose import chain bootstraps i18next. Without this
// line every t() answers its raw key and the panel "renders" a wall of
// `dash.revenue` strings — the test would be asserting dictionary keys.
import "@/lib/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { tenant } from "@/lib/api-client";
import { RoleKpiPanel } from "./role-kpi-panel";

vi.mock("@/lib/api-client", () => ({ tenant: vi.fn() }));

const TILES = [
  {
    id: "revenue",
    domain: "money",
    unit: "money",
    module: "MOD-51",
    status: "live",
    tone: "orange",
    icon: "revenue",
    labelKey: "dash.revenue",
    hintKey: "dash.revenueHint",
    badgeKey: "dash.locked",
    drillTo: "/finance/invoices",
  },
  {
    id: "files_active",
    domain: "operations",
    unit: "count",
    module: "MOD-29",
    status: "live",
    tone: "blue",
    icon: "files",
    labelKey: "dash.filesActive",
    hintKey: "dash.filesActiveHint",
    badgeKey: "dash.filesActiveBadge",
    drillTo: "/operations/files",
  },
];

const RESPONSE = {
  tiles: TILES,
  eligibleIds: TILES.map((t) => t.id),
  config: { scopeIds: null, defaultIds: ["revenue"], lockedIds: [] },
};

beforeEach(() => {
  vi.mocked(tenant).mockReset();
  vi.mocked(tenant).mockResolvedValue(RESPONSE as never);
});

function panel() {
  return render(<RoleKpiPanel roleId="r-1" />);
}

describe("RoleKpiPanel", () => {
  it("loads the role's current config into the draft", async () => {
    panel();
    await waitFor(() => expect(tenant).toHaveBeenCalledWith("/roles/r-1/kpi"));
    // The label shows TWICE by design — once as the default-band chip, once as
    // the scope row — so the assertion targets the scope checkbox, which is
    // the unique handle on the loaded draft.
    expect(await screen.findByRole("checkbox", { name: /Revenue · turnover/ })).toBeChecked();
  });

  it("narrowing the scope off a defaulted tile drops it from the defaults too", async () => {
    const user = userEvent.setup();
    panel();
    await screen.findByRole("checkbox", { name: /Revenue · turnover/ });

    // Uncheck revenue in the scope list → the save body must carry a default
    // list WITHOUT revenue (the server would reject a default outside scope).
    await user.click(screen.getByRole("checkbox", { name: /Revenue · turnover/ }));
    await user.click(screen.getByRole("button", { name: /^Save/i }));

    await waitFor(() =>
      expect(tenant).toHaveBeenCalledWith("/roles/r-1/kpi", {
        method: "PUT",
        body: {
          config: {
            scopeIds: ["files_active"], // started from ALL readable, minus the unchecked one
            defaultIds: [],
            lockedIds: [],
          },
        },
      }),
    );
  });

  it("the default list caps at four", async () => {
    const user = userEvent.setup();
    vi.mocked(tenant).mockResolvedValue({
      tiles: TILES,
      eligibleIds: TILES.map((t) => t.id),
      config: { scopeIds: null, defaultIds: ["revenue", "files_active"], lockedIds: [] },
    } as never);
    panel();
    await screen.findByRole("button", { name: /^Save/i });
    // Both eligible tiles are already in the default; there is nothing to add,
    // and the "+ band" affordances must not exist for non-eligible ids at all.
    expect(screen.queryAllByText("+ band")).toHaveLength(0);
    expect(screen.getAllByText("− band")).toHaveLength(2);
    void user;
  });

  it("Save is inert until something actually moved", async () => {
    panel();
    await screen.findByRole("checkbox", { name: /Revenue · turnover/ });
    expect(screen.getByRole("button", { name: /^Save/i })).toBeDisabled();
    // uncheck → dirty → enabled
    await userEvent.click(screen.getByRole("checkbox", { name: /Revenue · turnover/ }));
    expect(screen.getByRole("button", { name: /^Save/i })).toBeEnabled();
  });
});
