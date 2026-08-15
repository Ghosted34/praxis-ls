/**
 * Dictionary settings → Container types: the tenant can add a box size, and
 * cannot add a broken one.
 *
 * WHY THIS IS GUARDED. `CONTAINER_TYPE` used to be seed-only — a carrier
 * introducing a 50' unit meant a code change or raw SQL. Opening it to the gear
 * modal is only safe because of the three extra fields this asserts: a type
 * created with an empty `extra` is accepted by every consumer and read as ZERO
 * TEU (`Number(undefined) || 0` in the container editor and in the shipment TEU
 * total) with no rate-card key. Nothing raises. The tenant sees a container type
 * that works and a capacity report that quietly under-counts, which is the worst
 * shape a bug can take, so the form must refuse it before the API is called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";

const listDictRefs = vi.fn();
const createDictRef = vi.fn();

vi.mock("@/lib/masterdata-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/masterdata-api")>(
    "@/lib/masterdata-api",
  );
  return {
    ...actual,
    listDictRefs: (...a: unknown[]) => listDictRefs(...a),
    createDictRef: (...a: unknown[]) => createDictRef(...a),
    updateDictRef: vi.fn(),
  };
});

import { FinancialDictionarySettings } from "./financial-dictionary-settings";

const view = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: 0, staleTime: 0 },
          },
        })
      }
    >
      <ToastProvider>
        <FinancialDictionarySettings open onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );

/** Open the Container types tab and reveal the add form. */
async function openAddForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: "Container types" }),
  );
  await user.click(await screen.findByRole("button", { name: "+ Add new" }));
}

beforeEach(() => {
  listDictRefs.mockReset();
  createDictRef.mockReset();
  listDictRefs.mockResolvedValue([
    {
      ref_id: "ct1",
      kind: "CONTAINER_TYPE",
      code: "FT40HC",
      name_fr: "40' HC",
      name_en: "40' High Cube",
      is_system: true,
      extra: { teu: 2, size: "40HC", family: "DRY" },
    },
  ]);
  createDictRef.mockResolvedValue({ ref_id: "ct2" });
});

describe("Dictionary settings · Container types", () => {
  it("offers the tab at all — the kind used to be seed-only", async () => {
    view();
    expect(
      await screen.findByRole("button", { name: "Container types" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load modes" })).toBeTruthy();
  });

  it("refuses a type with no TEU, with the message on the field", async () => {
    const user = userEvent.setup();
    view();
    await openAddForm(user);

    await user.type(screen.getByLabelText("Code"), "FT50HC");
    await user.type(screen.getByLabelText("Nom (FR)"), "50' HC");
    await user.type(screen.getByLabelText(/Size key/), "50HC");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText(/TEU is required/)).toBeTruthy();
    expect(createDictRef).not.toHaveBeenCalled();
  });

  it("refuses a type with no size key — the rate card has nothing to look it up by", async () => {
    const user = userEvent.setup();
    view();
    await openAddForm(user);

    await user.type(screen.getByLabelText("Code"), "FT50HC");
    await user.type(screen.getByLabelText("Nom (FR)"), "50' HC");
    await user.type(screen.getByLabelText(/^TEU/), "2.5");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText(/rate-card lookup key/)).toBeTruthy();
    expect(createDictRef).not.toHaveBeenCalled();
  });

  it("sends teu, size and family in `extra` when the form is complete", async () => {
    const user = userEvent.setup();
    view();
    await openAddForm(user);

    await user.type(screen.getByLabelText("Code"), "FT50HC");
    await user.type(screen.getByLabelText("Nom (FR)"), "50' HC");
    await user.type(screen.getByLabelText("Name (EN)"), "50' High Cube");
    await user.type(screen.getByLabelText(/^TEU/), "2.5");
    await user.type(screen.getByLabelText(/Size key/), "50HC");
    await user.type(screen.getByLabelText(/Also known as/), "50hq, 50dc");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createDictRef).toHaveBeenCalledTimes(1));
    expect(createDictRef.mock.calls[0][0]).toEqual({
      kind: "CONTAINER_TYPE",
      code: "FT50HC",
      name_fr: "50' HC",
      name_en: "50' High Cube",
      // `marks_token` was left blank, so the derived value is stored rather than
      // nothing — a type with no token prints `01*` on a bill of lading.
      // "High cube" is a TYPE in legacy's vocabulary, hence 50'HC not 50HC'DC.
      extra: {
        teu: 2.5,
        size: "50HC",
        family: "DRY",
        aliases: ["50hq", "50dc"],
        marks_token: "50'HC",
      },
    });
  });

  it("stores a typed marks token over the derived one", async () => {
    const user = userEvent.setup();
    view();
    await openAddForm(user);

    await user.type(screen.getByLabelText("Code"), "FT50HC");
    await user.type(screen.getByLabelText("Nom (FR)"), "50' HC");
    await user.type(screen.getByLabelText(/^TEU/), "2.5");
    await user.type(screen.getByLabelText(/Size key/), "50HC");
    await user.type(screen.getByLabelText(/Marks token/), "50'HQ");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createDictRef).toHaveBeenCalledTimes(1));
    expect(createDictRef.mock.calls[0][0].extra.marks_token).toBe("50'HQ");
  });

  it("sends no `extra` for a kind that has none", async () => {
    const user = userEvent.setup();
    listDictRefs.mockResolvedValue([]);
    view();
    await user.click(await screen.findByRole("button", { name: "Units" }));
    await user.click(await screen.findByRole("button", { name: "+ Add new" }));

    // The equipment fields belong to CONTAINER_TYPE alone.
    expect(screen.queryByLabelText(/^TEU/)).toBeNull();

    await user.type(screen.getByLabelText("Code"), "TON");
    await user.type(screen.getByLabelText("Nom (FR)"), "Tonne");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createDictRef).toHaveBeenCalledTimes(1));
    expect(createDictRef.mock.calls[0][0].extra).toBeUndefined();
  });

  it("shows the equipment facts on the row, and names a type that has none", async () => {
    const user = userEvent.setup();
    listDictRefs.mockResolvedValue([
      {
        ref_id: "ct1",
        kind: "CONTAINER_TYPE",
        code: "FT40HC",
        name_fr: "40' HC",
        extra: { teu: 2, size: "40HC", family: "DRY" },
      },
      {
        ref_id: "ct2",
        kind: "CONTAINER_TYPE",
        code: "LEGACY",
        name_fr: "Ancien",
        extra: {},
      },
    ]);
    view();
    await user.click(
      await screen.findByRole("button", { name: "Container types" }),
    );

    expect(await screen.findByText(/2 TEU · 40HC · DRY/)).toBeTruthy();
    // A row seeded before the fields were captured is called out rather than
    // rendering as a blank cell nobody reads.
    expect(screen.getByText("no TEU")).toBeTruthy();
  });
});
