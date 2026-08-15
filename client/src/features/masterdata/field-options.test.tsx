/**
 * Editing a dropdown's option list — Incoterms, customs regimes, weight units.
 *
 * ── WHAT THIS UNLOCKS ───────────────────────────────────────────────────────
 *
 * These lists were seeded once (9092) and there was no UI for them at all. The
 * Details tab could rename a field, retag its meaning, mark it required and retire
 * it, but not touch the eleven values the dropdown actually offers — so "add DDP"
 * or "we don't use EX2" was a migration, for reference data a customs department
 * revises.
 *
 * ── AND THE 422 IT CLOSES ───────────────────────────────────────────────────
 *
 * The add-field form offered `SELECT` in its type list and sent no options. The
 * server refuses a SELECT with an empty option list, so adding one ALWAYS failed
 * and there was no way through it from the UI. A dropdown is its option list.
 *
 * ── THE RULE THAT MATTERS MOST ──────────────────────────────────────────────
 *
 * A `value` is stored on every file and printed on every document; a label is read
 * by a person. Renaming a label is free. Renaming a value orphans every file
 * already filed under the old code — so it is allowed (a seeded typo must be
 * fixable) and it is said out loud.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import {
  apiClientMock,
  authContextMock,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const updateFieldInSet = vi.fn();
const addFieldToSet = vi.fn();

vi.mock("@/lib/operations-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations-api")>(
    "@/lib/operations-api",
  );
  return {
    ...actual,
    updateFieldInSet: (...a: unknown[]) => updateFieldInSet(...a),
    addFieldToSet: (...a: unknown[]) => addFieldToSet(...a),
  };
});

import { ServiceTypeFieldsTab } from "./service-type-fields-tab";
import { FieldOptionsDialog } from "./field-options-dialog";
import { optionProblems } from "./field-options";
import type { FieldOption, ServiceTypeField } from "@/lib/operations-api";

const INCOTERMS: FieldOption[] = [
  {
    value: "FOB",
    label_fr: "FOB — Franco à bord",
    label_en: "FOB — Free On Board",
  },
  {
    value: "CIF",
    label_fr: "CIF — Coût, assurance et fret",
    label_en: "CIF — Cost, Insurance and Freight",
  },
];

const field = (over: Partial<ServiceTypeField> = {}): ServiceTypeField =>
  ({
    service_type_field_id: "f-incoterm",
    service_type_field_set_id: "fs-2",
    group_code: "CUSTOMS",
    group_seq: 30,
    seq: 10,
    key: "incoterm",
    label_fr: "Incoterm",
    label_en: "Incoterm",
    data_type: "SELECT",
    options_json: INCOTERMS,
    validation_json: {},
    is_required: true,
    is_client_visible: true,
    is_active: true,
    is_system: true,
    facet_role: "INCOTERM",
    column_name: "incoterm",
    width: "THIRD",
    ...over,
  }) as ServiceTypeField;

/** One draft version and one live one, which is the state the screen is normally
 *  in — the draft is the only one that may be edited. */
function withSets({
  draft = true,
  fields,
}: { draft?: boolean; fields?: ServiceTypeField[] } = {}) {
  const sets = draft
    ? [
        {
          service_type_field_set_id: "fs-1",
          service_type_id: "st1",
          version: 1,
          is_active: true,
          is_system: true,
          field_count: 1,
        },
        {
          service_type_field_set_id: "fs-2",
          service_type_id: "st1",
          version: 2,
          is_active: false,
          is_system: false,
          field_count: 1,
        },
      ]
    : [
        {
          service_type_field_set_id: "fs-1",
          service_type_id: "st1",
          version: 1,
          is_active: true,
          is_system: true,
          field_count: 1,
        },
      ];
  const detail = (id: string, active: boolean) => ({
    service_type_field_set_id: id,
    service_type_id: "st1",
    version: active ? 1 : 2,
    is_active: active,
    is_system: active,
    fields: (fields || [field()]).map((f) => ({
      ...f,
      service_type_field_set_id: id,
    })),
  });
  return {
    "/service-types/st1/field-sets": sets,
    "/service-types/st1/field-sets/fs-1": detail("fs-1", true),
    "/service-types/st1/field-sets/fs-2": detail("fs-2", false),
  };
}

