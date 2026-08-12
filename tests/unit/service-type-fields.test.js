"use strict";
/**
 * Governance of the shipment-detail form (0660): versioning and the system/
 * tenant boundary.
 *
 * These are the rules that stop a form edit from quietly corrupting files that
 * are already open, and they are the reason the form is versioned at all rather
 * than being a table somebody edits in place. Each test below names a specific
 * way the naive design breaks.
 */

// `mock`-prefixed so the jest.mock factory may close over it (see
// scripts/check-jest-mock-hoisting.js — babel rejects any other name).
const mockRepo = {
  fieldSetById: jest.fn(),
  activeFieldSet: jest.fn(),
  fieldSetsFor: jest.fn(),
  fieldsOf: jest.fn(),
  nextVersion: jest.fn(),
  insertFieldSet: jest.fn(),
  activateFieldSet: jest.fn(),
  copyFields: jest.fn(),
  insertField: jest.fn(),
  updateField: jest.fn(),
  getField: jest.fn(),
  deleteField: jest.fn(),
  fieldSetInUse: jest.fn(),
};

jest.mock("../../src/modules/operations/shipment_details/shipment_details.repo", () => mockRepo);
// `resolveActorId` is mocked to pass the id straight through: what it resolves
// (DATA 2.4 — identity lives in the LIVE schema, this write may land in
// SANDBOX) is not what these tests are about, and a stub returning undefined
// would hide a real call.
jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(),
  emitEvent: jest.fn(),
  resolveActorId: jest.fn(async (_c, id) => id || null),
}));

const service = require("../../src/modules/operations/service_type_field/service_type_field.service");

const ST = "11111111-1111-1111-1111-111111111111";
const SET = "22222222-2222-2222-2222-222222222222";

/** A client that answers the two direct queries the service makes: the service
 *  type lookup and the column-collision check. */
function fakeClient({ serviceType = { service_type_id: ST, key: "SEA_FREIGHT_IMPORT", name_fr: "Fret Maritime Import", captures_containers: false, container_detail_mode: "GROUPED" }, columnTaken = null } = {}) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push([sql, params]);
      if (/FROM service_type WHERE service_type_id/.test(sql)) {
        return { rows: serviceType ? [serviceType] : [] };
      }
      if (/SELECT key FROM service_type_field/.test(sql)) {
        return { rows: columnTaken ? [{ key: columnTaken }] : [] };
      }
      if (/UPDATE service_type/.test(sql)) {
        return { rows: [{ service_type_id: ST, key: "SEA_FREIGHT_IMPORT", captures_containers: true, container_detail_mode: "PER_BOX" }] };
      }
      return { rows: [] };
    },
  };
}

const draft = { service_type_field_set_id: SET, service_type_id: ST, version: 2, is_active: false };
const live = { service_type_field_set_id: SET, service_type_id: ST, version: 1, is_active: true };

beforeEach(() => {
  for (const fn of Object.values(mockRepo)) fn.mockReset();
});

describe("a published form is immutable", () => {
  /**
   * Editing the live version in place is the design this replaced. It breaks
   * three ways at once: files created against the old form become retroactively
   * invalid, a renamed key orphans every value stored under it, and a locked
   * invoice ends up citing a field that no longer exists.
   */
  it("refuses to add a field to the live version", async () => {
    mockRepo.fieldSetById.mockResolvedValue(live);
    await expect(service.addField(fakeClient(), {
      serviceTypeId: ST, fieldSetId: SET, data: { key: "x", label_fr: "X" },
    })).rejects.toThrow(/live and cannot be edited/);
  });

  it("refuses to edit or remove a field on the live version", async () => {
    mockRepo.fieldSetById.mockResolvedValue(live);
    await expect(service.updateField(fakeClient(), { serviceTypeId: ST, fieldSetId: SET, fieldId: "f", patch: {} }))
      .rejects.toThrow(/live and cannot be edited/);
    await expect(service.removeField(fakeClient(), { serviceTypeId: ST, fieldSetId: SET, fieldId: "f" }))
      .rejects.toThrow(/live and cannot be edited/);
  });

  it("clones the live version into the next draft", async () => {
    mockRepo.activeFieldSet.mockResolvedValue(live);
    mockRepo.nextVersion.mockResolvedValue(2);
    mockRepo.insertFieldSet.mockResolvedValue(draft);
    mockRepo.fieldSetById.mockResolvedValue(draft);
    mockRepo.fieldsOf.mockResolvedValue([]);
    mockRepo.fieldSetInUse.mockResolvedValue(false);

    await service.createVersion(fakeClient(), { serviceTypeId: ST });

    expect(mockRepo.insertFieldSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      version: 2, is_active: false, source_version: 1,
    }));
    expect(mockRepo.copyFields).toHaveBeenCalledWith(expect.anything(), SET, SET);
  });
});

