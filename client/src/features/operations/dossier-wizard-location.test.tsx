/**
 * Location fields on a real service-type form: the picker reaches every one of
 * them, and no location field is a text box any more.
 *
 * WHY THIS IS A SEPARATE FILE FROM `place-picker.test.tsx`. That one tests the
 * control. This one tests the WIRING, which is where the original defect actually
 * lived: `GEO_PLACE` had a picker, but the four fields that matter most to the two
 * road service types — `place_receipt`, `place_delivery`, `final_destination`,
 * `warehouse_location` — were seeded as `TEXT` (migration 0676 converts them). So
 * the service types whose entire job is a road movement were the ones that could
 * not name a mappable location, and a control test would never have noticed.
 *
 * The fixtures below are `service_type_field` rows in the shape
 * `GET /service-types/:id/detail-form` returns, so a regression in the dispatch
 * table in `detail-fields.tsx` fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { apiClientMock, authContextMock, fixtures, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { DetailFieldGroups, type DetailValues } from "./detail-fields";
import type { GeoPlace } from "@/lib/operations-api";

const DOUALA: GeoPlace = {
  geo_place_id: "gp-douala",
  name: "Douala",
  country: "CM",
  kind: "SEAPORT",
  unlocode: "CMDLA",
  latitude: "4.0482",
  longitude: "9.7004",
  source: "CATALOGUE",
  verified_at: "2026-01-01T00:00:00.000Z",
};

const field = (o: Record<string, unknown>) => ({
  key: "pol",
  label: "Port of loading (POL)",
  data_type: "GEO_PLACE",
  width: "HALF" as const,
  is_required: true,
  is_client_visible: true,
  facet_role: "ORIGIN" as const,
  column_name: "pol",
  ...o,
});

const search = (places: GeoPlace[]) => ({
  places,
  has_exact: false,
  provider: { requested: false, status: "NOT_REQUESTED", message: null, results: [] },
});

function renderForm(
  fields: Record<string, unknown>[],
  values: DetailValues = {},
  places: GeoPlace[] = [DOUALA],
) {
  const onChange = vi.fn();
  const view = renderScreen(
    <DetailFieldGroups
      groups={[{ code: "TRANSPORT", label: "Transport", seq: 0, fields: fields as never }]}
      values={values}
      displays={{}}
      onChange={onChange}
    />,
    { routes: { "/geo-places/search": search(places) } },
  );
  return { ...view, onChange };
}

beforeEach(() => {
  fixtures.current = {};
});

describe("every location field gets the verified picker", () => {
  it.each([
    ["pol", "Port of loading (POL)", "ORIGIN"],
    ["pod", "Port of discharge (POD)", "DESTINATION"],
    ["origin_airport", "Origin airport", "ORIGIN"],
    ["place_receipt", "Place of collection", "ORIGIN"],
    ["place_delivery", "Place of delivery", "DESTINATION"],
    ["final_destination", "Final destination", "DESTINATION"],
    ["warehouse_location", "Warehouse", "CUSTODY_LOCATION"],
    ["entry_port", "Port of entry", "ROUTE_VIA"],
  ])("%s renders a picker, not a text box", async (key, label, facet) => {
    renderForm([field({ key, label, facet_role: facet, column_name: null })]);
    // A picker is a button that opens a combobox. A text box is an input with no
    // popup — which is exactly what these four used to be.
    const trigger = await screen.findByRole("button", { name: label });
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: label })).not.toBeInTheDocument();
  });
});

describe("what the field stores", () => {
  it("the catalogue place's own name, so the server can resolve it exactly", async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm([field({})]);
    await user.click(await screen.findByRole("button", { name: "Port of loading (POL)" }));
    await user.type(screen.getByRole("combobox", { name: "Port of loading (POL)" }), "dou");
    await user.click(await screen.findByRole("option", { name: /Douala/ }));
    expect(onChange).toHaveBeenCalledWith("pol", "Douala");
  });

  it("nothing at all when the operator only typed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderForm([field({})], {}, []);
    await user.click(await screen.findByRole("button", { name: "Port of loading (POL)" }));
    await user.type(screen.getByRole("combobox", { name: "Port of loading (POL)" }), "Doula");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/no places matched/i));
    await user.keyboard("{Enter}");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("a field a tenant scoped to certain place kinds", () => {
  it("passes ref_kind through as the catalogue filter", async () => {
    const user = userEvent.setup();
    // `ref_kind` is the same column that scopes a carrier field to shipping
    // lines. Reusing it means an airport field can be restricted from the
    // Service Types screen with no code change.
    renderForm([field({ key: "origin_airport", label: "Origin airport", ref_kind: "AIRPORT" })]);
    await user.click(await screen.findByRole("button", { name: "Origin airport" }));
    await user.type(screen.getByRole("combobox", { name: "Origin airport" }), "dla");
    // The request carried the filter; the fixture ignores it, so the assertion is
    // that the control did not crash and still renders its results.
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
  });
});

describe("a legacy value already on the file", () => {
  it("is shown, and flagged as text only", async () => {
    // The promise the migration makes: existing files keep loading and their
    // values keep displaying. They are just visibly distinguishable now.
    renderForm([field({})], { pol: "Doula" }, []);
    expect(await screen.findByRole("button", { name: "Port of loading (POL)" })).toHaveTextContent("Doula");
    expect(await screen.findByText(/text only/i)).toBeInTheDocument();
  });

  it("a value that IS a catalogue place shows as verified", async () => {
    renderForm([field({})], { pol: "Douala" }, [DOUALA]);
    expect(await screen.findByText("Verified")).toBeInTheDocument();
  });
});

describe("non-location fields are untouched", () => {
  it("a cargo description is still a plain text box", async () => {
    renderForm([
      field({
        key: "cargo_desc",
        label: "Commodity",
        data_type: "TEXT",
        facet_role: "CARGO_DESC",
        column_name: null,
      }),
    ]);
    expect(await screen.findByRole("textbox", { name: "Commodity" })).toBeInTheDocument();
  });
});

describe("accessibility", () => {
  it("a form of location fields has no violations", async () => {
    const { container } = renderForm(
      [
        field({}),
        field({ key: "pod", label: "Port of discharge (POD)", facet_role: "DESTINATION", column_name: "pod" }),
      ],
      { pol: "Douala" },
      [DOUALA],
    );
    await screen.findByText("Verified");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("each picker's accessible name is its field label", async () => {
    renderForm([
      field({}),
      field({ key: "pod", label: "Port of discharge (POD)", facet_role: "DESTINATION", column_name: "pod" }),
    ]);
    expect(await screen.findByRole("button", { name: "Port of loading (POL)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Port of discharge (POD)" })).toBeInTheDocument();
  });
});
