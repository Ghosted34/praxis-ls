/**
 * The carrier field — the live bug, and the duplication behind it.
 *
 * WHAT WAS WRONG. `RATE_PROVIDER` has been an allowed field type since 0660 and
 * four seeded fields use it, but `detail-fields.tsx` had no `case` for it. The
 * control fell through to `default:` and rendered a text box bound to a uuid FK,
 * so "Maersk" went to Postgres as a uuid literal and came back a 500 with no
 * field named. Meanwhile `dossier-form.tsx` carried its own hard-coded Carrier
 * select writing the SAME column, offering every sea and air carrier on every
 * file including a warehousing job that has none.
 *
 * These tests pin the three properties that fix it: the picker stores the id and
 * shows the name, `ref_kind` scopes what it offers, and there is exactly one
 * carrier control on screen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  fixtures,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { DetailFieldGroups, type DetailValues } from "./detail-fields";

const PROVIDERS = [
  {
    rate_provider_id: "rp-maersk",
    kind: "SHIPPING_LINE",
    code: "MAERSK",
    name: "Maersk",
    carrier_code: "MAEU",
    is_active: true,
  },
  {
    rate_provider_id: "rp-eth",
    kind: "AIRLINE",
    code: "ETH",
    name: "Ethiopian Cargo",
    is_active: true,
  },
  {
    rate_provider_id: "rp-sotra",
    kind: "TRUCKING",
    code: "SOTRAMAF",
    name: "Sotramaf",
    is_active: true,
  },
  {
    rate_provider_id: "rp-camrail",
    kind: "RAIL",
    code: "CAMRAIL",
    name: "CAMRAIL",
    is_active: true,
  },
];

const field = (o: Record<string, unknown>) => ({
  key: "shipping_line",
  label: "Shipping line",
  data_type: "RATE_PROVIDER",
  width: "HALF" as const,
  is_required: false,
  is_client_visible: true,
  facet_role: "CARRIER" as const,
  column_name: "rate_provider_id",
  ...o,
});

function renderField(
  f: Record<string, unknown>,
  opts: { values?: DetailValues; displays?: Record<string, string> } = {},
) {
  const onChange = vi.fn();
  renderScreen(
    <DetailFieldGroups
      groups={[
        {
          code: "TRANSPORT",
          label: "Transport",
          seq: 10,
          fields: [field(f)] as never,
        },
      ]}
      values={opts.values || {}}
      displays={opts.displays}
      onChange={onChange}
    />,
    { routes: { "/rate-providers": PROVIDERS } },
  );
  return { onChange };
}

beforeEach(() => {
  fixtures.current = { routes: { "/rate-providers": PROVIDERS } };
});

describe("the carrier field", () => {
  it("is a picker, not a text box", async () => {
    renderField({});
    // A `default:` text input would be a textbox with no popup behind it.
    expect(
      await screen.findByRole("button", { name: "Shipping line" }),
    ).toBeTruthy();
  });

  it("stores the uuid and shows the name — not the other way round", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({});

    await user.click(
      await screen.findByRole("button", { name: "Shipping line" }),
    );
    await user.click(
      await screen.findByRole("option", { name: /Maersk/ }, { timeout: 3000 }),
    );

    // The whole bug in one assertion: GEO_PLACE stores `r.name`; this must not.
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("shipping_line", "rp-maersk"),
    );
    expect(onChange).not.toHaveBeenCalledWith("shipping_line", "Maersk");
  });

  it("reads back as the carrier's name, not its id", async () => {
    // The projection resolves the name for printing; the edit form reuses it
    // rather than opening with a uuid in the box.
    renderField(
      {},
      {
        values: { shipping_line: "rp-maersk" },
        displays: { shipping_line: "Maersk" },
      },
    );
    expect(
      await screen.findByRole("button", { name: "Shipping line" }),
    ).toHaveTextContent("Maersk");
  });

  it("offers only the kinds the field accepts", async () => {
    const user = userEvent.setup();
    renderField({ ref_kind: "SHIPPING_LINE" });

    await user.click(
      await screen.findByRole("button", { name: "Shipping line" }),
    );
    expect(
      await screen.findByRole("option", { name: /Maersk/ }, { timeout: 3000 }),
    ).toBeTruthy();
    // An air file's carrier has no business on a sea file's picker.
    expect(screen.queryByRole("option", { name: /Ethiopian/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /Sotramaf/ })).toBeNull();
  });

  it("takes several kinds — an inland leg is a truck or a wagon", async () => {
    const user = userEvent.setup();
    renderField({
      key: "transporter",
      label: "Haulier",
      ref_kind: "TRUCKING,RAIL",
      column_name: null,
    });

    await user.click(await screen.findByRole("button", { name: "Haulier" }));
    expect(
      await screen.findByRole(
        "option",
        { name: /Sotramaf/ },
        { timeout: 3000 },
      ),
    ).toBeTruthy();
    expect(screen.getByRole("option", { name: /CAMRAIL/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Maersk/ })).toBeNull();
  });

  it("offers everything when the field does not say", async () => {
    const user = userEvent.setup();
    renderField({ key: "carrier", label: "Carrier", ref_kind: null });

    await user.click(await screen.findByRole("button", { name: "Carrier" }));
    expect(
      await screen.findByRole("option", { name: /Maersk/ }, { timeout: 3000 }),
    ).toBeTruthy();
    expect(screen.getByRole("option", { name: /Sotramaf/ })).toBeTruthy();
  });

  it("only offers to create a carrier when the caller can", async () => {
    const user = userEvent.setup();
    const onCreateCarrier = vi.fn();
    renderScreen(
      <DetailFieldGroups
        groups={[
          {
            code: "TRANSPORT",
            label: "Transport",
            seq: 10,
            fields: [field({ ref_kind: "SHIPPING_LINE" })] as never,
          },
        ]}
        values={{}}
        onChange={vi.fn()}
        onCreateCarrier={onCreateCarrier}
      />,
      { routes: { "/rate-providers": PROVIDERS } },
    );

    await user.click(
      await screen.findByRole("button", { name: "Shipping line" }),
    );
    // The create action appears only once a search has come back empty.
    await user.type(
      screen.getByRole("combobox", { name: "Shipping line" }),
      "Sotramaf",
    );
    await user.click(
      await screen.findByRole(
        "button",
        { name: /Add carrier/ },
        { timeout: 3000 },
      ),
    );

    // It carries WHICH field asked and which kinds it accepts, so the modal can
    // preselect and the answer can be routed back to the right control.
    expect(onCreateCarrier).toHaveBeenCalledWith("shipping_line", "Sotramaf", [
      "SHIPPING_LINE",
    ]);
  });
});

describe("a generated field", () => {
  const marksField = {
    key: "marks_numbers",
    label: "Marks & numbers",
    data_type: "TEXT",
    width: "HALF" as const,
    is_required: false,
    is_client_visible: true,
    is_readonly: true,
    facet_role: "CARGO_MARKS" as const,
    column_name: "marks_numbers",
  };

  it("shows its value locked, with a way in", async () => {
    renderScreen(
      <DetailFieldGroups
        groups={[
          {
            code: "CARGO",
            label: "Cargo",
            seq: 10,
            fields: [marksField] as never,
          },
        ]}
        values={{ marks_numbers: "01*20'RF, 02*40'HC" }}
        onChange={vi.fn()}
      />,
    );
    expect(await screen.findByText("01*20'RF, 02*40'HC")).toBeTruthy();
    // Locked: no input until asked for.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("says what editing costs before it is edited", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderScreen(
      <DetailFieldGroups
        groups={[
          {
            code: "CARGO",
            label: "Cargo",
            seq: 10,
            fields: [marksField] as never,
          },
        ]}
        values={{ marks_numbers: "01*20'RF" }}
        onChange={onChange}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    expect(
      screen.getByText(/stops it updating from the containers/),
    ).toBeTruthy();

    await user.type(screen.getByRole("textbox"), "!");
    expect(onChange).toHaveBeenCalled();
  });
});
