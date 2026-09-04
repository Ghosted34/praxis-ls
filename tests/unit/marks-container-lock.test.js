"use strict";
/**
 * Marks & numbers is server-owned on a containerised file.
 *
 * The field is generated from the boxes and regenerated on every container
 * write. Letting a form or an API caller type over it is exactly how a file
 * comes to say "5 boxes" in its marks while carrying 2 — the drift this closes.
 *
 * `foldDetails` is the one choke point every create/update/promote passes
 * through, so the lock lives there: on a service type that captures containers,
 * both `marks_numbers` and its manual flag are dropped from the write, whatever
 * path they arrived by. On a non-equipment service type (break-bulk, whose
 * marks are the shipper's own) the manual override is untouched.
 */
const detailsService = require("../../src/modules/operations/shipment_details/shipment_details.service");
jest.mock("../../src/modules/operations/shipment_details/shipment_details.service");

const svc = require("../../src/modules/operations/operations_file/operations_file.service");

/** A client whose only answer is the captures_containers lookup. */
const client = (captures) => ({
  query: async (sql) =>
    /captures_containers/i.test(sql)
      ? { rows: [{ captures_containers: captures }] }
      : { rows: [] },
});

beforeEach(() => {
  detailsService.applyValues.mockReset();
  detailsService.applyValues.mockResolvedValue({
    patch: {
      pol: "Lagos",
      marks_numbers: "03*45'HC, 02*40'HC",
      marks_numbers_is_manual: true,
      service_type_field_set_id: "fs-1",
      details_json: {},
    },
  });
});

describe("marks & numbers lock on containerised files", () => {
  it("drops a manual marks write when the service type captures containers", async () => {
    const write = await svc.foldDetails(client(true), {
      data: { service_type_id: "st-1", details: { marks_numbers: "03*45'HC, 02*40'HC" } },
      enforceRequired: true,
    });
    expect(write).not.toHaveProperty("marks_numbers");
    expect(write).not.toHaveProperty("marks_numbers_is_manual");
    // Everything else the fold produced still stands.
    expect(write.pol).toBe("Lagos");
  });

  it("keeps a manual marks write on a non-equipment service type", async () => {
    const write = await svc.foldDetails(client(false), {
      data: { service_type_id: "st-2", details: { marks_numbers: "SHIPPER OWN MARKS" } },
      enforceRequired: true,
    });
    expect(write.marks_numbers).toBe("03*45'HC, 02*40'HC");
    expect(write.marks_numbers_is_manual).toBe(true);
  });

  it("also drops a DIRECT top-level marks write, not only one via details", async () => {
    // No `details` key → foldDetails' pass-through path; the lock must still bite.
    const write = await svc.foldDetails(client(true), {
      data: {
        service_type_id: "st-1",
        marks_numbers: "HAND TYPED",
        marks_numbers_is_manual: true,
        pod: "Douala",
      },
      enforceRequired: false,
    });
    expect(write).not.toHaveProperty("marks_numbers");
    expect(write).not.toHaveProperty("marks_numbers_is_manual");
    expect(write.pod).toBe("Douala");
  });

  it("reads captures_containers straight from the service_type row", async () => {
    expect(await svc.capturesContainers(client(true), "st-1")).toBe(true);
    expect(await svc.capturesContainers(client(false), "st-2")).toBe(false);
    // No service type (a legacy write with none resolvable) is never locked.
    expect(await svc.capturesContainers(client(true), null)).toBe(false);
  });
});