describe("publishing", () => {
  it("refuses to publish a version with no active fields", async () => {
    mockRepo.fieldSetById.mockResolvedValue(draft);
    mockRepo.fieldsOf.mockResolvedValue([]);
    await expect(service.publish(fakeClient(), { serviceTypeId: ST, fieldSetId: SET }))
      .rejects.toThrow(/would ask for nothing/);
  });

  it("activates a draft that has fields", async () => {
    mockRepo.fieldSetById.mockResolvedValue(draft);
    mockRepo.fieldsOf.mockResolvedValue([{ key: "bl_number" }]);
    mockRepo.activateFieldSet.mockResolvedValue({ ...draft, is_active: true });
    const row = await service.publish(fakeClient(), { serviceTypeId: ST, fieldSetId: SET });
    expect(row.is_active).toBe(true);
    expect(mockRepo.activateFieldSet).toHaveBeenCalledWith(expect.anything(), ST, SET);
  });

  it("is a no-op on a version that is already live", async () => {
    mockRepo.fieldSetById.mockResolvedValue(live);
    const row = await service.publish(fakeClient(), { serviceTypeId: ST, fieldSetId: SET });
    expect(row).toBe(live);
    expect(mockRepo.activateFieldSet).not.toHaveBeenCalled();
  });
});

describe("a field's key is its storage address", () => {
  it("refuses to rename a key", async () => {
    mockRepo.fieldSetById.mockResolvedValue(draft);
    mockRepo.getField.mockResolvedValue({ service_type_field_set_id: SET, key: "bl_number", is_system: true });
    await expect(service.updateField(fakeClient(), {
      serviceTypeId: ST, fieldSetId: SET, fieldId: "f", patch: { key: "bill_of_lading" },
    })).rejects.toThrow(/key cannot be changed/);
  });

  it("allows everything else on a system field — label, order, required, visibility", async () => {
    mockRepo.fieldSetById.mockResolvedValue(draft);
    mockRepo.getField.mockResolvedValue({ service_type_field_set_id: SET, key: "bl_number", is_system: true, column_name: "bl_mawb" });
    mockRepo.updateField.mockResolvedValue({ key: "bl_number", label_en: "B/L" });
    await service.updateField(fakeClient(), {
      serviceTypeId: ST, fieldSetId: SET, fieldId: "f",
      patch: { label_en: "B/L", is_required: true, is_client_visible: false, seq: 5 },
    });
    expect(mockRepo.updateField).toHaveBeenCalled();
  });
});

describe("system fields are deactivated, tenant fields are deleted", () => {
  it("deactivates a field we shipped rather than destroying it", async () => {
    mockRepo.fieldSetById.mockResolvedValue(draft);
    mockRepo.getField.mockResolvedValue({ service_type_field_set_id: SET, key: "bl_number", is_system: true });
    mockRepo.updateField.mockResolvedValue({ key: "bl_number", is_active: false });
    const out = await service.removeField(fakeClient(), { serviceTypeId: ST, fieldSetId: SET, fieldId: "f" });
    expect(out).toEqual(expect.objectContaining({ deactivated: true, removed: false }));
    expect(mockRepo.deleteField).not.toHaveBeenCalled();
  });

  it("deletes a field the tenant added themselves", async () => {
    mockRepo.fieldSetById.mockResolvedValue(draft);
    mockRepo.getField.mockResolvedValue({ service_type_field_set_id: SET, key: "x_custom", is_system: false });
    mockRepo.deleteField.mockResolvedValue({ key: "x_custom" });
    const out = await service.removeField(fakeClient(), { serviceTypeId: ST, fieldSetId: SET, fieldId: "f" });
    expect(out).toEqual(expect.objectContaining({ removed: true, deactivated: false }));
  });
});

