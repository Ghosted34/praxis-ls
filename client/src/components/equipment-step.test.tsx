/**
 * The Dictionary Finder's equipment step — the end of the flow the brief names.
 *
 * WHAT IS BEING PROVED. Picking a charge flagged `varies_by_equipment` on a file
 * that holds 3 × 20' RF and 2 × 40' HC must hand the form TWO picks, already
 * quantified from the file, so it can make two pre-priced lines. Before 0663 the
 * costing form resolved a rate from a container type and then discarded the
 * choice, which is how two "Port Charges" rows at different unit costs end up on
 * a sheet with nothing saying which box each was for.
 *
 * The three branches that matter are all here: flagged + dossier (pre-filled),
 * not flagged (no step at all — an office-supplies line is one plain line), and
 * flagged + no dossier (a purchase order gets the full list, nothing ticked).
 *
 * Backwards compatibility is the fourth: a caller that passes no `onPickMulti`
 * must behave exactly as it did, because five of the six existing call sites do
 * not pass one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const searchDict = vi.fn();
const listDictRefs = vi.fn();
const getDossierContainers = vi.fn();

vi.mock("@/lib/masterdata-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/masterdata-api")>("@/lib/masterdata-api");
  return { ...actual, searchDict: (...a: unknown[]) => searchDict(...a), listDictRefs: (...a: unknown[]) => listDictRefs(...a) };
});
vi.mock("@/lib/operations-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations-api")>("@/lib/operations-api");
  return { ...actual, getDossierContainers: (...a: unknown[]) => getDossierContainers(...a) };
});

import { DictionaryFinder } from "./dictionary-finder";
import type { EquipmentPick } from "./equipment-step";

const PORT_CHARGES = {
  dictionary_item_id: "d1", code: "#-2201", label_en: "Port Charges", label_fr: "Frais de port",
  direction: "EXPENSE", category: "service", varies_by_equipment: true,
};
const OFFICE = {
  dictionary_item_id: "d2", code: "#-9001", label_en: "Office Supplies", label_fr: "Fournitures",
  direction: "EXPENSE", category: "overhead", varies_by_equipment: false,
};

const TYPES = [
  { ref_id: "rf20", kind: "CONTAINER_TYPE", code: "RF20", name_en: "20' Reefer", name_fr: "20' Frigo", extra: { teu: 1, size: "20", family: "REEFER" } },
  { ref_id: "hc40", kind: "CONTAINER_TYPE", code: "FT40HC", name_en: "40' High Cube", name_fr: "40' HC", extra: { teu: 2, size: "40HC", family: "DRY" } },
  { ref_id: "dry20", kind: "CONTAINER_TYPE", code: "FT20", name_en: "20' Dry", name_fr: "20' Sec", extra: { teu: 1, size: "20", family: "DRY" } },
];

/** SEA-2026-0142: 3 × 20' RF and 2 × 40' HC. */
const ON_FILE = {
  enabled: true, mode: "GROUPED",
  lines: [
    { container_type_ref_id: "rf20", qty: 3 },
    { container_type_ref_id: "hc40", qty: 2 },
  ],
};

function view(props: Partial<React.ComponentProps<typeof DictionaryFinder>> = {}) {
  const onPick = vi.fn();
  const onPickMulti = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } })}>
      <DictionaryFinder onPick={onPick} onPickMulti={onPickMulti} {...props} />
    </QueryClientProvider>,
  );
  return { onPick, onPickMulti };
}

/** Open the popover and search a term until its row appears. */
async function search(user: ReturnType<typeof userEvent.setup>, term: string, rowName: RegExp) {
  await user.click(screen.getByRole("button", { name: "Financial dictionary line" }));
  await user.type(screen.getByRole("textbox", { name: "Financial dictionary line" }), term);
  return screen.findByRole("option", { name: rowName }, { timeout: 3000 });
}

beforeEach(() => {
  searchDict.mockReset();
  listDictRefs.mockReset();
  getDossierContainers.mockReset();
  searchDict.mockImplementation(async ({ q }: { q: string }) =>
    /port/i.test(q) ? [PORT_CHARGES] : /office/i.test(q) ? [OFFICE] : [],
  );
  listDictRefs.mockResolvedValue(TYPES);
  getDossierContainers.mockResolvedValue(ON_FILE);
});

