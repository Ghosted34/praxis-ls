/**
 * The two screens that decide what an operation-file reference LOOKS like.
 *
 * A reference is `SL7Z3K9QW2M4XBSM`: an entity prefix, a random core the server
 * owns, and a service-type code. The core is not configurable by anybody — that
 * is the whole security property — but the two markers around it are, and both
 * are frozen the moment a file uses them.
 *
 * WHAT THESE GUARD, and why each is a real trap rather than a formality:
 *
 *   - The service-type form must not RESEND an unchanged code. The API refuses
 *     a code change once a file has used one, so echoing the stored value would
 *     turn "rename this service" into a 422 on every service type that has been
 *     in use for more than a day.
 *   - A blank code must be sent as ABSENT, not as "". A two-character rule and
 *     an empty string produce a validation error for a field the user never
 *     touched.
 *   - The entity prefix must not be a box on the entity form. It has its own
 *     endpoint because it has its own rule and its own audit action, and a
 *     control that looks like an ordinary edit is a control people use like one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/toast";

const createServiceType = vi.fn();
const updateServiceType = vi.fn();

vi.mock("@/lib/operations-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations-api")>("@/lib/operations-api");
  return {
    ...actual,
    createServiceType: (...a: unknown[]) => createServiceType(...a),
    updateServiceType: (...a: unknown[]) => updateServiceType(...a),
  };
});

import { ServiceTypeForm } from "./service-type-form";
import * as masterdataApi from "@/lib/masterdata-api";

const seaImport = {
  service_type_id: "st1",
  key: "SEA_FREIGHT_IMPORT",
  name_fr: "Fret maritime import",
  name_en: "Sea freight import",
  territory: "INTERNATIONAL_IMPORT",
  ops_reference_code: "SM",
};

const form = (row: typeof seaImport | null) =>
  render(
    <ToastProvider>
      <ServiceTypeForm row={row} onClose={() => {}} onSaved={() => {}} />
    </ToastProvider>,
  );

beforeEach(() => {
  createServiceType.mockReset().mockResolvedValue({ service_type_id: "new" });
  updateServiceType.mockReset().mockResolvedValue({ service_type_id: "st1" });
});

describe("Service type · reference code", () => {
  it("shows the code a service's files already carry", async () => {
    form(seaImport);
    const input = await screen.findByDisplayValue("SM");
    expect(input).toBeTruthy();
  });

  it("previews the reference a file would get", async () => {
    form(seaImport);
    expect(await screen.findByText(/SL7Z3K9QW2M4XBSM/)).toBeTruthy();
  });

  it("says the code is fixed once a file has used it", async () => {
    form(seaImport);
    expect(await screen.findByText(/Fixed once a file has used it/i)).toBeTruthy();
  });

  it("sends nothing when the code was not touched, so a rename is not refused", async () => {
    const user = userEvent.setup();
    form(seaImport);
    const nameEn = await screen.findByDisplayValue("Sea freight import");
    await user.clear(nameEn);
    await user.type(nameEn, "Ocean import");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateServiceType).toHaveBeenCalled());
    const [, body] = updateServiceType.mock.calls[0];
    expect(body.name_en).toBe("Ocean import");
    expect(body).not.toHaveProperty("ops_reference_code");
  });

  it("sends the code when it genuinely changed", async () => {
    const user = userEvent.setup();
    form(seaImport);
    const code = await screen.findByDisplayValue("SM");
    await user.clear(code);
    await user.type(code, "sx");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateServiceType).toHaveBeenCalled());
    expect(updateServiceType.mock.calls[0][1].ops_reference_code).toBe("SX");
  });

  it("omits a blank code on create rather than sending an empty string", async () => {
    const user = userEvent.setup();
    form(null);
    await user.type(await screen.findByPlaceholderText("SEA_FREIGHT_IMPORT"), "COLD_CHAIN");
    await user.type(screen.getByPlaceholderText("Fret maritime import"), "Chaîne du froid");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(createServiceType).toHaveBeenCalled());
    const [body] = createServiceType.mock.calls[0];
    expect(body.key).toBe("COLD_CHAIN");
    expect(body.ops_reference_code).toBeUndefined();
  });

  it("refuses to hold more than two characters, and uppercases what is typed", async () => {
    const user = userEvent.setup();
    form(null);
    const code = await screen.findByPlaceholderText("auto");
    await user.type(code, "smx");
    expect((code as HTMLInputElement).value).toBe("SM");
  });
});

describe("Entity · operation reference prefix", () => {
  it("has its own endpoint, separate from the entity PATCH", () => {
    // The rule it carries — frozen once a file has used it, audited when it
    // changes — cannot be expressed by the generic entity update, so the client
    // must not reach for it.
    expect(typeof masterdataApi.setEntityOpsReferencePrefix).toBe("function");
  });

  it("is absent from the entity form's body, which is what keeps it out of PATCH", async () => {
    const { entityFormBody, EMPTY_VALUES } = await import("./entity-form-fields");
    const body = entityFormBody({ ...EMPTY_VALUES, code: "SL", legal_name: "Smart Logistics" });
    expect(body).not.toHaveProperty("ops_reference_prefix");
    // …while the INVOICE prefix, which is an ordinary editable field, stays.
    expect(Object.keys(body)).toContain("doc_prefix");
  });
});
