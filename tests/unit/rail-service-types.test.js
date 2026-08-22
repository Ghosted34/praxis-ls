"use strict";

const fs = require("fs");
const path = require("path");
const { DEFAULT_SERVICE_CODES, deriveServiceCode } = require("../../src/services/documents/operation-reference");

const ROOT = path.join(__dirname, "..", "..");
const SEED_DICT = path.join(ROOT, "migrations", "seeds", "9080_seed_dictionary.sql");
const SEED_MS = path.join(ROOT, "migrations", "seeds", "9091_seed_milestone_templates.sql");
const SEED_FIELDS = path.join(ROOT, "migrations", "seeds", "9092_seed_service_type_fields.sql");
const SEED_ITIN = path.join(ROOT, "migrations", "tenant", "0673_service_type_itinerary_templates.sql");
const MIGRATION_RAIL = path.join(ROOT, "migrations", "tenant", "11743_seed_rail_transportation.sql");

describe("Rail Service Types Architecture & Data Integrity", () => {
  describe("Operation Reference Codes", () => {
    it("maps all three rail services to their distinct 2-character ops codes", () => {
      expect(DEFAULT_SERVICE_CODES.RAIL_TRANSPORTATION).toBe("RT");
      expect(DEFAULT_SERVICE_CODES.RAIL_HINTERLAND_TRANSIT).toBe("RH");
      expect(DEFAULT_SERVICE_CODES.END_TO_END_RAIL_FREIGHT).toBe("ER");
    });

    it("correctly derives default codes when requested", () => {
      expect(deriveServiceCode("RAIL_TRANSPORTATION")).toBe("RT");
      expect(deriveServiceCode("RAIL_HINTERLAND_TRANSIT")).toBe("RH");
      expect(deriveServiceCode("END_TO_END_RAIL_FREIGHT")).toBe("ER");
    });
  });

  describe("Itinerary Templates", () => {
    it("seeds valid default multimodal itineraries in 0673 and 11743", () => {
      const sql0673 = fs.readFileSync(SEED_ITIN, "utf8");
      const sql11743 = fs.readFileSync(MIGRATION_RAIL, "utf8");

      expect(sql0673).toContain("RAIL_TRANSPORTATION");
      expect(sql0673).toContain("RAIL_HINTERLAND_TRANSIT");
      expect(sql0673).toContain("END_TO_END_RAIL_FREIGHT");

      expect(sql11743).toContain("RAIL_TRANSPORTATION");
      expect(sql11743).toContain("RAIL_HINTERLAND_TRANSIT");
      expect(sql11743).toContain("END_TO_END_RAIL_FREIGHT");
    });
  });

  describe("Milestone Chains", () => {
    it("seeds 14 stages per rail service in 9091 with valid anchors and locks", () => {
      const sql = fs.readFileSync(SEED_MS, "utf8");

      for (const svc of ["RAIL_TRANSPORTATION", "RAIL_HINTERLAND_TRANSIT", "END_TO_END_RAIL_FREIGHT"]) {
        expect(sql).toContain(`'${svc}'`);
        expect(sql).toContain(`'${svc}', 1,`);
        expect(sql).toContain(`'${svc}',14,'FILE_CLOSED'`);
      }
    });

    it("publishes operational assumptions and force-majeure exclusions for all three", () => {
      const sql = fs.readFileSync(SEED_MS, "utf8");
      for (const svc of ["RAIL_TRANSPORTATION", "RAIL_HINTERLAND_TRANSIT", "END_TO_END_RAIL_FREIGHT"]) {
        expect(sql).toContain(`('${svc}',1,`);
        expect(sql).toContain(`'${svc}',`);
        expect(sql).toContain("FORCE_MAJEURE");
      }
    });
  });

  describe("Field Sets and Place Verification", () => {
    it("configures station and place fields with GEO_PLACE data types", () => {
      const sql = fs.readFileSync(SEED_FIELDS, "utf8");
      expect(sql).toContain("('RAIL_TRANSPORTATION','RAIL')");
      expect(sql).toContain("('RAIL_HINTERLAND_TRANSIT','RAIL_HINTERLAND')");
      expect(sql).toContain("('END_TO_END_RAIL_FREIGHT','END_TO_END_RAIL')");

      // Check key facet roles
      expect(sql).toContain("'pol','Gare / terminal de départ','Origin rail terminal / station','GEO_PLACE',true,'ORIGIN'");
      expect(sql).toContain("'pod','Gare / terminal d''arrivée','Destination rail terminal / station','GEO_PLACE',true,'DESTINATION'");
      expect(sql).toContain("'place_receipt','Lieu d''enlèvement','Place of collection','GEO_PLACE',true,'COLLECTION'");
    });

    it("enables grouped container capture on all three rail service types", () => {
      const sql = fs.readFileSync(SEED_FIELDS, "utf8");
      expect(sql).toContain("'RAIL_TRANSPORTATION','RAIL_HINTERLAND_TRANSIT','END_TO_END_RAIL_FREIGHT'");
    });
  });

  describe("Tenant Migration 11743 Idempotency", () => {
    it("carries safe ON CONFLICT clauses and idempotent constraint modifications", () => {
      const sql = fs.readFileSync(MIGRATION_RAIL, "utf8");
      expect(sql).toContain("dossier_itinerary_leg_mode_check");
      expect(sql).toContain("CHECK (mode IN ('AIR','SEA','LAND','RAIL','OTHER'))");
      expect(sql).toContain("ON CONFLICT (key) DO UPDATE SET");
      expect(sql).toContain("ON CONFLICT (service_type_id, version) DO NOTHING");
      expect(sql).toContain("ON CONFLICT (milestone_template_id, code) DO NOTHING");
      expect(sql).toContain("ON CONFLICT (service_type_field_set_id, key) DO NOTHING");
      expect(sql).toContain("ON CONFLICT (service_type_id, dictionary_item_id) DO NOTHING");
    });
  });
});
