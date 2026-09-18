/**
 * THE TOOL CONTRACT MUST SAY WHAT THE VALIDATOR ENFORCES.
 * Review 16 Sep 2026 #17 — "new-lead creation rejected on data-type validation".
 *
 * ── THE BUG, IN ONE SENTENCE ────────────────────────────────────────────────
 *
 * `zodToJsonSchema` derived each field's top-level TYPE and threw away every
 * refinement, so `owner_user_id: z.string().uuid()` reached the model as
 * `{ type: "string" }`. The model — correctly, given what it was told — sent a
 * person's name. `validatePayload` compared it against the same lossy schema
 * and passed it. The rejection then happened at the module's real Zod validator,
 * AFTER the user had confirmed, phrased in terms of a constraint nobody had been
 * shown. From the user's chair the assistant simply could not create a lead.
 *
 * ── WHY THESE ASSERTIONS AND NOT A SNAPSHOT ─────────────────────────────────
 *
 * The invariant is a RELATIONSHIP between two artefacts that live in different
 * files — the module's Zod schema and the JSON Schema the model is handed — so
 * the test derives both and compares them. A snapshot would pin today's output
 * and pass forever afterwards, including on the day someone reintroduces the
 * flattening for a new field type.
 *
 * `create_lead` is exercised through the REAL manifest rather than a fixture,
 * because the whole failure was that the real one disagreed with itself.
 *
 * THE CATALOGUE-WIDE SWEEP — "every uuid-ish field in every shipped manifest
 * declares its format" — lives in `ai-readiness.test.js`, which already
 * requires every `*.ai.js` in the repo. Running it from here loaded that
 * ~1820-module set a second time, and under `--coverage` two workers doing
 * that concurrently hit the OOM killer on GitHub's runner. Same assertion,
 * one copy of the fixture.
 */
"use strict";

const { z } = require("zod");
const registrar = require("../../src/services/ai/action-registrar");
const leadValidator = require("../../src/modules/sales/lead/lead.validator");

describe("Zod → JSON Schema keeps the constraints the validator enforces", () => {
  test("string formats survive: uuid, email, url, datetime", () => {
    const js = registrar.zodToJsonSchema(
      z.object({
        owner_user_id: z.string().uuid(),
        email: z.string().email(),
        site: z.string().url(),
        when: z.string().datetime(),
      }),
    );
    expect(js.properties.owner_user_id).toMatchObject({ type: "string", format: "uuid" });
    expect(js.properties.email).toMatchObject({ type: "string", format: "email" });
    expect(js.properties.site).toMatchObject({ type: "string", format: "uri" });
    expect(js.properties.when).toMatchObject({ type: "string", format: "date-time" });
  });

  test("string length and regex survive", () => {
    const js = registrar.zodToJsonSchema(
      z.object({
        code: z.string().min(2).max(8),
        niu: z.string().regex(/^[A-Z]\d{12}$/),
        exact: z.string().length(4),
      }),
    );
    expect(js.properties.code).toMatchObject({ minLength: 2, maxLength: 8 });
    expect(js.properties.niu.pattern).toBe("^[A-Z]\\d{12}$");
    expect(js.properties.exact).toMatchObject({ minLength: 4, maxLength: 4 });
  });

  test("numeric bounds survive, and .int() becomes the integer TYPE", () => {
    const js = registrar.zodToJsonSchema(
      z.object({
        days: z.number().int().min(0).max(365),
        rate: z.number().positive(),
      }),
    );
    // `int` is a JSON Schema type, not a keyword — a model told "number"
    // will happily send 3.5 into a column that is an integer.
    expect(js.properties.days.type).toBe("integer");
    expect(js.properties.days).toMatchObject({ minimum: 0, maximum: 365 });
    // z.number().positive() is an EXCLUSIVE lower bound of 0, and the
    // distinction is load-bearing: 0 is a legal number and an illegal amount.
    expect(js.properties.rate.exclusiveMinimum).toBe(0);
  });

  test("constraints survive .optional(), .nullable() and .default()", () => {
    // The unwrap step is where a refinement is easiest to lose, and almost
    // every real field is wrapped in at least one of these.
    const js = registrar.zodToJsonSchema(
      z.object({
        a: z.string().uuid().optional(),
        b: z.string().email().nullable(),
        c: z.number().int().min(1).default(1),
      }),
    );
    expect(js.properties.a.format).toBe("uuid");
    expect(js.properties.b.format).toBe("email");
    expect(js.properties.c).toMatchObject({ type: "integer", minimum: 1 });
  });

  test("a native enum reaches the model as its members, not a bare string", () => {
    const Kind = { Air: "AIR", Sea: "SEA" };
    const js = registrar.zodToJsonSchema(z.object({ kind: z.nativeEnum(Kind) }));
    expect(js.properties.kind.enum.sort()).toEqual(["AIR", "SEA"]);
  });

  test("array bounds survive", () => {
    const js = registrar.zodToJsonSchema(
      z.object({ lines: z.array(z.object({ x: z.string() })).min(1).max(50) }),
    );
    expect(js.properties.lines).toMatchObject({ type: "array", minItems: 1, maxItems: 50 });
    expect(js.properties.lines.items.properties.x.type).toBe("string");
  });

  test("REGRESSION: the real create_lead contract now names its uuid fields", () => {
    // This exact schema is what the 16 Sep review reported as broken. Derived
    // from the shipping validator, not a copy of it.
    const js = registrar.zodToJsonSchema(leadValidator.schemas.create);
    expect(js.properties.owner_user_id.format).toBe("uuid");
    expect(js.properties.entity_id.format).toBe("uuid");
    expect(js.properties.email.format).toBe("email");
    expect(js.properties.company_name.minLength).toBe(1);
    expect(js.properties.payment_terms_days.type).toBe("integer");
    // The required set is unchanged — this fix adds fidelity, it does not make
    // previously-optional fields mandatory.
    expect(js.required).toEqual(["company_name"]);
  });
});
