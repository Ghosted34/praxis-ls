/**
 * The gate's own regression suite.
 *
 * A static checker earns its place in CI only if it is trusted, and it is
 * trusted only while it keeps catching the bugs it was written for and keeps
 * staying quiet about the shapes that are fine. Both halves are tested here:
 * the three production incidents below MUST fail, and the constructs the
 * checker deliberately refuses to judge MUST stay silent.
 *
 * The catalogue is built once — it reads every file in migrations/ — and shared
 * across the suite.
 */
"use strict";
const { buildCatalogue, checkSql, extractSqlStrings } = require("../../scripts/db/check-query-columns");

let cat;
beforeAll(() => {
  cat = buildCatalogue();
});

const refs = (sql) => checkSql(sql, cat).map((f) => f.ref).sort();

describe("catalogue", () => {
  it("replays the migrations into real tables", () => {
    expect(cat.tables.size).toBeGreaterThan(200);
    expect([...cat.tables.get("service_type")]).toEqual(expect.arrayContaining(["key", "name_fr"]));
    expect([...cat.tables.get("corporate_entity")]).toEqual(expect.arrayContaining(["country_code"]));
  });

  it("keys platform tables under their schema, so a tenant `tenant` is not platform's", () => {
    expect(cat.tables.has("platform.tenant")).toBe(true);
    expect(cat.schemas.has("platform")).toBe(true);
  });

  it("applies ADD COLUMN, and the dynamic rename in 0640", () => {
    // 0650 adds these to a table 0310 created.
    expect([...cat.tables.get("service_type")]).toEqual(
      expect.arrayContaining(["default_duration_days", "duration_basis", "is_open_ended"]),
    );
    // 0640 renames is_debours -> is_disbursement on every table carrying it.
    expect([...cat.tables.get("dictionary_item")]).toContain("is_disbursement");
    expect([...cat.tables.get("dictionary_item")]).not.toContain("is_debours");
  });
});

describe("the incidents it was written for", () => {
  it("catches BOTH bad columns in the milestone template register (10708)", () => {
    // Production only ever reported st.code: Postgres names the first column it
    // cannot resolve, so st.name would have been a second deploy.
    expect(
      refs(`SELECT t.*, st.code AS service_type_code, st.name AS service_type_name
              FROM milestone_template t
              LEFT JOIN service_type st ON st.service_type_id = t.service_type_id`),
    ).toEqual(["st.code", "st.name"]);
  });

  it("catches ce.country in the contract drafter", () => {
    expect(
      refs(`SELECT hc.*, ce.legal_name AS entity_name, ce.country AS entity_country
              FROM hr_contract hc
              LEFT JOIN corporate_entity ce ON ce.entity_id = hc.entity_id`),
    ).toEqual(["ce.country"]);
  });

  it("passes the corrected versions of both", () => {
    expect(
      refs(`SELECT t.*, st.key AS service_type_code, COALESCE(st.name_fr, st.name_en) AS n
              FROM milestone_template t
              LEFT JOIN service_type st ON st.service_type_id = t.service_type_id`),
    ).toEqual([]);
    expect(
      refs(`SELECT hc.*, ce.legal_name AS entity_name, ce.country_code AS entity_country
              FROM hr_contract hc
              LEFT JOIN corporate_entity ce ON ce.entity_id = hc.entity_id`),
    ).toEqual([]);
  });
});

describe("what it refuses to judge", () => {
  it("says nothing about a schema-qualified relation", () => {
    expect(refs("SELECT t.slug FROM platform.tenant t WHERE t.tenant_id = $1")).toEqual([]);
  });

  it("says nothing about a view, whose columns it does not compute", () => {
    expect(refs("SELECT d.anything_at_all FROM dossier_visible d")).toEqual([]);
  });

  it("says nothing about a CTE or a derived table", () => {
    expect(
      refs(`WITH recent AS (SELECT 1 AS n) SELECT recent.invented FROM recent`),
    ).toEqual([]);
    expect(
      refs(`SELECT x.invented FROM (SELECT 1 AS n FROM employee) x`),
    ).toEqual([]);
  });

  it("says nothing when the table itself is interpolated", () => {
    // extractSqlStrings turns ${...} into a marker; an alias bound to it is
    // unresolvable and must not be guessed at.
    const [sql] = extractSqlStrings("const q = `SELECT z.whatever FROM ${table} z WHERE z.id = $1`");
    expect(refs(sql.text)).toEqual([]);
  });

  it("does not invent a column out of SQL arithmetic across a JS concatenation", () => {
    // "…version = setting.version + 1, " + "updated_by = …" once glued into
    // `setting.version1` when the extractor split on "+" to find the seams.
    const [sql] = extractSqlStrings(
      `const q = "INSERT INTO setting (section, key) VALUES ($1,$2) " +
         "ON CONFLICT (section, key) DO UPDATE SET version = setting.version + 1, " +
         "updated_by = EXCLUDED.updated_by RETURNING *";`,
    );
    expect(refs(sql.text)).toEqual([]);
  });
});

describe("the gate itself", () => {
  it("has no unbaselined findings — run `npm run db:check:columns:report` for the backlog", () => {
    const fs = require("fs");
    const path = require("path");
    const baselinePath = path.join(__dirname, "..", "..", "scripts", "db", "query-columns.baseline.json");
    const baseline = new Set(
      JSON.parse(fs.readFileSync(baselinePath, "utf8")).grandfathered.map((e) => `${e.file}|${e.ref}`),
    );
    const { execFileSync } = require("child_process");
    const out = execFileSync(
      process.execPath,
      [path.join(__dirname, "..", "..", "scripts", "db", "check-query-columns.js"), "--json", "--report"],
      { encoding: "utf8" },
    );
    const fresh = JSON.parse(out).findings.filter((f) => !baseline.has(`${f.file}|${f.ref}`));
    expect(fresh).toEqual([]);
  });
});
