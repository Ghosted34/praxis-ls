/**
 * PROPOSE-TIME PAYLOAD VALIDATION (review 16 Sep 2026 #17).
 *
 * The companion to `ai-tool-contract-fidelity.test.js`. That file proves the
 * model is TOLD what a valid value looks like; this one proves we CHECK it at
 * the moment the action is proposed, which is the difference between an error
 * the user can act on and one they cannot.
 *
 * ── THE TWO FAILURES THIS SITS BETWEEN ──────────────────────────────────────
 *
 * Too lenient (the bug): a name in a uuid field passes here, the run is stored
 * AWAITING_CONFIRM, the user confirms, and the module's Zod validator rejects
 * it — after the confirmation, in vocabulary the user never saw.
 *
 * Too strict (the bug this function was written to fix, and must not regress
 * into): rejecting unknown keys. The model routinely sends extra fields the
 * schema does not declare; the executor destructures what it needs. Rejecting
 * those produced "validation failed: unknown 'client_name'" on an action that
 * had every detail right. That leniency is deliberate and is pinned below.
 */
"use strict";

const { validatePayload } = require("../../src/services/ai/orchestrator.service");

const SCHEMA = {
  type: "object",
  properties: {
    company_name: { type: "string", minLength: 1 },
    owner_user_id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    website: { type: "string", format: "uri" },
    starts_on: { type: "string", format: "date" },
    niu: { type: "string", pattern: "^[A-Z]\\d{12}$" },
    code: { type: "string", maxLength: 4 },
    payment_terms_days: { type: "integer", minimum: 0, maximum: 365 },
    amount: { type: "number", exclusiveMinimum: 0 },
    source: { type: "string", enum: ["MANUAL", "WEBSITE"] },
    lines: { type: "array", minItems: 1 },
  },
  required: ["company_name"],
};

const UUID = "3f9a1c2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b";

describe("validatePayload — formats are enforced where the user can still fix them", () => {
  test("REGRESSION: a person's name in a uuid field is refused, by name", () => {
    // Precisely the 16 Sep report. Before the fix this returned [] and the
    // failure surfaced after confirmation, from the module's Zod validator.
    const errs = validatePayload(SCHEMA, {
      company_name: "Camrail",
      owner_user_id: "Thierry Mbarga",
    });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("owner_user_id");
    expect(errs[0]).toContain("uuid");
  });

  test("a real uuid passes", () => {
    expect(validatePayload(SCHEMA, { company_name: "Camrail", owner_user_id: UUID })).toEqual([]);
  });

  test("the message never echoes the value back", () => {
    // These strings are stored on the action run and rendered in the panel. A
    // rejected value is routinely a client's email or tax id, so the error
    // names the FIELD and the expected shape — never the value itself.
    const secret = "thierry.mbarga@camrail.cm";
    const errs = validatePayload(SCHEMA, { company_name: "X", owner_user_id: secret });
    expect(errs.join(" ")).not.toContain(secret);
  });

  test("email, url, date and pattern are each checked", () => {
    const errs = validatePayload(SCHEMA, {
      company_name: "X",
      email: "not-an-email",
      website: "camrail",
      starts_on: "12/03/2026",
      niu: "lowercase",
    });
    expect(errs).toHaveLength(4);
    expect(errs.join(" ")).toContain("email");
    expect(errs.join(" ")).toContain("website");
    expect(errs.join(" ")).toContain("starts_on");
    expect(errs.join(" ")).toContain("niu");
  });

  test("a well-shaped but impossible date is refused", () => {
    // "2026-02-31" satisfies the regex and is not a day. Handing it to Postgres
    // produces a 22008 the user cannot read.
    const errs = validatePayload(SCHEMA, { company_name: "X", starts_on: "2026-02-31" });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("not a real date");
  });

  test("numeric bounds and integer-ness are enforced", () => {
    expect(validatePayload(SCHEMA, { company_name: "X", payment_terms_days: 400 })[0])
      .toContain("at most 365");
    expect(validatePayload(SCHEMA, { company_name: "X", payment_terms_days: 30.5 })[0])
      .toContain("whole number");
    // exclusiveMinimum: 0 — a zero amount is a legal number and an illegal value.
    expect(validatePayload(SCHEMA, { company_name: "X", amount: 0 })[0])
      .toContain("greater than 0");
    expect(validatePayload(SCHEMA, { company_name: "X", payment_terms_days: 30, amount: 1500 }))
      .toEqual([]);
  });

  test("a stringified number is still accepted — the model stringifies", () => {
    // The coercive contract predates this change and is deliberate.
    expect(validatePayload(SCHEMA, { company_name: "X", payment_terms_days: "30" })).toEqual([]);
  });

  test("maxLength and minItems are enforced", () => {
    expect(validatePayload(SCHEMA, { company_name: "X", code: "TOOLONG" })[0]).toContain("at most 4");
    expect(validatePayload(SCHEMA, { company_name: "X", lines: [] })[0]).toContain("at least 1");
  });

  test("enum membership still wins, and is reported once", () => {
    const errs = validatePayload(SCHEMA, { company_name: "X", source: "TELEPHONE" });
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("must be one of");
  });
});

describe("validatePayload — the leniency that was fought for stays", () => {
  test("unknown keys pass (the field-confusion fix must not regress)", () => {
    expect(
      validatePayload(SCHEMA, { company_name: "Camrail", client_name: "Camrail", whatever: 1 }),
    ).toEqual([]);
  });

  test("absent and empty optionals are not format-checked", () => {
    expect(validatePayload(SCHEMA, { company_name: "X" })).toEqual([]);
    expect(validatePayload(SCHEMA, { company_name: "X", email: "", owner_user_id: null })).toEqual([]);
  });

  test("a missing REQUIRED field is still the first thing reported", () => {
    expect(validatePayload(SCHEMA, {})[0]).toContain("missing 'company_name'");
  });

  test("a field the schema does not type is not judged", () => {
    expect(validatePayload({ type: "object", properties: { free: {} } }, { free: "anything" })).toEqual([]);
  });

  test("an unusable pattern in the catalogue is skipped, never a false rejection", () => {
    // A malformed regex must not throw inside validation nor invent an error.
    const bad = { type: "object", properties: { x: { type: "string", pattern: "([" } } };
    expect(validatePayload(bad, { x: "anything" })).toEqual([]);
  });

  test("an empty/missing schema validates nothing rather than throwing", () => {
    expect(validatePayload(null, { a: 1 })).toEqual([]);
    expect(validatePayload({}, { a: 1 })).toEqual([]);
  });
});
