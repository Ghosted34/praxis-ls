/**
 * Master data settings · "Required to activate" (14030).
 *
 * WHY THIS IS GUARDED. The app used to answer two different questions with one
 * flag, `party_document_type.is_required`: "does this tenant want the document on
 * file?" and "must it be on file before the party can be ACTIVATED?". The second
 * answer was what the 360's "Required to activate" checklist and the verification
 * gate both read, so seeding BANK_RIB as required put "Missing Bank RIB" on every
 * brand-new client — a bank account nobody has invoiced yet.
 *
 * 14030 splits the answers: `required_for_activation` IS the activation set,
 * `is_required` alone is advisory (reported, never gating). This file is the
 * FRONTEND half of that contract — it pins that the two checkboxes are separate
 * columns, that each persists to its own field, and that the activation toggle
 * exists on the document-type registry (which gates activation) but NOT on the
 * category registries (which never do). If a refactor ever re-merges the two
 * flags into one checkbox, the next Bank RIB-shaped bug lands silently on every
 * new client's checklist; these assertions are what make that a red build.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";

const getMasterConfig = vi.fn();
const putMasterConfig = vi.fn();
const listDocumentTypes = vi.fn();
const updateDocumentType = vi.fn();
const createDocumentType = vi.fn();
const listClientTypes = vi.fn();
const listSupplierTypes = vi.fn();

vi.mock("@/lib/masterdata-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/masterdata-api")>(
    "@/lib/masterdata-api",
  );
  return {
    ...actual,
    getMasterConfig: (...a: unknown[]) => getMasterConfig(...a),
    putMasterConfig: (...a: unknown[]) => putMasterConfig(...a),
    listDocumentTypes: (...a: unknown[]) => listDocumentTypes(...a),
    updateDocumentType: (...a: unknown[]) => updateDocumentType(...a),
    createDocumentType: (...a: unknown[]) => createDocumentType(...a),
    listClientTypes: (...a: unknown[]) => listClientTypes(...a),
    listSupplierTypes: (...a: unknown[]) => listSupplierTypes(...a),
  };
});

import { MasterDataSettings } from "./master-data-settings";

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
        <MasterDataSettings open onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );

/**
 * The `<tr>` a row label/code lives in — the toggles are per row, and both
 * tables arrive from an async fetch, so every read of a row RETRIES rather than
 * assuming the query has resolved. A sync `getByText` here would pass or fail
 * on how fast the mock promise settled.
 */
const rowOf = (text: string) =>
  screen.getByText(text).closest("tr") as HTMLElement;
const checkboxIn = (row: HTMLElement, name: string) =>
  within(row).getByRole("checkbox", { name });
const expectChecked = (text: string, name: string) =>
  waitFor(() => {
    expect(checkboxIn(rowOf(text), name)).toBeChecked();
  });
const expectNotChecked = (text: string, name: string) =>
  waitFor(() => {
    expect(checkboxIn(rowOf(text), name)).not.toBeChecked();
  });
const clickToggle = async (
  user: ReturnType<typeof userEvent.setup>,
  text: string,
  name: string,
) => {
  await waitFor(() => expect(rowOf(text)).toBeInTheDocument());
  await user.click(checkboxIn(rowOf(text), name));
};

/**
 * The seeded shape that matters: a field the tenant wants on file (`is_required`)
 * that must NOT hold up activation — 0512's Bank RIB — next to one that does gate
 * activation while being optional to create. Neither column is derivable from
 * the other, which is the whole point of the split.
 */
const clientFields = () => [
  {
    applies_to: "CLIENT",
    field_key: "name",
    field_group: "IDENTITY",
    is_required: true,
    required_for_activation: false,
    is_visible: true,
    is_custom: false,
    sort_order: 10,
    label_override: "Name",
  },
  {
    applies_to: "CLIENT",
    field_key: "bank_accounts",
    field_group: "BANK",
    is_required: true,
    required_for_activation: false,
    is_visible: true,
    is_custom: false,
    sort_order: 20,
    label_override: "Bank RIB",
  },
  {
    applies_to: "CLIENT",
    field_key: "niu",
    field_group: "COMPLIANCE",
    is_required: false,
    required_for_activation: true,
    is_visible: true,
    is_custom: false,
    sort_order: 30,
    label_override: "NIU",
  },
];

