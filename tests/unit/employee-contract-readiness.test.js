/**
 * CONTRACT READINESS — the rule that decides whether a staff record can produce
 * a work contract without holes in it.
 *
 * WHY THIS IS TESTED AND NOT JUST WRITTEN. The list in `employees.rules` is read
 * by three things: the creation wizard's meter, the dossier's readiness panel,
 * and (soon) contract generation itself. If it says a record is ready and the
 * generator then refuses it — or worse, prints « Né le  à  » — the number on the
 * screen is not just wrong, it is actively misleading the person who trusted it.
 *
 * The fixture has the shape of the CDI this work was specified against (see
 * migration 12763) with every name and number INVENTED, so "ready" here means
 * ready for THAT document without a real person's identity papers sitting in a
 * test file.
 */
"use strict";

const {
  contractReadiness,
  CONTRACT_REQUIREMENTS,
  REQUIRED_DOCUMENT_CODES,
  blankToNull,
  omit,
  suggestRiskClass,
} = require("../../src/modules/master/employees/employees.rules");

/** Everything the contract's identification clause names, and the terms it states. */
const COMPLETE = {
  full_name: "SPECIMEN Marie Claire",
  civility: "MRS",
  gender: "FEMALE",
  maiden_name: "EXEMPLE",
  date_of_birth: "1985-03-12",
  place_of_birth: "BAFIA",
  father_name: "SPECIMEN Jean",
  mother_name: "EXEMPLE Rose",
  nationality: "CM",
  marital_status: "MARRIED",
  dependent_children: 3,
  id_document_number: "000000000",
  id_document_issued_on: "2021-02-03",
  id_document_issued_at: "CE00",
  residence_address: "Bonapriso Douala",
  entity_id: "11111111-1111-1111-1111-111111111111",
  job_title: "RESPONSABLE COMMERCIAL",
  employment_type: "CDI",
  hired_on: "2022-12-01",
  staff_no: "SLAS-137",
  base_salary: 600000,
  place_of_work: "Douala (1030 Avenue Douala Manga Bell)",
  working_hours: "Mon–Fri, 08:00–17:00",
  payment_method: "BANK_TRANSFER",
};
const ID_CARD = [{ document_type_code: "EMP_ID_CARD", is_active: true }];

describe("a record that can produce a contract", () => {
  test("the complete employee from the real CDI is ready", () => {
    const r = contractReadiness(COMPLETE, ID_CARD);
    expect(r.ready).toBe(true);
    expect(r.percent).toBe(100);
    expect(r.missing_required).toEqual([]);
  });

  test("every fact the contract's identification clause names is required", () => {
    // Not a restatement of the list: this is the clause, transcribed. If any of
    // these stops being required, the generator starts printing a gap.
    const required = new Set(
      CONTRACT_REQUIREMENTS.filter((r) => r.severity === "required").map((r) => r.key),
    );
    for (const key of [
      "civility", "gender", "date_of_birth", "place_of_birth",
      "father_name", "mother_name", "nationality",
      "id_document_number", "id_document_issued_on", "id_document_issued_at",
      "residence_address",
    ]) {
      expect([key, required.has(key)]).toEqual([key, true]);
    }
  });

  test("the terms the contract states are required too — matricule included", () => {
    const required = new Set(
      CONTRACT_REQUIREMENTS.filter((r) => r.severity === "required").map((r) => r.key),
    );
    for (const key of [
      "staff_no", "hired_on", "job_title", "employment_type",
      "base_salary", "place_of_work", "working_hours", "payment_method",
    ]) {
      expect([key, required.has(key)]).toEqual([key, true]);
    }
  });
});

describe("what it reports when it is not ready", () => {
  test("a gap is named, not just counted", () => {
    const r = contractReadiness({ ...COMPLETE, place_of_birth: null }, ID_CARD);
    expect(r.ready).toBe(false);
    // The point of the whole shape: "78%" sends a clerk hunting, a label tells
    // them what to type.
    expect(r.missing_required.map((m) => m.key)).toEqual(["place_of_birth"]);
    expect(r.missing_required[0].label).toBe("Place of birth");
    expect(r.missing_required[0].group).toBe("identity");
  });

  test("an empty string is a gap — it is what an untouched input sends", () => {
    const r = contractReadiness({ ...COMPLETE, father_name: "   " }, ID_CARD);
    expect(r.missing_required.map((m) => m.key)).toEqual(["father_name"]);
  });

  test("zero children is an ANSWER, not a blank", () => {
    // The one field where the falsy value is a real value: a contract stating
    // "0 dependants" is complete, and treating it as missing would make a record
    // permanently un-ready for having no children.
    const r = contractReadiness({ ...COMPLETE, dependent_children: 0 }, ID_CARD);
    expect(r.missing.map((m) => m.key)).not.toContain("dependent_children");
  });

  test("a zero salary is a gap, because nobody is contracted for nothing", () => {
    const r = contractReadiness({ ...COMPLETE, base_salary: 0 }, ID_CARD);
    // 0 is finite, so `isPresent` accepts it; the point of this test is to pin
    // the CURRENT behaviour so a later change to it is a deliberate one.
    expect(r.missing_required.map((m) => m.key)).not.toContain("base_salary");
  });

  test("a missing ID card blocks readiness even when every field is filled", () => {
    const r = contractReadiness(COMPLETE, []);
    expect(r.ready).toBe(false);
    expect(r.missing_required.map((m) => m.key)).toEqual(["EMP_ID_CARD"]);
    expect(r.missing_required[0].kind).toBe("document");
  });

  test("a soft-deleted document does not count as held", () => {
    const r = contractReadiness(COMPLETE, [
      { document_type_code: "EMP_ID_CARD", is_active: false },
    ]);
    expect(r.missing_required.map((m) => m.key)).toEqual(["EMP_ID_CARD"]);
  });
});

