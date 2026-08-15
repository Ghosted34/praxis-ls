/**
 * Opening a file, in three steps.
 *
 * WHAT THESE PIN
 *
 *   - Step 1 never grows past five controls, whatever the service type defines.
 *     That is the whole reason the wizard exists: the old form put twenty-five
 *     fields on one screen and people abandoned it.
 *   - The carrier is HOISTED by role, not by name. Step 1 renders whichever
 *     field carries `facet_role = 'CARRIER'`, and step 2 must not render it
 *     again — asking twice is how the two answers come to disagree.
 *   - Step 1 creates a DRAFT rather than a file. It is what gives step 3 a real
 *     `dossier_id` to attach documents to, and it must not go anywhere near
 *     `POST /operations`.
 *   - Nothing is promoted until the last button. A wizard abandoned at step 2
 *     leaves a draft that appears in no list and gets swept.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, fixtures, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const createDossierDraft = vi.fn();
const promoteDossier = vi.fn();
const getDetailForm = vi.fn();
const getItinerary = vi.fn();
const replaceItinerary = vi.fn();

vi.mock("@/lib/operations-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations-api")>("@/lib/operations-api");
  return {
    ...actual,
    createDossierDraft: (...a: unknown[]) => createDossierDraft(...a),
    promoteDossier: (...a: unknown[]) => promoteDossier(...a),
    getDetailForm: (...a: unknown[]) => getDetailForm(...a),
    getItinerary: (...a: unknown[]) => getItinerary(...a),
    replaceItinerary: (...a: unknown[]) => replaceItinerary(...a),
  };
});

import { DossierWizard } from "./dossier-wizard";

const f = (o: Record<string, unknown>) => ({
  key: "k", label: "L", data_type: "TEXT", width: "HALF",
  is_required: false, is_client_visible: true, facet_role: null, column_name: null, ...o,
});

/** A sea form: a carrier, a required BL, and enough else to be realistic. */
const SEA_FORM = {
  field_set: { service_type_field_set_id: "fs1", version: 1 },
  containers: { enabled: true, mode: "GROUPED" },
  groups: [
    {
      code: "TRANSPORT", label: "Transport", seq: 10,
      fields: [
        f({ key: "shipping_line", label: "Shipping line", data_type: "RATE_PROVIDER", facet_role: "CARRIER", column_name: "rate_provider_id", ref_kind: "SHIPPING_LINE" }),
        f({ key: "bl_number", label: "Bill of Lading", is_required: true, column_name: "bl_mawb" }),
        f({ key: "vessel_name", label: "Vessel" }),
        f({ key: "voyage_no", label: "Voyage No" }),
        f({ key: "pol", label: "Port of loading" }),
        f({ key: "pod", label: "Port of discharge" }),
      ],
    },
  ],
};

/**
 * The same form plus the delivery-place field 0678 made a real place field on
 * every sea service type. It is the only control that asks where the cargo is
 * delivered — see the "asks for the delivery place once" test.
 */
const WITH_DELIVERY_FORM = {
  ...SEA_FORM,
  groups: [
    {
      ...SEA_FORM.groups[0],
      fields: [
        ...SEA_FORM.groups[0].fields,
        f({
          key: "place_delivery",
          label: "Place of delivery",
          data_type: "GEO_PLACE",
          facet_role: "FINAL_DELIVERY",
          column_name: "place_delivery",
        }),
      ],
    },
  ],
};

const ROUTES = {
  "/entities": [{ entity_id: "e1", legal_name: "JBS Praxis SA", code: "JBS" }],
  "/clients": [{ client_id: "c1", name: "Bolloré" }],
  "/service-types": [{ service_type_id: "st1", name_en: "Sea freight import", key: "SEA_FREIGHT_IMPORT", has_active_template: true }],
  "/rate-providers": [{ rate_provider_id: "rp1", kind: "SHIPPING_LINE", code: "MAERSK", name: "Maersk", is_active: true }],
  "/financial-dictionary/refs": [{ ref_id: "dt1", kind: "DOCUMENT_TYPE", code: "BL", name_fr: "Connaissement", name_en: "Bill of Lading", is_active: true }],
};

const view = () => {
  const onCreated = vi.fn();
  renderScreen(<DossierWizard onClose={vi.fn()} onCreated={onCreated} />, { routes: ROUTES });
  return { onCreated };
};

/**
 * Choose from one of step 1's selects.
 *
 * The three lists load asynchronously and the select renders immediately with
 * only its "—" placeholder, so waiting for the CONTROL is not the same as
 * waiting for the option — that race is what makes this helper exist rather
 * than a bare `selectOptions`.
 */
async function pick(user: ReturnType<typeof userEvent.setup>, label: RegExp, value: string) {
  const el = (await screen.findByLabelText(label)) as HTMLSelectElement;
  await waitFor(() => expect(el.querySelector(`option[value="${value}"]`)).toBeTruthy());
  await user.selectOptions(el, value);
}

