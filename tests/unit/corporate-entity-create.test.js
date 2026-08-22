"use strict";
/**
 * Corporate entity CREATE — field coverage (DATA 2.7 regression).
 *
 * THE INCIDENT. The shared schema (`entityCommon.masterCreate`) validated the
 * full ~40-field body the entity form sends, and PATCH persisted all of it —
 * but POST went through a hand-written camelCase re-mapping that listed 18
 * fields and silently dropped the rest: `share_capital`, `website`, `email`,
 * `phone`, `industry`, `headcount`, `timezone`, `incorporation_place`,
 * `incorporation_country`, `dissolution_date`, `share_capital_paid_up`,
 * `share_capital_currency`, the legal-form reference triple, every downstream
 * default (`default_currency`, `default_tax_jurisdiction_id`,
 * `payroll_country`, `numbering_reset`, `vat_registered`) and the group fields.
 * A user who filled in the whole create form watched the edit modal open
 * half-empty a second later. Nothing went red, because a dropped key is not an
 * error — hence this suite.
 *
 * Three properties keep it fixed:
 *
 *   1. PARITY — every key the shared master shape accepts is on the repo's
 *      WRITABLE allow-list and vice versa. One list drifting from the other is
 *      the precondition for the bug.
 *   2. COVERAGE — a fully-populated, schema-validated create body reaches the
 *      INSERT column-for-column. Asserted against the SQL actually issued, not
 *      against a list maintained beside the service.
 *   3. CALLER SHAPES — the AI tool calls `service.create(client, payload,
 *      actor)` with the validated snake_case payload; the old camelCase shape
 *      must also keep working for any straggler caller.
 */
const { entityCommon } = require("@praxis/shared");
const legalForms = require("../../packages/shared/data/legal-forms");
const repo = require("../../src/modules/master/corporate_entity/corporate_entity.repo");
const service = require("../../src/modules/master/corporate_entity/corporate_entity.service");

/**
 * A client modelling just enough of the tenant schema for create():
 * the code-uniqueness probe, the parent lookup, the INSERT (whose column list
 * is the object under test), the ops-prefix read, and the event/audit writes.
 */
function fakeCreate({ existingCodes = [], parents = {} } = {}) {
  const state = { sql: [], insertedColumns: null, insertedRow: null };
  return {
    state,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      state.sql.push(s);
      if (/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/i.test(s)) return { rows: [] };
      if (/^SELECT \* FROM corporate_entity WHERE code = \$1/i.test(s)) {
        return { rows: existingCodes.includes(params[0]) ? [{ entity_id: "e-existing", code: params[0] }] : [] };
      }
      if (/^SELECT \* FROM "?corporate_entity"? WHERE "?entity_id"? = \$1/i.test(s)) {
        return { rows: parents[params[0]] ? [parents[params[0]]] : [] };
      }
      if (/^INSERT INTO "?corporate_entity"?/i.test(s)) {
        const cols = /\(([^)]+)\) VALUES/i.exec(s)[1].split(",").map((c) => c.trim().replace(/"/g, ""));
        state.insertedColumns = cols;
        state.insertedRow = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
        return { rows: [{ entity_id: "e-new", ops_reference_prefix: null, ...state.insertedRow }] };
      }
      // operation-reference.entityPrefix — a stored prefix short-circuits the walk.
      if (/^SELECT ops_reference_prefix, trading_name, legal_name FROM corporate_entity WHERE entity_id/i.test(s)) {
        return { rows: [{ ops_reference_prefix: "SL", trading_name: null, legal_name: "Smart Logistics" }] };
      }
      if (/event_type|event_log|immutable_ledger|notification|app_user/i.test(s)) return { rows: [] };
      throw new Error("Unmatched SQL in fakeCreate: " + s.slice(0, 160));
    },
  };
}

/** A CM legal form straight from the catalogue, so the cross-field refine passes. */
const SARL = legalForms.forCountry("CM").find((f) => f.abbreviation === "SARL");

/** Every field of the create schema, populated — what the form sends when a user fills in everything. */
const FULL_BODY = {
  code: "SLAS",
  legal_name: "Smart Logistics SARL",
  trading_name: "SmartLog",
  legal_form: SARL.abbreviation,
  legal_form_code: SARL.code,
  legal_form_source: SARL.source,
  legal_form_jurisdiction: SARL.jurisdiction_code,
  niu: "M012345678901X",
  rccm: "RC/DLA/2020/B/1234",
  country_code: "CM",
  address: "123 Rue de la Joie, Douala",
  description: "Freight forwarding and customs brokerage.",
  industry: "Logistics",
  website: "https://smartlog.example",
  email: "contact@smartlog.example",
  phone: "+237690000000",
  headcount: 42,
  timezone: "Africa/Douala",
  incorporation_date: "2020-03-01",
  incorporation_country: "CM",
  incorporation_place: "Douala",
  dissolution_date: null,
  share_capital: 10000000,
  share_capital_currency: "XAF",
  share_capital_paid_up: 5000000,
  bank_block: { bank_name: "Afriland", account_number: "1000500012345" },
  doc_prefix: "SLS",
  default_language: "fr",
  fiscal_year_start_month: 1,
  accounting_framework: "OHADA",
  default_currency: "XAF",
  default_tax_jurisdiction_id: "3f1a5b6c-1111-4222-8333-444455556666",
  payroll_country: "CM",
  numbering_reset: "ANNUAL",
  vat_registered: true,
  parent_entity_id: null,
  relationship_type: null,
  ownership_percent: null,
  consolidates: true,
  is_group_parent: true,
  logo_light_ref: null,
  logo_dark_ref: null,
  registration_status: "DRAFT",
};