describe("DictionaryFinder · equipment step", () => {
  it("pre-fills from the dossier and returns one pick per container type", async () => {
    const user = userEvent.setup();
    const { onPickMulti, onPick } = view({ dossierId: "dos-142" });

    await user.click(await search(user, "port charges", /Port Charges/));

    // The step, not the caller, is now on screen — and the file's boxes are on it.
    const rf = await screen.findByLabelText("Quantity, 20' Reefer");
    expect((rf as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Quantity, 40' High Cube") as HTMLInputElement).value).toBe("2");
    // A type NOT on the file is listed but untouched.
    expect((screen.getByLabelText("Quantity, 20' Dry") as HTMLInputElement).value).toBe("");
    // 3 × 1 TEU + 2 × 2 TEU.
    expect(screen.getByText(/7 TEU/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add lines" }));

    expect(onPick).not.toHaveBeenCalled();
    await waitFor(() => expect(onPickMulti).toHaveBeenCalledTimes(1));
    const [id, label, hit, picks] = onPickMulti.mock.calls[0] as [string, string, unknown, EquipmentPick[]];
    expect(id).toBe("d1");
    expect(label).toBe("Port Charges");
    expect((hit as { varies_by_equipment: boolean }).varies_by_equipment).toBe(true);
    expect(picks).toEqual([
      { container_type_ref_id: "rf20", qty: 3, label: "20' Reefer" },
      { container_type_ref_id: "hc40", qty: 2, label: "40' High Cube" },
    ]);
  });

  it("shows no step for a charge with no equipment dimension", async () => {
    const user = userEvent.setup();
    const { onPick, onPickMulti } = view({ dossierId: "dos-142" });

    await user.click(await search(user, "office supplies", /Office Supplies/));

    await waitFor(() => expect(onPick).toHaveBeenCalledWith("d2", "Office Supplies", expect.anything()));
    expect(onPickMulti).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add lines" })).toBeNull();
  });

  it("lists every active type with nothing ticked when there is no dossier", async () => {
    const user = userEvent.setup();
    const { onPickMulti } = view({ dossierId: null });

    await user.click(await search(user, "port charges", /Port Charges/));

    expect(getDossierContainers).not.toHaveBeenCalled();
    for (const name of ["20' Reefer", "40' High Cube", "20' Dry"]) {
      expect((await screen.findByLabelText(`Quantity, ${name}`) as HTMLInputElement).value).toBe("");
    }
    // Nothing chosen means nothing to add.
    expect((screen.getByRole("button", { name: "Add lines" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("checkbox", { name: /40' High Cube/ }));
    expect((screen.getByLabelText("Quantity, 40' High Cube") as HTMLInputElement).value).toBe("1");
    await user.click(screen.getByRole("button", { name: "Add lines" }));

    await waitFor(() => expect(onPickMulti).toHaveBeenCalledTimes(1));
    expect(onPickMulti.mock.calls[0][3]).toEqual([{ container_type_ref_id: "hc40", qty: 1, label: "40' High Cube" }]);
  });

  it("offers the escape hatch on an unflagged charge, and reaches the same step", async () => {
    const user = userEvent.setup();
    const { onPick, onPickMulti } = view({ dossierId: "dos-142" });

    await search(user, "office supplies", /Office Supplies/);
    await user.click(screen.getByRole("button", { name: "+ Equipment" }));

    // It is the SAME step, so it still pre-fills from the file — the hatch
    // changes which charges can reach it, not what it does once reached.
    expect(onPick).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("checkbox", { name: /20' Dry/ }));
    await user.click(screen.getByRole("button", { name: "Add lines" }));

    await waitFor(() => expect(onPickMulti).toHaveBeenCalledTimes(1));
    expect(onPickMulti.mock.calls[0][0]).toBe("d2");
    expect(onPickMulti.mock.calls[0][3]).toEqual([
      { container_type_ref_id: "rf20", qty: 3, label: "20' Reefer" },
      { container_type_ref_id: "hc40", qty: 2, label: "40' High Cube" },
      { container_type_ref_id: "dry20", qty: 1, label: "20' Dry" },
    ]);
  });

  it("behaves exactly as before for a caller that passes no onPickMulti", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } })}>
        <DictionaryFinder onPick={onPick} />
      </QueryClientProvider>,
    );

    await user.click(await search(user, "port charges", /Port Charges/));

    // Flagged or not, an opted-out caller gets the one-argument flow it had.
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("d1", "Port Charges", expect.anything()));
    expect(screen.queryByRole("button", { name: "Add lines" })).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Equipment" })).toBeNull();
    expect(listDictRefs).not.toHaveBeenCalled();
  });
});
