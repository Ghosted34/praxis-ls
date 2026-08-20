"use strict";

const fs = require("fs");
const path = require("path");

describe("10740 location_source", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "../../migrations/tenant/10740_attendance_location_source.sql"),
    "utf8",
  );

  it("adds a snapshot column, not a join", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS location_source/);
    expect(sql).toMatch(/CHECK \(location_source IS NULL OR location_source IN \('gps', 'none'\)\)/);
  });

  it("backfills only rows that already had coordinates", () => {
    expect(sql).toMatch(/SET location_source = 'gps'/);
    expect(sql).toMatch(/latitude IS NOT NULL/);
    expect(sql).toMatch(/longitude IS NOT NULL/);
    expect(sql).not.toMatch(/SET location_source = 'none'/);
  });
});