function renderTab(routes: Record<string, unknown>) {
  return renderScreen(
    <ServiceTypeFieldsTab
      serviceTypeId="st1"
      containers={{
        captures_containers: false,
        container_detail_mode: "GROUPED",
      }}
    />,
    { routes },
  );
}

/** Open the draft version, then its Incoterm option list. */
async function openOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByLabelText("Form version"),
    "fs-2",
  );
  await user.click(await screen.findByRole("button", { name: /2 options/ }));
  return screen.findByRole("dialog", { name: /Options — Incoterm/ });
}

beforeEach(() => {
  updateFieldInSet.mockReset();
  addFieldToSet.mockReset();
  updateFieldInSet.mockResolvedValue(field());
  addFieldToSet.mockResolvedValue(field());
  fixtures.current = {};
});

describe("finding the option list", () => {
  it("hangs off the field's type, with its count visible from the table", async () => {
    renderTab(withSets());
    // The count is on the button so a dropdown with no options is visible here
    // rather than only when a file fails to fill it in.
    expect(
      await screen.findByRole("button", { name: /2 options/ }),
    ).toBeInTheDocument();
  });

  it("says so when a dropdown has none", async () => {
    renderTab(withSets({ fields: [field({ options_json: [] })] }));
    await screen.findByLabelText("Form version");
    expect(
      await screen.findByRole("button", { name: /0 options — none yet/ }),
    ).toBeInTheDocument();
  });

  it("is offered on a non-dropdown field never — there is nothing to list", async () => {
    renderTab(
      withSets({
        fields: [
          field({ key: "bl_number", data_type: "TEXT", options_json: [] }),
        ],
      }),
    );
    await screen.findByLabelText("Form version");
    expect(
      screen.queryByRole("button", { name: /option/ }),
    ).not.toBeInTheDocument();
  });
});

describe("adding an option", () => {
  it("appends a row and saves the whole list", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);

    await user.click(
      within(dialog).getByRole("button", { name: /Add an option/ }),
    );
    const rows = within(dialog).getAllByRole("group");
    expect(rows).toHaveLength(3);

    await user.type(within(rows[2]).getByLabelText("Value"), "ddp");
    await user.type(
      within(rows[2]).getByLabelText("Label (English)"),
      "DDP — Delivered Duty Paid",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /Save 3 options/ }),
    );

    await waitFor(() => expect(updateFieldInSet).toHaveBeenCalledTimes(1));
    const [, , fieldId, patch] = updateFieldInSet.mock.calls[0];
    expect(fieldId).toBe("f-incoterm");
    // The whole list, in order — the column is a jsonb array, not a set of rows to
    // append to.
    expect(patch.options_json).toEqual([
      ...INCOTERMS,
      // A code is upper-cased as it is typed: it is stored on every file, and
      // "ddp" and "DDP" must not become two answers.
      {
        value: "DDP",
        label_fr: "DDP — Delivered Duty Paid",
        label_en: "DDP — Delivered Duty Paid",
      },
    ]);
  });

  it("fills the French label from the English one when only one is given", async () => {
    // Better than storing an empty label_fr, which the schema refuses, and better
    // than blocking on a translation nobody has yet.
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    await user.click(
      within(dialog).getByRole("button", { name: /Add an option/ }),
    );
    const rows = within(dialog).getAllByRole("group");
    await user.type(within(rows[2]).getByLabelText("Value"), "EXW");
    await user.type(
      within(rows[2]).getByLabelText("Label (English)"),
      "EXW — Ex Works",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /Save 3 options/ }),
    );

    await waitFor(() => expect(updateFieldInSet).toHaveBeenCalled());
    expect(updateFieldInSet.mock.calls[0][3].options_json[2].label_fr).toBe(
      "EXW — Ex Works",
    );
  });

  it("uppercases a code as it is typed", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    await user.click(
      within(dialog).getByRole("button", { name: /Add an option/ }),
    );
    const value = within(
      within(dialog).getAllByRole("group")[2],
    ).getByLabelText("Value");
    await user.type(value, "im4");
    expect(value).toHaveValue("IM4");
  });
});

