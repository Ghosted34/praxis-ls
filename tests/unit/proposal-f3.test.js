"use strict";

const fs = require("fs");
const path = require("path");
const { schemas } = require("../../src/modules/sales/proposal/proposal.validator");
const rules = require("../../src/modules/sales/proposal/proposal.rules");

const uuid = "11111111-1111-4111-8111-111111111111";

describe("F3 manual proposal contract", () => {
  test("accepts commercial terms, bilingual narratives and dictionary-linked lines", () => {
    const parsed = schemas.create.parse({
      title: "Douala import", language: "BILINGUAL", currency: "XAF",
      service_category: "SEA_IMPORT", incoterm: "CIF", origin_location: "Shanghai",
      destination_location: "Douala", cargo_description: "Machinery", estimated_weight: 1200,
      project_cargo_flag: true, customs_clearance_target: "72 hours", transit_time_target: "28 days",
      free_days_demurrage: 7, payment_conditions: "50% advance", validity_days: 30,
      lines: [{ dictionary_item_id: uuid, label: "Ocean freight", qty: 2, unit_price: 500000 }],
      narratives: [
        { section: "scope", language: "EN", body: "English scope", raw_client_operations: "Imports" },
        { section: "scope", language: "FR", body: "Périmètre français", raw_client_operations: "Importations" },
      ],
    });
    expect(parsed.lines[0].dictionary_item_id).toBe(uuid);
    expect(parsed.narratives.map((n) => n.language)).toEqual(["EN", "FR"]);
    expect(rules.totalHt(parsed.lines)).toBe(1000000);
  });

  test("caller cannot assert ai_generated through the manual F3 endpoint", () => {
    expect(schemas.create.parse({ title: "Manual", ai_generated: true })).not.toHaveProperty("ai_generated");
  });

  test("rejects invalid commercial values and narrative languages", () => {
    expect(() => schemas.create.parse({ title: "Bad", currency: "FCFA" })).toThrow();
    expect(() => schemas.create.parse({ title: "Bad", narratives: [{ section: "x", language: "DE" }] })).toThrow();
  });

  test("migration owns every F3 field and remains rerunnable", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../migrations/tenant/0690_sales_crm_f3_proposal_builder.sql"), "utf8");
    for (const field of ["service_category", "converted_quote_id", "raw_client_operations", "raw_pain_points", "raw_proposed_strategy", "raw_tone"]) expect(sql).toContain(field);
    expect(sql).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/i);
    expect(sql).not.toMatch(/CREATE (?:TABLE|INDEX) (?!IF NOT EXISTS|OR REPLACE)/i);
  });
});