describe("two fields cannot share one dossier column", () => {
  /** Both would write the same column on every save and the later one would
   *  silently win — invisible until an invoice printed the wrong reference. */
  it("refuses a second field bound to a column already taken", async () => {
    mockRepo.fieldSetById.mockResolvedValue(draft);
    mockRepo.fieldsOf.mockResolvedValue([]);
    await expect(service.addField(fakeClient({ columnTaken: "bl_number" }), {
      serviceTypeId: ST, fieldSetId: SET,
      data: { key: "waybill_no", label_fr: "LV", column_name: "bl_mawb" },
    })).rejects.toThrow(/already stores into bl_mawb/);
  });

  it("refuses a duplicate key on the same version", async () => {
    mockRepo.fieldSetById.mockResolvedValue(draft);
    mockRepo.fieldsOf.mockResolvedValue([{ key: "bl_number" }]);
    await expect(service.addField(fakeClient(), {
      serviceTypeId: ST, fieldSetId: SET, data: { key: "bl_number", label_fr: "BL" },
    })).rejects.toThrow(/already exists on this version/);
  });

  it("lands a new field at the end of its group when no position is given", async () => {
    mockRepo.fieldSetById.mockResolvedValue(draft);
    mockRepo.fieldsOf.mockResolvedValue([
      { key: "a", group_code: "CARGO", seq: 10 },
      { key: "b", group_code: "CARGO", seq: 40 },
      { key: "c", group_code: "TRANSPORT", seq: 90 },
    ]);
    mockRepo.insertField.mockResolvedValue({});
    await service.addField(fakeClient(), {
      serviceTypeId: ST, fieldSetId: SET, data: { key: "d", label_fr: "D", group_code: "CARGO" },
    });
    expect(mockRepo.insertField).toHaveBeenCalledWith(expect.anything(), SET, expect.objectContaining({ seq: 50 }));
  });
});

describe("a set belongs to exactly one service type", () => {
  it("404s when the set id belongs to a different service type", async () => {
    mockRepo.fieldSetById.mockResolvedValue({ ...draft, service_type_id: "99999999-9999-9999-9999-999999999999" });
    await expect(service.get(fakeClient(), ST, SET)).rejects.toThrow(/not found on this service type/);
  });

  it("404s for an unknown service type", async () => {
    await expect(service.list(fakeClient({ serviceType: null }), ST)).rejects.toThrow(/Service type not found/);
  });
});

describe("equipment capture is configured on the service type", () => {
  it("sets both switches and leaves the other alone when only one is sent", async () => {
    const c = fakeClient();
    const out = await service.configureContainers(c, {
      serviceTypeId: ST, capturesContainers: true, detailMode: "PER_BOX",
    });
    expect(out).toEqual(expect.objectContaining({ captures_containers: true, container_detail_mode: "PER_BOX" }));
    const [sql, params] = c.queries.find(([s]) => /UPDATE service_type/.test(s));
    // COALESCE, so an absent switch keeps its stored value rather than nulling it.
    expect(sql).toMatch(/COALESCE\(\$2, captures_containers\)/);
    expect(params).toEqual([ST, true, "PER_BOX"]);
  });

  it("passes null for a switch the caller did not send", async () => {
    const c = fakeClient();
    await service.configureContainers(c, { serviceTypeId: ST, capturesContainers: false });
    const [, params] = c.queries.find(([s]) => /UPDATE service_type/.test(s));
    expect(params).toEqual([ST, false, null]);
  });
});