describe("removing and reordering", () => {
  it("removes the row it names, not the one at that index after a reorder", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Remove CIF" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: /Save 1 option/ }),
    );
    await waitFor(() => expect(updateFieldInSet).toHaveBeenCalled());
    expect(updateFieldInSet.mock.calls[0][3].options_json).toEqual([
      INCOTERMS[0],
    ]);
  });

  it("reorders, because the order IS the order the dropdown shows", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Move CIF up" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: /Save 2 options/ }),
    );
    await waitFor(() => expect(updateFieldInSet).toHaveBeenCalled());
    expect(
      updateFieldInSet.mock.calls[0][3].options_json.map(
        (o: FieldOption) => o.value,
      ),
    ).toEqual(["CIF", "FOB"]);
  });
});

describe("what it refuses to save", () => {
  it("an empty list — a dropdown that cannot be answered", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Remove FOB" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Remove CIF" }),
    );

    expect(
      within(dialog).getByText(/needs at least one option/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /Save 0 options/ }),
    ).toBeDisabled();
    expect(updateFieldInSet).not.toHaveBeenCalled();
  });

  it("a row with no value", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    await user.click(
      within(dialog).getByRole("button", { name: /Add an option/ }),
    );
    expect(
      within(dialog).getByText(/needs a stored value/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /Save 3 options/ }),
    ).toBeDisabled();
  });

  it("two rows sharing a value — nothing downstream could tell them apart", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    await user.click(
      within(dialog).getByRole("button", { name: /Add an option/ }),
    );
    const rows = within(dialog).getAllByRole("group");
    await user.type(within(rows[2]).getByLabelText("Value"), "FOB");
    await user.type(
      within(rows[2]).getByLabelText("Label (English)"),
      "Free on board",
    );
    expect(
      within(dialog).getByText(/cannot share a value — FOB/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /Save 3 options/ }),
    ).toBeDisabled();
  });
});

describe("renaming a stored value", () => {
  it("is allowed, and says what it costs", async () => {
    // Freezing it would mean a typo in a seeded code could never be corrected.
    // Saying nothing would make it look free.
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    const value = within(
      within(dialog).getAllByRole("group")[0],
    ).getByLabelText("Value");
    await user.clear(value);
    await user.type(value, "FOB2020");

    expect(
      within(dialog).getByText(/changing a stored value/i),
    ).toBeInTheDocument();
    // Still saveable — it is a warning, not a refusal.
    expect(
      within(dialog).getByRole("button", { name: /Save 2 options/ }),
    ).toBeEnabled();
  });

  it("says nothing when only a LABEL changes", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    const en = within(within(dialog).getAllByRole("group")[0]).getByLabelText(
      "Label (English)",
    );
    await user.clear(en);
    await user.type(en, "FOB — Free on Board (Incoterms 2020)");
    expect(
      within(dialog).queryByText(/changing a stored value/i),
    ).not.toBeInTheDocument();
  });

  it("says nothing about a brand-new row", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    await user.click(
      within(dialog).getByRole("button", { name: /Add an option/ }),
    );
    const rows = within(dialog).getAllByRole("group");
    await user.type(within(rows[2]).getByLabelText("Value"), "DDP");
    await user.type(
      within(rows[2]).getByLabelText("Label (English)"),
      "Delivered Duty Paid",
    );
    expect(
      within(dialog).queryByText(/changing a stored value/i),
    ).not.toBeInTheDocument();
  });
});

describe("a published version", () => {
  it("shows the list read-only rather than hiding it", async () => {
    // "What regimes does this service offer?" is asked far more often than the
    // answer changes, and the live version is the one people mean.
    const user = userEvent.setup();
    renderTab(withSets({ draft: false }));
    await user.click(await screen.findByRole("button", { name: /2 options/ }));
    const dialog = await screen.findByRole("dialog", {
      name: /Options — Incoterm/,
    });

    expect(
      within(dialog).getByText(/live, so the list is read-only/i),
    ).toBeInTheDocument();
    within(dialog)
      .getAllByLabelText("Value")
      .forEach((box) => expect(box).toBeDisabled());
    // No way to change it from here at all.
    expect(
      within(dialog).queryByRole("button", { name: /Save/ }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /Add an option/ }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /^Remove/ }),
    ).not.toBeInTheDocument();
  });
});