async function completeStep1(user: ReturnType<typeof userEvent.setup>) {
  await pick(user, /Entity/, "e1");
  await pick(user, /Client/, "c1");
  await pick(user, /Service type/, "st1");
  await user.click(await screen.findByRole("button", { name: "Shipping line" }));
  await user.click(await screen.findByRole("option", { name: /Maersk/ }, { timeout: 3000 }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

beforeEach(() => {
  createDossierDraft.mockReset();
  promoteDossier.mockReset();
  getDetailForm.mockReset();
  getItinerary.mockReset();
  replaceItinerary.mockReset();
  fixtures.current = { routes: ROUTES };
  getDetailForm.mockResolvedValue(SEA_FORM);
  createDossierDraft.mockResolvedValue({ dossier_id: "d-draft", status: "DRAFT", ref: "DRAFT-abc" });
  getItinerary.mockResolvedValue([]);
  replaceItinerary.mockResolvedValue([]);
  promoteDossier.mockResolvedValue({ dossier_id: "d-draft", status: "OPEN", ref: "SLAS-2026-0007" });
});

describe("the creation wizard", () => {
  it("shows five controls on step 1 and not the rest of the form", async () => {
    const user = userEvent.setup();
    view();
    await pick(user, /Service type/, "st1");
    await screen.findByRole("button", { name: "Shipping line" });

    // Entity, client, service type, carrier, title.
    expect(screen.getByLabelText(/Entity/)).toBeTruthy();
    expect(screen.getByLabelText(/Client/)).toBeTruthy();
    expect(screen.getByLabelText(/Service type/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Shipping line" })).toBeTruthy();
    expect(screen.getByLabelText(/Title/)).toBeTruthy();
    // The service type defines five more. None of them belong here.
    expect(screen.queryByLabelText(/Bill of Lading/)).toBeNull();
    expect(screen.queryByLabelText(/Vessel/)).toBeNull();
    expect(screen.queryByLabelText(/Port of loading/)).toBeNull();
  });

  it("will not continue until entity, client, service type and carrier are answered", async () => {
    const user = userEvent.setup();
    view();
    const cont = () => screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(cont().disabled).toBe(true);

    await pick(user, /Entity/, "e1");
    await pick(user, /Client/, "c1");
    await pick(user, /Service type/, "st1");
    // Carrier still missing — and the reason is said out loud, not left to guess.
    await screen.findByRole("button", { name: "Shipping line" });
    expect(cont().disabled).toBe(true);
    expect(screen.getByText(/Still needed:.*shipping line/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Shipping line" }));
    await user.click(await screen.findByRole("option", { name: /Maersk/ }, { timeout: 3000 }));
    await waitFor(() => expect(cont().disabled).toBe(false));
  });

  it("opens a DRAFT on continue — never a file", async () => {
    const user = userEvent.setup();
    view();
    await completeStep1(user);

    await waitFor(() => expect(createDossierDraft).toHaveBeenCalledTimes(1));
    const body = createDossierDraft.mock.calls[0][0];
    expect(body.entity_id).toBe("e1");
    expect(body.client_id).toBe("c1");
    expect(body.service_type_id).toBe("st1");
    // The carrier travels as a DETAIL, because it belongs to the service type's
    // own form — not as a top-level rate_provider_id the form decided on.
    expect(body.details).toEqual({ shipping_line: "rp1" });
    expect(body).not.toHaveProperty("rate_provider_id");
    // And nothing is promoted yet.
    expect(promoteDossier).not.toHaveBeenCalled();
  });

  it("does not ask for the carrier a second time on step 2", async () => {
    const user = userEvent.setup();
    view();
    await completeStep1(user);

    // Step 2 renders the rest of the service type's form…
    expect(await screen.findByLabelText(/Bill of Lading/)).toBeTruthy();
    expect(screen.getByLabelText(/Vessel/)).toBeTruthy();
    // …and not the field step 1 already answered.
    expect(screen.queryByRole("button", { name: "Shipping line" })).toBeNull();
  });

  it("blocks step 2 on the service type's own required fields", async () => {
    const user = userEvent.setup();
    view();
    await completeStep1(user);

    const cont = () => screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    await waitFor(() => expect(cont().disabled).toBe(true));
    expect(screen.getByText(/Still needed: Bill of Lading/)).toBeTruthy();

    await user.type(await screen.findByLabelText(/Bill of Lading/), "MAEU123456");
    await waitFor(() => expect(cont().disabled).toBe(false));
  });

  it("promotes only on the final button, sending everything gathered", async () => {
    const user = userEvent.setup();
    const { onCreated } = view();
    await completeStep1(user);
    await user.type(await screen.findByLabelText(/Bill of Lading/), "MAEU123456");
    await user.type(screen.getByLabelText(/Vessel/), "MSC ARUSHI");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Step 3 — equipment and documents, against the real draft id.
    expect(await screen.findByRole("button", { name: "Containers on this file" })).toBeTruthy();
    expect(promoteDossier).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Create file" }));
    await waitFor(() => expect(promoteDossier).toHaveBeenCalledTimes(1));
    expect(promoteDossier.mock.calls[0][0]).toBe("d-draft");
    expect(promoteDossier.mock.calls[0][1].details).toMatchObject({
      shipping_line: "rp1",
      bl_number: "MAEU123456",
      vessel_name: "MSC ARUSHI",
    });
    expect(onCreated).toHaveBeenCalled();
  });

  it("says there is no equipment when the service type does not track it", async () => {
    const user = userEvent.setup();
    getDetailForm.mockResolvedValue({ ...SEA_FORM, containers: { enabled: false, mode: "GROUPED" } });
    view();
    await completeStep1(user);
    await user.type(await screen.findByLabelText(/Bill of Lading/), "X");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/does not track containers/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Containers on this file" })).toBeNull();
  });

  it("sends a rejected field back to the step that owns it", async () => {
    const user = userEvent.setup();
    promoteDossier.mockRejectedValue(
      Object.assign(new Error("Invalid body"), { details: { bl_number: ["required for this service type"] } }),
    );
    view();
    await completeStep1(user);
    await user.type(await screen.findByLabelText(/Bill of Lading/), "X");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Create file" }));

    // Back on step 2, with the message against the control rather than a banner
    // over a form the user can no longer see.
    await waitFor(() => expect(screen.getByLabelText(/Bill of Lading/)).toBeTruthy());
    expect(screen.getByText("required for this service type")).toBeTruthy();
  });

  /**
   * The delivery address is ONE fact, and the wizard used to ask for it twice.
   *
   * It carried its own "Deliver to the consignee" toggle with a place picker, which
   * appended a FINAL_DELIVERY leg after promotion — on top of the FINAL_DELIVERY
   * leg every freight template has declared since 0673. So a sea import ended up
   * with two delivery legs, two identical lines on the map, and the address stored
   * both in a leg and in the `place_delivery` field sitting on this very form.
   *
   * `itinerary.legsFromTemplate` now builds the legs from the file's own places, so
   * the field is the only control and promotion is the only call.
   */
  it("asks for the delivery place once, in the service type's own field", async () => {
    const user = userEvent.setup();
    getDetailForm.mockResolvedValue(WITH_DELIVERY_FORM);
    view();
    await completeStep1(user);
    await user.type(await screen.findByLabelText(/Bill of Lading/), "MAEU123456");

    // The service type's field, rendered as the same verified picker every other
    // location field uses.
    expect(screen.getAllByRole("button", { name: "Place of delivery" })).toHaveLength(1);
    // And nothing else asking the same question.
    expect(screen.queryByLabelText(/Deliver to the consignee/i)).toBeNull();
    expect(screen.queryByLabelText(/Collect from the shipper/i)).toBeNull();
    expect(screen.queryByText(/Door-to-door legs/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Delivery place/ })).toBeNull();
  });

  it("creating a file is one call — the itinerary comes from promotion", async () => {
    const user = userEvent.setup();
    getDetailForm.mockResolvedValue(WITH_DELIVERY_FORM);
    view();
    await completeStep1(user);
    await user.type(await screen.findByLabelText(/Bill of Lading/), "MAEU123456");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Create file" }));

    await waitFor(() => expect(promoteDossier).toHaveBeenCalledTimes(1));
    // No follow-up itinerary write. Two of them were how the duplicate legs got
    // there, and a second call after promotion is also a second failure mode on a
    // file the operator has already been told was created.
    expect(replaceItinerary).not.toHaveBeenCalled();
    expect(getItinerary).not.toHaveBeenCalled();
  });

  it("reads a rejected field from `fields`, the canonical shape", async () => {
    // API F-2: `.fields` is canonical and `.details` is the deprecated alias. The
    // wizard read only the alias, so a server sending the current shape had its
    // per-field messages dropped and the operator got a banner with no field
    // marked.
    const user = userEvent.setup();
    promoteDossier.mockRejectedValue(
      Object.assign(new Error("Invalid body"), {
        fields: { place_delivery: ['"Yaonde" is not a place in the catalogue yet.'] },
      }),
    );
    getDetailForm.mockResolvedValue(WITH_DELIVERY_FORM);
    view();
    await completeStep1(user);
    await user.type(await screen.findByLabelText(/Bill of Lading/), "X");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Create file" }));

    expect(await screen.findByText(/"Yaonde" is not a place in the catalogue yet\./)).toBeTruthy();
  });

  it("marks progress so a screen reader can say where you are", async () => {
    const user = userEvent.setup();
    view();
    const steps = await screen.findByRole("list", { name: "Steps" });
    expect(within(steps).getByText(/Who & what/).closest("li")).toHaveAttribute("aria-current", "step");

    await completeStep1(user);
    await waitFor(() =>
      expect(within(steps).getByText(/The details/).closest("li")).toHaveAttribute("aria-current", "step"),
    );
  });
});
