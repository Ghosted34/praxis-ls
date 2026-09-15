"use strict";
/**
 * PER_BOX as the container default (12772).
 *
 * Two levers make box-level capture the default for EVERYONE, and this pins
 * both so a future edit to either is caught:
 *
 *   1. Migration 12772 — the upgrade path for existing tenants: every GROUPED
 *      service type becomes PER_BOX, and the column default flips so a service
 *      type created later captures box detail too.
 *   2. Seed 9092 — the fresh-provision path: it runs AFTER the schema
 *      migrations, so it has the last word on a new tenant and must itself seed
 *      PER_BOX, not GROUPED.
 *
 * The migration also has to satisfy the reversibility gate, so a DOWN block is
 * part of the contract.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const MIGRATION = path.join(ROOT, "migrations", "tenant", "12772_containers_per_box_default.sql");
const SEED_FIELDS = path.join(ROOT, "migrations", "seeds", "9092_seed_service_type_fields.sql");

describe("Container capture — PER_BOX is the default", () => {
  describe("Migration 12772", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");

    it("flips every GROUPED service type to PER_BOX, key-independently", () => {
      expect(sql).toMatch(/UPDATE\s+service_type\s+SET\s+container_detail_mode\s*=\s*'PER_BOX'\s+WHERE\s+container_detail_mode\s*=\s*'GROUPED'/i);
      // The flip must NOT be scoped to a key list — that was 12769's gap.
      expect(sql).not.toMatch(/WHERE[\s\S]*\bkey\s+IN\b/i);
    });

    it("sets the column default to PER_BOX for future service types", () => {
      expect(sql).toMatch(/ALTER\s+TABLE\s+service_type\s+ALTER\s+COLUMN\s+container_detail_mode\s+SET\s+DEFAULT\s+'PER_BOX'/i);
    });

    it("declares a DOWN block (reversibility gate)", () => {
      expect(sql).toContain("-- DOWN");
    });
  });

  describe("Seed 9092", () => {
    const sql = fs.readFileSync(SEED_FIELDS, "utf8");

    it("seeds equipment capture at PER_BOX so fresh tenants match the default", () => {
      expect(sql).toContain("container_detail_mode = 'PER_BOX'");
      // The GROUPED literal must be gone from the equipment-capture UPDATE — its
      // only remaining mention is the DOWN's off-switch reset.
      expect(sql).not.toMatch(/SET\s+captures_containers\s*=\s*true,\s*container_detail_mode\s*=\s*'GROUPED'/);
    });
  });
});
