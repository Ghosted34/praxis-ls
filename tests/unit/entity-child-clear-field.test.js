"use strict";
/**
 * Clearing a field on an entity's nested collection.
 *
 * THE DEFECT. `blankToUndefined` maps `""` to undefined and Zod drops an
 * undefined value from the parsed object, so `PATCH /entities/:id/registrations
 * /:childId` with `expires_on: ""` reached `updateOne` with no `expires_on`
 * key — no SET clause, no change, and a 200 saying it worked. Reported against
 * a corporate entity's RCCM row: the operator had entered the expiry by
 * mistake, cleared it, saved, and the "Registrations needing attention ·
 * Expired" banner stayed exactly where it was. There was no error to explain
 * why, because as far as every layer was concerned nothing had failed.
 *
 * The entity MASTER shape had already been given `.nullable()` for this reason
 * ("a user who empties a field and saves would watch it come straight back" —
 * entity-form-fields.ts). Every nested collection was still missing it, which
 * is the half these tests pin: `null` clears, `""` is still "not filled in",
 * and a NOT NULL column refuses in a sentence rather than silently.
 */
const { entityCommon } = require("@praxis/shared");
const { updateOne } = require("../../src/shared/db/query-helpers");
const {
  entityResourceSpecs,
} = require("../../src/modules/master/_shared/nested");

/** The fields a person can empty, per collection, with a value that clears them. */
const CLEARABLE = {
  personUpdate: [
    "title",
    "date_of_birth",
    "nationality",
    "country_of_residence",
    "id_type",
    "id_number",
    "company_registration_number",
    "company_country",
    "holder_entity_id",
    "email",
    "phone",
    "share_class",
    "share_count",
    "share_nominal_value",
    "ownership_percent",
    "voting_percent",
    "signature_limit_amount",
    "signature_limit_currency",
    "effective_from",
    "effective_to",
    "employee_id",
    "client_id",
    "supplier_id",
    "notes",
  ],
  contactUpdate: [
    "title",
    "email",
    "phone",
    "role_tags",
    "language",
    "timezone",
  ],
  addressUpdate: [
    "line1",
    "line2",
    "city",
    "region",
    "postal_code",
    "country_code",
    "po_box",
  ],
  registrationUpdate: [
    "country_code",
    "number",
    "issuing_authority",
    "issued_on",
    "expires_on",
    "notes",
  ],
  establishmentUpdate: [
    "code",
    "country_code",
    "city",
    "address_line",
    "tax_office_ref",
    "registration_ref",
    "customs_office",
    "manager_employee_id",
    "opened_on",
    "closed_on",
  ],
  documentUpdate: [
    "document_type_id",
    "title",
    "document_number",
    "issuing_authority",
    "issued_on",
    "expires_on",
    "country_code",
    "establishment_id",
    "vault_id",
    "physical_ref",
    "renewal_lead_days",
    "notes",
  ],
  taxRegistrationUpdate: [
    "jurisdiction_id",
    "tax_number",
    "regime",
    "filing_frequency",
    "filing_due_day",
    "currency",
    "registered_on",
    "deregistered_on",
    "filing_portal_url",
    "responsible_user_id",
    "notes",
  ],
};

