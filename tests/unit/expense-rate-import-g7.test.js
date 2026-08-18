"use strict";

/**
 * G7 — expense-rate bulk Excel import (meeting §11.3).
 *
 * The rate card is the mechanism behind the costing speed-up, and onboarding
 * collects it via an Excel template the client fills. These tests pin the
 * row-resolution rules (human identifiers → ids) and the partial-commit
 * contract without a spreadsheet.
 */

const rules = require("../../src/modules/master/expense_rate/expense_rate.rules");

const ctx = {
  dictionaryItems: [
    { dictionary_item_id: "d-1", code: "OCEAN_FREIGHT", name_en: "Ocean freight", name_fr: "Fret maritime" },
    { dictionary_item_id: "d-2", code: "CUSTOMS", name_en: "Customs clearance", name_fr: "Dédouanement" },
  ],
  rateProviders: [
    { rate_provider_id: "p-1", code: "MAERSK", name: "Maersk" },
    { rate_provider_id: "p-2", code: "DGF", name: "DHL Global Forwarding" },
  ],
  containerTypes: [
    { ref_id: "c-1", code: "20GP", name_en: "20' General Purpose", name_fr: "20' Standard" },
    { ref_id: "c-2", code: "40HC", name_en: "40' High Cube", name_fr: "40' High Cube" },
  ],
};

describe("G7 — validateImportRow", () => {
  const lookups = rules.buildLookups(ctx);

  it("resolves names/codes to ids and normalises currency", () => {
    const out = rules.validateImportRow({
      dictionary_item: "ocean freight", // name_en, case-insensitive
      rate_provider: "MAERSK",          // code
      container_type: "40HC",           // code
      rate: "1250.5",
      currency: "xaf",
      effective_from: "2026-09-01",
      effective_to: "2026-12-31",
      note: "peak season",
    }, lookups);
    expect(out.valid).toBe(true);
    expect(out.data).toEqual({
      dictionary_item_id: "d-1",
      rate_provider_id: "p-1",
      container_type_ref_id: "c-2",
      rate: 1250.5,
      currency: "XAF",
      effective_from: "2026-09-01",
      effective_to: "2026-12-31",
      note: "peak season",
    });
  });

  it("allows a blank provider/container (item default rate)", () => {
    const out = rules.validateImportRow({
      dictionary_item: "CUSTOMS",
      rate: 50000,
      effective_from: "2026-01-01",
    }, lookups);
    expect(out.valid).toBe(true);
    expect(out.data.rate_provider_id).toBeNull();
    expect(out.data.container_type_ref_id).toBeNull();
    expect(out.data.effective_to).toBeNull();
    expect(out.data.currency).toBe("XAF");
  });

  it("rejects an unknown dictionary item, provider, container, bad rate, bad dates", () => {
    const out = rules.validateImportRow({
      dictionary_item: "no-such-item",
      rate_provider: "nope",
      container_type: "ZZZ",
      rate: -5,
      effective_from: "not-a-date",
      effective_to: "2026-01-01",
    }, lookups);
    expect(out.valid).toBe(false);
    expect(out.reasons.join(" | ")).toMatch(/unknown dictionary item/);
    expect(out.reasons.join(" | ")).toMatch(/unknown rate provider/);
    expect(out.reasons.join(" | ")).toMatch(/unknown container type/);
    expect(out.reasons.join(" | ")).toMatch(/non-negative/);
    expect(out.reasons.join(" | ")).toMatch(/YYYY-MM-DD/);
  });

  it("rejects effective_to before effective_from", () => {
    const out = rules.validateImportRow({
      dictionary_item: "CUSTOMS",
      rate: 10,
      effective_from: "2026-06-01",
      effective_to: "2026-01-01",
    }, lookups);
    expect(out.valid).toBe(false);
    expect(out.reasons.join(" | ")).toMatch(/before effective from/);
  });
});

describe("G7 — partitionImport (staging)", () => {
  it("partitions valid and rejected rows with 1-based-from-header row numbers", () => {
    const { valid, rejected } = rules.partitionImport([
      { dictionary_item: "Ocean freight", rate: 100, effective_from: "2026-01-01" },
      { dictionary_item: "bogus", rate: 5, effective_from: "2026-01-01" },
    ], ctx);
    expect(valid).toHaveLength(1);
    expect(valid[0].row).toBe(2);
    expect(valid[0].data.dictionary_item_id).toBe("d-1");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].row).toBe(3);
    expect(rejected[0].reasons[0]).toMatch(/unknown dictionary item/);
  });
});