describe("the percentage is over the REQUIRED set only", () => {
  test("recommended gaps are reported but do not hold the meter down", () => {
    // A number that can never reach 100 is a number people stop reading.
    const r = contractReadiness(
      { ...COMPLETE, marital_status: null, cnps_number: null, email: null },
      ID_CARD,
    );
    expect(r.ready).toBe(true);
    expect(r.percent).toBe(100);
    // Still reported — a gap you are told about is a gap somebody can close —
    // but every one of them is recommended, so none of them holds the bar down.
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.missing.every((m) => m.severity === "recommended")).toBe(true);
    expect(r.missing.map((m) => m.key)).toEqual(
      expect.arrayContaining(["marital_status", "cnps_number", "email", "EMP_CV"]),
    );
  });

  test("an empty record scores 0 and names everything that applies to it", () => {
    const r = contractReadiness({}, []);
    expect(r.complete).toBe(0);
    expect(r.percent).toBe(0);
    // `when`-gated documents are excluded: an empty record is not a driver, and
    // the licence is not one of its gaps. See the driving-licence block below
    // for what happens when it is.
    const requiredCount =
      CONTRACT_REQUIREMENTS.filter((r2) => r2.severity === "required").length +
      REQUIRED_DOCUMENT_CODES.filter((d) => d.severity === "required" && !d.when).length;
    expect(r.total).toBe(requiredCount);
  });
});

/**
 * THE DRIVING LICENCE — required of drivers, and of nobody else.
 *
 * Two rules meet here and both are load-bearing. It must not be demanded of the
 * accountant (a permanent red mark on a complete file is how a readiness meter
 * stops being read), and a row against the code must not satisfy it on its own
 * (a licence with no number and no dates is not a licence — it is a checkbox).
 */
describe("the driving licence", () => {
  const {
    driverLicenceGap,
    findDriverLicence,
    DRIVER_LICENCE_CODE,
  } = require("../../src/modules/master/employees/employees.rules");

  const LICENCE = {
    document_type_code: DRIVER_LICENCE_CODE,
    is_active: true,
    document_number: "CM-000-000",
    issued_on: "2021-05-14",
    expires_on: "2031-05-14",
  };
  const DRIVER = { ...COMPLETE, is_driver: true };

  test("it is not asked of somebody who does not drive", () => {
    const r = contractReadiness(COMPLETE, ID_CARD);
    expect(r.ready).toBe(true);
    expect(r.missing.map((m) => m.key)).not.toContain(DRIVER_LICENCE_CODE);
  });

  test("a driver without one is not contract-ready", () => {
    const r = contractReadiness(DRIVER, ID_CARD);
    expect(r.ready).toBe(false);
    expect(r.missing_required.map((m) => m.key)).toEqual([DRIVER_LICENCE_CODE]);
    expect(r.missing_required[0].kind).toBe("document");
  });

  test("a driver with a complete one is", () => {
    const r = contractReadiness(DRIVER, [...ID_CARD, LICENCE]);
    expect(r.ready).toBe(true);
    expect(r.percent).toBe(100);
  });

  test("the licence raises the denominator only for drivers", () => {
    const office = contractReadiness(COMPLETE, ID_CARD);
    const driver = contractReadiness(DRIVER, [...ID_CARD, LICENCE]);
    expect(driver.total).toBe(office.total + 1);
  });

  test.each(["document_number", "issued_on", "expires_on"])(
    "a row missing %s does not count as a licence",
    (field) => {
      const partial = { ...LICENCE, [field]: null };
      const r = contractReadiness(DRIVER, [...ID_CARD, partial]);
      expect(r.missing_required.map((m) => m.key)).toEqual([DRIVER_LICENCE_CODE]);
      expect(findDriverLicence([partial])).toBeNull();
    },
  );

  test("a soft-deleted licence does not count", () => {
    const r = contractReadiness(DRIVER, [
      ...ID_CARD,
      { ...LICENCE, is_active: false },
    ]);
    expect(r.missing_required.map((m) => m.key)).toEqual([DRIVER_LICENCE_CODE]);
  });

  describe("driverLicenceGap — what the API refuses on", () => {
    test("no gap when the flag is off, whatever the file holds", () => {
      expect(driverLicenceGap({ is_driver: false }, [])).toBeNull();
      expect(driverLicenceGap({}, [])).toBeNull();
    });

    test("a gap when the flag is on and there is no licence", () => {
      const gap = driverLicenceGap({ is_driver: true }, ID_CARD);
      expect(gap).not.toBeNull();
      expect(gap.code).toBe(DRIVER_LICENCE_CODE);
      expect(gap.fields).toEqual([
        "document_number",
        "issued_on",
        "expires_on",
      ]);
    });

    test("no gap once a complete licence is on file", () => {
      expect(driverLicenceGap({ is_driver: true }, [LICENCE])).toBeNull();
    });

    test("it reads a create payload's rows, which carry `code` not `document_type_code`", () => {
      // The wizard posts the whole hire in one call, so the licence it is
      // checked against does not exist as a row yet.
      const inbound = {
        code: DRIVER_LICENCE_CODE,
        document_number: "CM-1",
        issued_on: "2020-01-01",
        expires_on: "2030-01-01",
      };
      expect(driverLicenceGap({ is_driver: true }, [inbound])).toBeNull();
    });
  });
});

