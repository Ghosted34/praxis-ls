"use strict";

const intakeValidator = require("../../src/modules/sales/public_intake/public_intake.validator");
const milestoneValidator = require("../../src/modules/operations/milestone/milestone.validator");
const tracking = require("../../src/modules/operations/tracking_public/tracking_public.service");

test("F13 validators are strict and bounded", () => {
  expect(intakeValidator.schemas.contact.parse({ message: "Hello", email: "a@b.com" }).message).toBe("Hello");
  expect(() => intakeValidator.schemas.contact.parse({ message: "x", unknown: "bad" })).toThrow();
  expect(() => intakeValidator.schemas.quote.parse({ incoterm: "CIF", attachment: "data:x" })).toThrow();
});

test("F14 public detail writes are strict and bounded", () => {
  expect(milestoneValidator.schemas.publicDetails.parse({ public_location: "Port of Douala" }))
    .toEqual({ public_location: "Port of Douala" });
  expect(() => milestoneValidator.schemas.publicDetails.parse({ public_location: "x".repeat(201) })).toThrow();
  expect(() => milestoneValidator.schemas.publicDetails.parse({ cause_note: "internal" })).toThrow();
});

test("F14 returns only dedicated public milestone details and service-aware labels", async () => {
  const query = jest.fn()
    .mockResolvedValueOnce({
      rows: [{
        dossier_id: "d", ref: "R1", internal_status: "IN_PROGRESS",
        service_key: "SEA_IMPORT", pol: "Douala", pod: "Kribi", details_json: {},
      }],
    })
    .mockResolvedValueOnce({
      rows: [{
        code: "DEPARTED", label: "Parti", label_en: "Departed",
        internal_status: "DONE", due_date: "2026-01-01", completed_at: "2026-01-01T10:00:00Z",
        public_location: "Port of Douala", public_stage_reference: "BL-42",
        public_progress_note: "Sailed safely",
      }],
    });
  const out = await tracking.get({ query }, "R1");
  const milestoneSql = query.mock.calls[1][0];
  expect(milestoneSql).toContain("is_client_visible");
  expect(milestoneSql).toContain("public_location");
  expect(milestoneSql).not.toContain("cause_note");
  expect(milestoneSql).not.toContain("health");
  expect(out).toMatchObject({
    reference: "R1", origin: "Douala", destination: "Kribi", computed_status: "COMPLETED",
  });
  expect(out).not.toHaveProperty("status");
  expect(out.milestones[0]).toMatchObject({
    public_state: "COMPLETED",
    location: "Port of Douala",
    stage_reference: "BL-42",
    progress_note: "Sailed safely",
  });
  for (const forbidden of ["status", "internal_status", "health", "cause_note", "attributed_to", "forecast_due"]) {
    expect(out.milestones[0]).not.toHaveProperty(forbidden);
  }
});

test("tracking missing reference is uniform 404", async () => {
  await expect(tracking.get({ query: jest.fn().mockResolvedValue({ rows: [] }) }, "nope"))
    .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
});
