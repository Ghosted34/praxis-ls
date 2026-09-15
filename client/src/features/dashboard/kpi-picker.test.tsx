/**
 * The band picker — the interaction contract of the "choose four" panel.
 *
 * WHAT these tests hold the component to, and why each one exists:
 *
 *   - DRAFT-THEN-APPLY. A click must not write. The band lives on the
 *     app's busiest screen; a picker that persisted on every toggle would
 *     refetch the tower mid-decision and reshuffle tiles under the cursor.
 *     So: Cancel after a toggle proves the null case, Apply proves the write.
 *
 *   - THE NULL VS [] SPLIT AT THE SAVE BOUNDARY. Apply-on-default persists
 *     `null` (follow the role), a cleared band persists `[]`. That
 *     distinction is one condition in `apply`, and the condition that was
 *     wrong most recently in this codebase's history (the rail hint) is
 *     exactly this kind of "absent means the opposite of empty" condition.
 *
 *   - LOCKED IS NOT REMOVABLE. The ✕ on a locked slot renders disabled, and
 *     the catalog row for a locked tile cannot unpick it — the ROLE said so.
 *
 *   - THE BAND IS FOUR, NOT FIVE, NOT "UP TO THE USER". Rows beyond the
 *     fourth are disabled rather than silently dropped — a choice you cannot
 *     see you will not trust.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { saveShellPrefs } from "@/lib/preferences";
import { KpiPicker } from "./components/kpi-picker";
import type { BandTileMeta, KpiCatalog } from "./kpi-model";

vi.mock("@/lib/preferences", () => ({
  saveShellPrefs: vi.fn(() => Promise.resolve({})),
}));

const tile = (over: Partial<BandTileMeta> = {}): BandTileMeta => ({
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
  ...over,
});

const catalog = (over: Partial<KpiCatalog> = {}): KpiCatalog => ({
  maxTiles: 4,
  tiles: [
    tile(),
    tile({
      id: "files_active",
      domain: "operations",
      unit: "count",
      labelKey: "dash.filesActive",
      hintKey: "dash.filesActiveHint",
      badgeKey: "dash.filesActiveBadge",
      tone: "blue",
      icon: "files",
      module: "MOD-29",
    }),
    tile({
      id: "compliance_open",
      domain: "operations",
      unit: "count",
      labelKey: "dash.complianceOpen",
      hintKey: "dash.complianceOpenHint",
      badgeKey: "dash.complianceOpenBadge",
      tone: "bad",
      icon: "compliance",
      module: "MOD-65",
    }),
    tile({
      id: "needs_location",
      domain: "operations",
      unit: "count",
      labelKey: "dash.needsLocation",
      hintKey: "dash.needsLocationHint",
      badgeKey: "dash.needsLocationBadge",
      tone: "warn",
      icon: "location",
      module: "MOD-00A",
    }),
    tile({
      id: "approvals_awaiting",
      domain: "operations",
      unit: "count",
      labelKey: "dash.approvalsAwaiting",
      hintKey: "dash.approvalsAwaitingHint",
      badgeKey: "dash.approvalsAwaitingBadge",
      tone: "mute",
      icon: "approvals",
      module: "MOD-00A",
    }),
  ],
  lockedIds: [],
  roleDefaultIds: [],
  currentIds: null,
  hiddenTileCount: 0,
  totalLive: 10,
  source: "default",
  roleNames: [],
  ...over,
});

function open(c: KpiCatalog, onClose = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <KpiPicker
          open
          onClose={onClose}
          catalog={c}
          bandSlotIds={c.currentIds ?? []}
          loading={false}
          error={null}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { qc, onClose };
}

beforeEach(() => vi.mocked(saveShellPrefs).mockClear());

describe("KpiPicker", () => {
  it("lists only the offered set and never names what the grants hide", () => {
    open(catalog());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Revenue · turnover")).toBeInTheDocument();
    expect(within(dialog).getByText("Approvals · awaiting")).toBeInTheDocument();
    // totalLive is five here by fixture; a hidden tile (say payroll) is not
    // even a row — it does not appear greyed either.
    expect(within(dialog).queryByText(/Payroll/)).not.toBeInTheDocument();
  });

  it("toggles write nothing until Apply, and Cancel writes nothing at all", async () => {
    const user = userEvent.setup();
    open(catalog());
    await user.click(screen.getByRole("button", { name: /Operations · active/ }));
    expect(saveShellPrefs).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(saveShellPrefs).not.toHaveBeenCalled();
  });

  it("Apply persists the ordered four, then closes", async () => {
    const user = userEvent.setup();
    const { onClose } = open(catalog());
    for (const label of [/Operations · active/, /Compliance · open/]) {
      await user.click(await screen.findByRole("button", { name: label }));
    }
    const apply = screen.getByRole("button", { name: /^Apply/i });
    expect(apply).toBeEnabled(); // the draft differs from the (empty) stored answer
    await user.click(screen.getByRole("button", { name: /Approvals · awaiting/ }));
    await user.click(screen.getByRole("button", { name: /Location queue/ }));
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(saveShellPrefs).toHaveBeenCalledWith({
      kpiPins: ["files_active", "compliance_open", "approvals_awaiting", "needs_location"],
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("the fifth pick is refused at the row, not silently dropped after Apply", () => {
    open(
      catalog({
        currentIds: ["revenue", "files_active", "compliance_open", "needs_location"],
      }),
    );
    expect(
      screen.getByRole("button", { name: /Approvals · awaiting/ }),
    ).toBeDisabled();
  });

  it("a locked tile cannot be removed but keeps its place in the draft", async () => {
    const user = userEvent.setup();
    open(
      catalog({
        currentIds: ["revenue", "files_active"],
        lockedIds: ["revenue"],
        roleDefaultIds: ["revenue"],
      }),
    );
    // The slot chip's ✕ for the locked first slot is disabled.
    const removes = screen.getAllByRole("button", { name: /Remove/i });
    expect(removes[0]).toBeDisabled();
    // And its catalog row still shows it as picked (clicking would remove → draftRemove refuses).
    await user.click(screen.getByRole("button", { name: /Revenue · turnover/ }));
    expect(saveShellPrefs).not.toHaveBeenCalled();
    const apply = screen.getByRole("button", { name: /^Apply/i });
    // Draft unchanged by the refused removal, so Apply is not dirty.
    expect(apply).toBeDisabled();
  });

  it("Restore role default is an Apply-time null, not an empty list", async () => {
    const user = userEvent.setup();
    open(
      catalog({
        currentIds: ["needs_location"],
        roleDefaultIds: ["revenue", "files_active"],
      }),
    );
    await user.click(screen.getByRole("button", { name: /Restore role default/i }));
    await user.click(screen.getByRole("button", { name: /^Apply/i }));
    expect(saveShellPrefs).toHaveBeenCalledWith({ kpiPins: null });
  });

  it("Clear my choice writes null immediately — the door back to following the role", async () => {
    const user = userEvent.setup();
    open(catalog({ currentIds: ["files_active"] }));
    await user.click(screen.getByRole("button", { name: /Clear my choice/i }));
    await vi.waitFor(() =>
      expect(saveShellPrefs).toHaveBeenCalledWith({ kpiPins: null }),
    );
  });

  it("a full band with nothing to say about it still reports the withheld count", () => {
    open(catalog({ hiddenTileCount: 5 }));
    expect(
      screen.getByText(/Offering 5 of 10 available tiles/),
    ).toBeInTheDocument();
  });
});