describe("schema/allow-list parity", () => {
  it("keeps the shared master shape and the repo's WRITABLE list identical", () => {
    // A key in the schema but not WRITABLE is a field the API accepts and can
    // never write; the reverse is a column writable through PATCH that no
    // validator ever admits. Both are the drift DATA 2.7 grew out of.
    expect([...entityCommon.masterShapeKeys].sort()).toEqual([...repo.WRITABLE].sort());
  });
});

describe("create persists what the schema accepted", () => {
  it("validates the fully-populated form body — the fixture is honest", () => {
    const parsed = entityCommon.masterCreate.safeParse(FULL_BODY);
    expect(parsed.success).toBe(true);
  });

  it("lands EVERY non-null validated field in the INSERT, column for column", async () => {
    const parsed = entityCommon.masterCreate.parse(FULL_BODY);
    const c = fakeCreate();
    const row = await service.create(c, { ...parsed, actor: { user_id: "u1" } });

    const expected = Object.keys(parsed).filter((k) => parsed[k] !== null && parsed[k] !== undefined);
    const missing = expected.filter((k) => !c.state.insertedColumns.includes(k));
    expect(missing).toEqual([]);
    // …and the values are the validated ones, not re-mapped approximations.
    expect(c.state.insertedRow.share_capital).toBe(10000000);
    expect(c.state.insertedRow.email).toBe("contact@smartlog.example");
    expect(c.state.insertedRow.legal_form_code).toBe(SARL.code);
    expect(c.state.insertedRow.vat_registered).toBe(true);
    expect(c.state.insertedRow.registration_status).toBe("DRAFT");
    // bank_block is stringified for the jsonb column, exactly as PATCH does it.
    expect(JSON.parse(c.state.insertedRow.bank_block)).toEqual(FULL_BODY.bank_block);
    // The response carries the ops prefix assigned in the same transaction.
    expect(row.ops_reference_prefix).toBe("SL");
    expect(c.state.sql).toContain("COMMIT");
  });

  it("omits null fields so the column DEFAULTs and 0515 triggers derive them", async () => {
    const parsed = entityCommon.masterCreate.parse({
      code: "MINI",
      legal_name: "Minimal Co",
      country_code: "CM",
      accounting_framework: null,
      default_currency: null,
      payroll_country: null,
      numbering_reset: null,
    });
    const c = fakeCreate();
    await service.create(c, { ...parsed, actor: {} });
    for (const col of ["accounting_framework", "default_currency", "payroll_country", "numbering_reset"]) {
      expect(c.state.insertedColumns).not.toContain(col);
    }
    expect(c.state.insertedColumns).toEqual(expect.arrayContaining(["code", "legal_name", "country_code"]));
  });

  it("refuses a duplicate code with a 409 before touching the table", async () => {
    const c = fakeCreate({ existingCodes: ["SLAS"] });
    await expect(service.create(c, { code: "SLAS", legal_name: "X", actor: {} }))
      .rejects.toMatchObject({ code: "DUPLICATE_CODE", status: 409 });
    expect(c.state.insertedColumns).toBeNull();
  });

  it("verifies the parent exists when a group edge is set at creation", async () => {
    const c = fakeCreate();
    await expect(
      service.create(c, { code: "SUB", legal_name: "Sub", parent_entity_id: "3f1a5b6c-1111-4222-8333-444455559999", actor: {} }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("caller shapes", () => {
  it("accepts the AI write-adapter shape — snake_case payload, actor as the third argument", async () => {
    // The tool manifest registers `service.create` directly, and the adapter
    // calls `service(client, payload, actor)`. Before the fix this path
    // destructured camelCase names out of a snake_case payload and inserted
    // legal_name NULL — a 23502 on every assistant-driven create.
    const parsed = entityCommon.masterCreate.parse({ code: "AICO", legal_name: "Assistant Co", country_code: "CM" });
    const c = fakeCreate();
    await service.create(c, parsed, { user_id: "u-ai" });
    expect(c.state.insertedRow.legal_name).toBe("Assistant Co");
    expect(c.state.insertedRow.code).toBe("AICO");
  });

  it("still honours the legacy camelCase argument names", async () => {
    const c = fakeCreate();
    await service.create(c, {
      code: "OLD1", legalName: "Legacy Co", countryCode: "CM", docPrefix: "LGC",
      fiscalYearStartMonth: 7, registrationStatus: "ACTIVE", actor: {},
    });
    expect(c.state.insertedRow.legal_name).toBe("Legacy Co");
    expect(c.state.insertedRow.doc_prefix).toBe("LGC");
    expect(c.state.insertedRow.fiscal_year_start_month).toBe(7);
    expect(c.state.insertedRow.registration_status).toBe("ACTIVE");
  });

  it("rejects a bad fiscal month whichever shape carried it", async () => {
    const c = fakeCreate();
    await expect(service.create(c, { code: "BAD", legal_name: "B", fiscal_year_start_month: 13, actor: {} }))
      .rejects.toMatchObject({ code: "BAD_MONTH" });
  });
});
