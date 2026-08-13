"use strict";
/**
 * Validates the seeded tenant settings (migrations/seeds/9050) without a DB:
 * every numbering jsonb parses and conforms to the numbering-scheme validator,
 * and the format engine produces a sensible number from each.
 */
const fs = require("fs");
const path = require("path");
const {
  schemas,
} = require("../../src/modules/security/numbering_setting/numbering_setting.validator");
const {
  formatNumber,
} = require("../../src/services/documents/numbering.service");

const sql = fs.readFileSync(
  path.resolve(__dirname, "../../migrations/seeds/9050_seed_settings.sql"),
  "utf8",
);

// Pull ('numbering', 'MOD-xx', '{...}'::jsonb) tuples.
const rows = [
  ...sql.matchAll(/\('numbering',\s*'([^']+)',\s*'(\{[^']+\})'::jsonb\)/g),
].map((m) => ({ key: m[1], value: JSON.parse(m[2]) }));

describe("seeded numbering schemes (9050)", () => {
  it("seeds a scheme for every numbered accounting module", () => {
    const keys = rows.map((r) => r.key).sort();
    expect(keys).toEqual(["MOD-49", "MOD-50", "MOD-51", "MOD-55"]);
  });

  it.each(rows)(
    "%s parses and passes the numbering-scheme validator",
    (row) => {
      const parsed = schemas.put.safeParse({ scheme: row.value });
      expect(parsed.success).toBe(true);
      const effective = { code: row.key.replace("MOD-", ""), ...row.value };
      const sample = formatNumber(effective, { year: 2026, seq: 1 });
      expect(sample).toMatch(/^[A-Z]+-\d{4}-\d{5}$/); // e.g. INV-2026-00001
    },
  );
});

describe("seeded finance business rules (9050)", () => {
  it("seeds the régie policy window and quote model", () => {
    expect(sql).toMatch(/'finance',\s*'regie'/);
    expect(sql).toMatch(/policy_window_days/);
    expect(sql).toMatch(/'finance',\s*'invoice'/);
    expect(sql).toMatch(/quote_model/);
  });
});