describe("entity nested collections — clearing a field", () => {
  for (const [schemaName, fields] of Object.entries(CLEARABLE)) {
    describe(schemaName, () => {
      for (const field of fields) {
        it(`accepts null for ${field} and keeps it in the patch`, () => {
          const parsed = entityCommon[schemaName].safeParse({ [field]: null });
          expect(
            parsed.success ? null : parsed.error.flatten().fieldErrors,
          ).toBeNull();
          // The KEY has to survive: `updateOne` builds its SET clause from
          // Object.keys(patch), so a dropped key is a column never written.
          expect(Object.keys(parsed.data)).toContain(field);
          expect(parsed.data[field]).toBeNull();
        });
      }
    });
  }

  /**
   * The reported row, end to end: an RCCM whose expiry was entered by mistake.
   */
  it("clears an RCCM expiry date without disturbing the rest of the row", () => {
    const parsed = entityCommon.registrationUpdate.safeParse({
      country_code: "CM",
      kind: "RCCM",
      number: "RC/DLA/2021/B/2060",
      issuing_authority: "TPI Douala-Bonanjo",
      issued_on: "2021-04-08",
      expires_on: null,
      is_primary: false,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data.expires_on).toBeNull();
    expect(parsed.data.number).toBe("RC/DLA/2021/B/2060");
  });

  it("keeps an emptied box in the patch rather than dropping the key", () => {
    // `""` is what a cleared control produces before the client normalises it.
    // Whatever it parses TO, the key has to survive: `updateOne` builds its SET
    // clause from Object.keys(patch), so a dropped key is a column that is
    // never written and a request that reports success having changed nothing.
    const parsed = entityCommon.registrationUpdate.safeParse({
      expires_on: "",
    });
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.data)).toContain("expires_on");
    expect(parsed.data.expires_on ?? null).toBeNull();
  });

  it("refuses to clear a NOT NULL column, in a sentence", () => {
    const kind = entityCommon.registrationUpdate.safeParse({ kind: null });
    expect(kind.success).toBe(false);
    expect(kind.error.flatten().fieldErrors.kind.join(" ")).toMatch(
      /required/i,
    );

    // entity_tax_registration.country_code is NOT NULL — unlike every other
    // country column on these collections.
    const country = entityCommon.taxRegistrationUpdate.safeParse({
      country_code: null,
    });
    expect(country.success).toBe(false);
    expect(country.error.flatten().fieldErrors.country_code.join(" ")).toMatch(
      /required/i,
    );
  });

  it("keeps the date-order rule working when one side is cleared", () => {
    // Clearing the issue date cannot make the expiry invalid — the database
    // CHECK reads the same way (`expires_on IS NULL OR issued_on IS NULL OR …`).
    expect(
      entityCommon.registrationUpdate.safeParse({
        issued_on: null,
        expires_on: "2020-01-01",
      }).success,
    ).toBe(true);
    // …and a genuinely backwards pair is still a 422 on the field at fault.
    const bad = entityCommon.registrationUpdate.safeParse({
      issued_on: "2021-04-08",
      expires_on: "2020-01-01",
    });
    expect(bad.success).toBe(false);
    expect(bad.error.flatten().fieldErrors.expires_on).toBeTruthy();
  });

  it("does not leave a filing due day attached to a cleared frequency", () => {
    // The rule tested `!== undefined`, so clearing the frequency with an
    // explicit null slipped past it and left an orphan due day the obligation
    // generator silently skips.
    const orphan = entityCommon.taxRegistrationUpdate.safeParse({
      filing_frequency: null,
      filing_due_day: 15,
    });
    expect(orphan.success).toBe(false);
    expect(orphan.error.flatten().fieldErrors.filing_due_day).toBeTruthy();
    // Clearing BOTH is how you turn the obligation off, and must be allowed.
    expect(
      entityCommon.taxRegistrationUpdate.safeParse({
        filing_frequency: null,
        filing_due_day: null,
      }).success,
    ).toBe(true);
  });
});

/**
 * The other half of the chain: what the parsed patch turns into as SQL.
 *
 * A schema that accepts `null` is only half a fix — `updateOne` builds its SET
 * clause from `Object.keys(patch)`, so the assertion worth pinning is that the
 * cleared column appears in the statement with a null parameter, not that the
 * object looked right on the way past.
 */
describe("clearing a field reaches the database as a null", () => {
  /** A pg client that records the statement instead of running it. */
  const recorder = () => {
    const calls = [];
    return {
      calls,
      query: (text, params) => {
        calls.push({ text, params });
        return Promise.resolve({ rows: [{ registration_id: "rg1" }] });
      },
    };
  };

  const writableFor = (seg) =>
    entityResourceSpecs().find((r) => r.seg === seg).writable;

  it("SETs expires_on = NULL for a cleared registration expiry", async () => {
    const patch = entityCommon.registrationUpdate.parse({
      kind: "RCCM",
      number: "RC/DLA/2021/B/2060",
      issued_on: "2021-04-08",
      expires_on: null,
    });
    const c = recorder();
    await updateOne(
      c,
      "entity_registration",
      "registration_id",
      "rg1",
      patch,
      "*",
      writableFor("registrations"),
      { touch: "updated_at" },
    );

    const { text, params } = c.calls[0];
    expect(text).toMatch(/UPDATE entity_registration SET /);
    // The column is in the statement…
    const at = text.indexOf('"expires_on" = $');
    expect(at).toBeGreaterThan(-1);
    // …and the parameter it points at is a real null, not a string.
    const position = Number(text.slice(at).match(/\$(\d+)/)[1]);
    expect(params[position - 1]).toBeNull();
    // The rest of the row is written as given, and `updated_at` is code-provided.
    expect(params).toContain("RC/DLA/2021/B/2060");
    expect(text).toMatch(/"updated_at" = now\(\)/);
  });

  it("writes nothing for a field the patch does not mention", async () => {
    const patch = entityCommon.registrationUpdate.parse({
      number: "RC/DLA/2021/B/2060",
    });
    const c = recorder();
    await updateOne(
      c,
      "entity_registration",
      "registration_id",
      "rg1",
      patch,
      "*",
      writableFor("registrations"),
      { touch: "updated_at" },
    );
    expect(c.calls[0].text).not.toMatch(/"expires_on"/);
  });

  it("keeps refusing a column that is not in the collection's allow-list", () => {
    // `verified` is service-owned: a request must not be able to assert it.
    const patch = { verified: true };
    return expect(
      updateOne(
        recorder(),
        "entity_registration",
        "registration_id",
        "rg1",
        patch,
        "*",
        writableFor("registrations"),
        { touch: "updated_at" },
      ),
    ).rejects.toThrow(/cannot be written/i);
  });
});