describe("adding a new dropdown field", () => {
  it("collects its options first, because the server refuses an empty list", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    await user.selectOptions(
      await screen.findByLabelText("Form version"),
      "fs-2",
    );

    await user.type(screen.getByPlaceholderText("booking_ref"), "packing_type");
    await user.type(
      screen.getByPlaceholderText("Booking reference"),
      "Packing type",
    );
    await user.selectOptions(screen.getByLabelText("Type"), "SELECT");

    // Blocked until the list exists — this is the 422 that had no way past it.
    expect(screen.getByRole("button", { name: "Add field" })).toBeDisabled();
    expect(
      screen.getByText(/needs its options before it can be added/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Set the options/ }));
    const dialog = await screen.findByRole("dialog", {
      name: /Options — Packing type/,
    });
    await user.click(
      within(dialog).getByRole("button", { name: /Add an option/ }),
    );
    const row = within(dialog).getAllByRole("group")[0];
    await user.type(within(row).getByLabelText("Value"), "CRATE");
    await user.type(
      within(row).getByLabelText("Label (English)"),
      "Wooden crate",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /Save 1 option/ }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Edit 1 option/ }),
      ).toBeInTheDocument(),
    );
    const add = screen.getByRole("button", { name: "Add field" });
    expect(add).toBeEnabled();
    await user.click(add);

    await waitFor(() => expect(addFieldToSet).toHaveBeenCalled());
    expect(addFieldToSet.mock.calls[0][2]).toMatchObject({
      key: "packing_type",
      data_type: "SELECT",
      options_json: [
        { value: "CRATE", label_fr: "Wooden crate", label_en: "Wooden crate" },
      ],
    });
  });

  it("asks for no options on a type that has none", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    await user.selectOptions(
      await screen.findByLabelText("Form version"),
      "fs-2",
    );
    await user.type(screen.getByPlaceholderText("booking_ref"), "booking_ref");
    await user.type(
      screen.getByPlaceholderText("Booking reference"),
      "Booking reference",
    );

    expect(
      screen.queryByRole("button", { name: /Set the options/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add field" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await waitFor(() => expect(addFieldToSet).toHaveBeenCalled());
    expect(addFieldToSet.mock.calls[0][2]).not.toHaveProperty("options_json");
  });
});

/** The pure rule set, exercised directly — it is what both the dialog's Save
 *  button and the add-field form read. */
describe("optionProblems", () => {
  it("passes a well-formed list", () => {
    expect(optionProblems(INCOTERMS)).toEqual([]);
  });

  it("accepts an English-only label", () => {
    expect(
      optionProblems([
        { value: "FOB", label_fr: "", label_en: "Free On Board" },
      ]),
    ).toEqual([]);
  });

  it("compares values case-insensitively — a code is a code", () => {
    const problems = optionProblems([
      { value: "FOB", label_fr: "a" },
      { value: "fob", label_fr: "b" },
    ]);
    expect(problems.join(" ")).toMatch(/cannot share a value/);
  });
});

describe("accessibility", () => {
  it("the dialog has no violations, and every row names itself", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    // Three inputs per row, eleven rows on a real Incoterm list — "Value" repeated
    // eleven times is not a label, so each row is a named group.
    expect(
      within(dialog).getByRole("group", { name: "Option 1: FOB" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("group", { name: "Option 2: CIF" }),
    ).toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

describe("the dialog discards on cancel", () => {
  it("reopening does not resume a half-finished edit", async () => {
    const user = userEvent.setup();
    renderTab(withSets());
    const dialog = await openOptions(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Remove CIF" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(updateFieldInSet).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /2 options/ }));
    const reopened = await screen.findByRole("dialog", {
      name: /Options — Incoterm/,
    });
    expect(within(reopened).getAllByRole("group")).toHaveLength(2);
  });
});

/** Rendered directly, to pin the contract the tab depends on without driving the
 *  whole screen for it. */
describe("FieldOptionsDialog on its own", () => {
  it("hands back the trimmed list", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderScreen(
      <FieldOptionsDialog
        open
        editable
        fieldKey="weight_unit"
        fieldLabel="Unit"
        options={[{ value: "KG", label_fr: "kg", label_en: "kg" }]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
      { routes: {} },
    );
    const value = screen.getByLabelText("Value");
    await user.clear(value);
    await user.type(value, "  ton  ");
    await user.click(screen.getByRole("button", { name: /Save 1 option/ }));
    expect(onSave).toHaveBeenCalledWith([
      { value: "TON", label_fr: "kg", label_en: "kg" },
    ]);
  });
});