const documentTypes = () => [
  {
    document_type_id: "dt-acf",
    code: "FISCAL_COMPLIANCE",
    name: "Attestation de conformité fiscale",
    applies_to: "CLIENT",
    is_active: true,
    is_system: true,
    required_for_activation: true,
    exempt_outside_country: "CM",
  },
  {
    document_type_id: "dt-rib",
    code: "BANK_RIB",
    name: "Bank RIB",
    applies_to: "BOTH",
    is_active: true,
    is_system: false,
    required_for_activation: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  getMasterConfig.mockImplementation(async (side: string) => ({
    applies_to: side,
    groups: ["IDENTITY", "CONTACT", "ADDRESS", "BANK", "ACCOUNTING", "COMPLIANCE"],
    fields:
      side === "CLIENT"
        ? clientFields()
        : [
            {
              applies_to: "SUPPLIER",
              field_key: "bank_accounts",
              field_group: "BANK",
              is_required: true,
              required_for_activation: true,
              is_visible: true,
              is_custom: false,
              sort_order: 10,
              label_override: "Bank RIB",
            },
          ],
  }));
  putMasterConfig.mockResolvedValue({ applies_to: "CLIENT", groups: [], fields: [] });
  listDocumentTypes.mockResolvedValue(documentTypes());
  updateDocumentType.mockResolvedValue({});
  listClientTypes.mockResolvedValue([]);
  listSupplierTypes.mockResolvedValue([]);
});

describe("Master data settings · Required to activate", () => {
  it("keeps `Required` and `Required to activate` as two independent columns", async () => {
    view();

    await expectChecked("Bank RIB", "Required");
    // Wanted on file, NOT an activation requirement: the bug that put this row
    // on every fresh client's checklist.
    await expectNotChecked("Bank RIB", "Required to activate");

    await expectNotChecked("NIU", "Required");
    await expectChecked("NIU", "Required to activate");
  });

  it("saves the activation column without touching `Required`", async () => {
    const user = userEvent.setup();
    view();

    await clickToggle(user, "Bank RIB", "Required to activate");
    await user.click(
      await screen.findByRole("button", { name: "Save configuration" }),
    );

    await waitFor(() => expect(putMasterConfig).toHaveBeenCalledTimes(1));
    const [side, rows] = putMasterConfig.mock.calls[0];
    expect(side).toBe("CLIENT");
    const byKey = Object.fromEntries(
      (rows as { field_key: string }[]).map((r) => [r.field_key, r]),
    );
    // Flipped on by the click …
    expect(byKey.bank_accounts).toMatchObject({
      required_for_activation: true,
      is_required: true, // … and the create-time policy is untouched
    });
    expect(byKey.name).toMatchObject({
      is_required: true,
      required_for_activation: false,
    });
    expect(byKey.niu).toMatchObject({
      is_required: false,
      required_for_activation: true,
    });
    // The save is confirmed where the user is looking.
    expect(
      await screen.findByText("Field configuration saved"),
    ).toBeInTheDocument();
  });

  it("carries a per-side configuration: flipping to Suppliers reloads that side", async () => {
    const user = userEvent.setup();
    view();

    await user.click(await screen.findByRole("button", { name: "Suppliers" }));
    await waitFor(() =>
      expect(getMasterConfig).toHaveBeenCalledWith("SUPPLIER"),
    );
    // The Suppliers row is an activation requirement while also being required —
    // one side must never inherit the other's answer.
    await expectChecked("Bank RIB", "Required to activate");
  });

  it("toggles the activation set per document type, immediately and with a toast", async () => {
    const user = userEvent.setup();
    view();

    await user.click(await screen.findByRole("button", { name: "Document types" }));

    // The ACF is an activation requirement for everyone except a party
    // operating outside Cameroon — seeded on, and shown as such.
    await expectChecked("FISCAL_COMPLIANCE", "Required to activate");
    await expectNotChecked("BANK_RIB", "Required to activate");

    await clickToggle(user, "BANK_RIB", "Required to activate");

    // A registry row is saved on click — there is no Save button in this table,
    // so a toggle that only lived in state would be lost on close.
    await waitFor(() =>
      expect(updateDocumentType).toHaveBeenCalledWith("dt-rib", {
        required_for_activation: true,
      }),
    );
    expect(
      await screen.findByText("BANK_RIB is now required to activate"),
    ).toBeInTheDocument();
    await waitFor(() => expect(listDocumentTypes).toHaveBeenCalledTimes(2));
  });

  it("never offers the activation toggle on the category registries", async () => {
    const user = userEvent.setup();
    view();

    await user.click(await screen.findByRole("button", { name: "Categories" }));

    // Categories scope document APPLICABILITY; they have never gated activation,
    // and a checkbox here would promise a feature that does not exist.
    await waitFor(() =>
      expect(
        screen.queryAllByRole("checkbox", { name: "Required to activate" }),
      ).toHaveLength(0),
    );
    expect(listClientTypes).toHaveBeenCalled();
  });
});