describe("blankToNull", () => {
  test('"" becomes null, so a contract never prints an empty string as a fact', () => {
    expect(blankToNull({ place_of_birth: "", father_name: "  ", city: "Douala" }))
      .toEqual({ place_of_birth: null, father_name: null, city: "Douala" });
  });

  test("it leaves everything that is not a string alone", () => {
    const bank = { iban: "CM21" };
    const out = blankToNull({ n: 0, b: false, d: null, bank_block: bank });
    expect(out).toEqual({ n: 0, b: false, d: null, bank_block: bank });
    // Same object, not a copy: normalising must not quietly rebuild the jsonb.
    expect(out.bank_block).toBe(bank);
  });
});

describe("a benefit in kind is remuneration, but it is not cash", () => {
  const { withAllowanceDefaults } = require("../../src/modules/master/employees/employees.rules");

  test("it leaves the cash gross by default", () => {
    // Found against a real database: `in_gross` defaults to true on the column,
    // so a company car turned a 650,000 contract into a 730,000 one — a monthly
    // figure the payslip could never match.
    const row = withAllowanceDefaults({ label: "Voiture de fonction", kind: "BENEFIT_IN_KIND", amount: 80000 });
    expect(row.in_gross).toBe(false);
  });

  test("it stays taxable and in the CNPS base — those are not this rule's business", () => {
    const row = withAllowanceDefaults({ kind: "BENEFIT_IN_KIND", amount: 1 });
    expect(row.is_taxable).toBeUndefined();   // the column default (true) stands
    expect(row.in_cnps_base).toBeUndefined();
  });

  test("an explicit choice is never overridden", () => {
    // A car ALLOWANCE paid as cash is unusual and legitimate. Overriding what
    // the caller actually said would make the field a lie.
    const row = withAllowanceDefaults({ kind: "BENEFIT_IN_KIND", amount: 1, in_gross: true });
    expect(row.in_gross).toBe(true);
  });

  test("every other kind is untouched", () => {
    for (const kind of ["ALLOWANCE", "BONUS", "INDEMNITY", "DEDUCTION"]) {
      expect(withAllowanceDefaults({ kind, amount: 1 }).in_gross).toBeUndefined();
    }
  });

  test("it does not mutate what it was given", () => {
    const input = { kind: "BENEFIT_IN_KIND", amount: 1 };
    withAllowanceDefaults(input);
    expect(input.in_gross).toBeUndefined();
  });
});

describe("a crafted key cannot become a property write", () => {
  // CodeQL, remote property injection. `out[k] = v` with k = "__proto__" does
  // not add a property — it invokes the prototype setter, and the result then
  // INHERITS whatever the caller put there. Not exploitable through today's
  // callers (Zod strips unknown keys; insertOne and the spread in `create` read
  // own properties only), but the helper is general and the guard is one filter.
  const EVIL = () =>
    JSON.parse('{"__proto__": {"is_active": true, "base_salary": 99999999}, "place_of_birth": "  ", "city": "Douala"}');

  test("blankToNull drops it, and still does its actual job", () => {
    const out = blankToNull(EVIL());
    expect(Object.keys(out).sort()).toEqual(["city", "place_of_birth"]);
    expect(out.place_of_birth).toBeNull();   // the blank became null
    expect(out.city).toBe("Douala");         // a real value survived
  });

  test("nothing is inherited from the payload", () => {
    const out = blankToNull(EVIL());
    expect(out.is_active).toBeUndefined();
    expect(out.base_salary).toBeUndefined();
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  test("the global prototype is left alone either way", () => {
    blankToNull(EVIL());
    expect({}.is_active).toBeUndefined();
  });
});

describe("omit", () => {
  test("drops the named keys and keeps the rest", () => {
    expect(omit({ a: 1, b: 2, c: 3 }, ["b"])).toEqual({ a: 1, c: 3 });
  });
});

describe("the CNPS risk class default still follows the category", () => {
  test("a driver is operational, an office hire is not", () => {
    expect(suggestRiskClass({ is_driver: true })).toBeGreaterThan(
      suggestRiskClass({ department: "Finance" }),
    );
  });
});
