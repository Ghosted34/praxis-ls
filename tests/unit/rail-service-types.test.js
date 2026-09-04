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
const MIGRATION_RAIL_BACKFILL = path.join(
  ROOT,
  "migrations",
  "tenant",
  "11744_backfill_rail_milestones_and_fields.sql",
);
const DASHBOARD_REPO = path.join(
  ROOT,
  "src",
  "modules",
  "dashboard",
  "dashboard",
  "dashboard.repo.js",
);
const DASHBOARD_MODEL = path.join(
  ROOT,
  "client",
  "src",
  "features",
  "dashboard",
  "model.ts",
);
const MODE_ICONS = path.join(
  ROOT,
  "client",
  "src",
  "features",
  "dashboard",
  "mode-icons.tsx",
);
const MAP_LEGEND = path.join(
  ROOT,
  "client",
  "src",
  "features",
  "dashboard",
  "components",
  "map-legend.tsx",
);
const CLIENT_CSS = path.join(ROOT, "client", "src", "index.css");

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

    it("enables per-box container capture on all three rail service types", () => {
      const sql = fs.readFileSync(SEED_FIELDS, "utf8");
      expect(sql).toContain("'RAIL_TRANSPORTATION','RAIL_HINTERLAND_TRANSIT','END_TO_END_RAIL_FREIGHT'");
      // PER_BOX is the default now (12772): the seed captures box-level detail.
      expect(sql).toContain("container_detail_mode = 'PER_BOX'");
    });
  });

  describe("Tenant Migration 11743 Idempotency", () => {
    it("carries safe ON CONFLICT clauses and idempotent constraint modifications", () => {
      const sql = fs.readFileSync(MIGRATION_RAIL, "utf8");
      expect(sql).toContain("dossier_itinerary_leg_mode_check");
      expect(sql).toContain("CHECK (mode IN ('AIR','SEA','LAND','RAIL','OTHER'))");
      expect(sql).toContain("ON CONFLICT (key) DO UPDATE SET");
    });
  });

  describe("Forward rail backfill for existing tenants", () => {
    const sql = fs.readFileSync(MIGRATION_RAIL_BACKFILL, "utf8");

    it("publishes an active system v1 template and exactly 14 stages per service", () => {
      expect(sql).toContain("'Chaîne standard — ' || st.name_fr");
      expect(sql).toContain("ON CONFLICT (service_type_id, version) DO NOTHING");

      const stageRows = sql.slice(
        sql.indexOf("INSERT INTO _rail_stage"),
        sql.indexOf("-- Fail the migration"),
      );
      for (const svc of [
        "RAIL_TRANSPORTATION",
        "RAIL_HINTERLAND_TRANSIT",
        "END_TO_END_RAIL_FREIGHT",
      ]) {
        const rows = stageRows.match(new RegExp(`\\('${svc}',\\s*\\d+,`, "g")) ?? [];
        expect(rows).toHaveLength(14);
      }
    });

    it("uses the milestone table's real stage column names", () => {
      const stageInsert = sql.slice(
        sql.indexOf("INSERT INTO milestone_template_stage"),
        sql.indexOf("-- ── 2. Published assumptions"),
      );
      for (const column of [
        "milestone_template_id",
        "stage_seq",
        "code",
        "label_fr",
        "label_en",
        "default_offset_days",
        "weight",
        "min_duration_hours",
        "owner_tier",
        "is_anchor",
        "is_target_lock",
        "is_client_visible",
        "required_evidence_doc_type",
        "auto_advance_on_event",
        "chain_segment",
        "cadence",
        "is_system",
        "system_code",
        "source_version",
      ]) {
        expect(stageInsert).toContain(column);
      }
      expect(stageInsert).not.toMatch(/\bname_fr\b|\bname_en\b/);
    });

    it("backfills published assumptions, complete field sets, and container capture", () => {
      expect(sql).toContain("INSERT INTO service_type_assumption");
      expect(sql.match(/'FORCE_MAJEURE'/g)).toHaveLength(3);
      expect(sql).toContain("INSERT INTO service_type_field_set");
      expect(sql).toContain("INSERT INTO service_type_field (");
      expect(sql).toContain("captures_containers = true");
      expect(sql).toContain("container_detail_mode = 'GROUPED'");

      // Stations/doors remain registry-backed places and the operator remains a
      // real rate provider, rather than free text that cannot drive a rate card.
      expect(sql).toContain(
        "'pol','Gare / terminal de départ','Origin rail terminal / station','GEO_PLACE'",
      );
      expect(sql).toContain(
        "'pod','Gare / terminal d''arrivée','Destination rail terminal / station','GEO_PLACE'",
      );
      expect(sql).toContain(
        "'place_receipt','Lieu d''enlèvement','Place of collection','GEO_PLACE'",
      );
      expect(sql).toContain(
        "'rail_operator','Opérateur ferroviaire','Railway operator','RATE_PROVIDER'",
      );
    });

    it("maps the financial dictionary by label and is safely reversible", () => {
      expect(sql).toContain("JOIN dictionary_item di ON di.label_en = rd.label_en");
      expect(sql).toContain(
        "ON CONFLICT (service_type_id, dictionary_item_id) DO NOTHING",
      );
      for (const label of [
        "Rail Freight",
        "Railhead Terminal Handling",
        "Rail Shunting & Station Fee",
        "Wagon Demurrage",
        "Rail Escort & Security Fee",
        "Rail Corridor Levy",
      ]) {
        expect(sql).toContain(`'${label}'`);
      }
      expect(sql).toContain("-- DOWN");
      expect(sql).toContain("-- DELETE FROM milestone_template_stage");
      expect(sql).toContain("-- DELETE FROM service_type_field_set");
    });
  });

  describe("Control Tower rail mode", () => {
    it("keeps rail as a first-class client mode, filter, count, glyph, and token", () => {
      const model = fs.readFileSync(DASHBOARD_MODEL, "utf8");
      const icons = fs.readFileSync(MODE_ICONS, "utf8");
      const legend = fs.readFileSync(MAP_LEGEND, "utf8");
      const css = fs.readFileSync(CLIENT_CSS, "utf8");

      expect(model).toContain(
        'ShipmentMode = "sea" | "road" | "air" | "rail" | "other"',
      );
      expect(model).toContain('RAIL: "rail"');
      expect(icons).toMatch(/rail:\s*"M/);
      expect(icons).toMatch(/rail:\s*mi\(/);
      expect(legend).toContain('["sea", "air", "road", "rail"]');
      expect(css).toContain("--mode-rail: 147 51 234;");
    });

    it("classifies rail in both backend mode and movement expressions", () => {
      const repo = fs.readFileSync(DASHBOARD_REPO, "utf8");
      expect(repo).toContain("l.mode IN ('AIR','SEA','LAND','RAIL')");
      expect(repo).toContain("THEN 'RAIL'");
      expect(repo).toContain(
        "l.dossier_id = d.dossier_id AND l.mode IN ('AIR','SEA','LAND','RAIL')",
      );
    });
  });
});
