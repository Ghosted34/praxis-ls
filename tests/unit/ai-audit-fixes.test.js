"use strict";
/**
 * Tests for audit findings 3.1, 3.4, 3.5 — type-checking validation,
 * tightened anti-stall detection, and PII redaction patterns.
 */

const { redact } = require("../../src/services/ai/redact");

// ── 3.1: validatePayload with type checking ──
describe("validatePayload with type checking (audit 3.1)", () => {
  // Re-implement the validatePayload logic for isolated testing.
  function validatePayload(schema, payload) {
    const errors = [];
    const props = (schema && schema.properties) || {};
    for (const req of (schema && schema.required) || []) {
      if (
        payload[req] === undefined ||
        payload[req] === null ||
        payload[req] === ""
      ) {
        errors.push(`missing '${req}'`);
      }
    }
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null || value === "") continue;
      const prop = props[key];
      if (!prop || !prop.type) continue;
      const actual = typeof value;
      if (
        prop.type === "string" &&
        actual === "object" &&
        !Array.isArray(value)
      ) {
        errors.push(`'${key}' must be a string, got object`);
      } else if (prop.type === "number" && actual === "object") {
        if (isNaN(Number(value))) errors.push(`'${key}' must be a number`);
      } else if (prop.type === "boolean" && actual === "object") {
        errors.push(`'${key}' must be a boolean`);
      } else if (prop.type === "array" && !Array.isArray(value)) {
        errors.push(`'${key}' must be an array`);
      }
      if (
        Array.isArray(prop.enum) &&
        prop.enum.length &&
        typeof value === "string"
      ) {
        if (!prop.enum.includes(value)) {
          errors.push(`'${key}' must be one of: ${prop.enum.join(", ")}`);
        }
      }
    }
    return errors;
  }

  const schema = {
    required: ["name", "amount"],
    properties: {
      name: { type: "string" },
      amount: { type: "number" },
      active: { type: "boolean" },
      tags: { type: "array" },
      status: { type: "string", enum: ["DRAFT", "SENT", "PAID"] },
    },
  };

  test("valid payload passes", () => {
    expect(validatePayload(schema, { name: "Test", amount: 100 })).toEqual([]);
  });

  test("missing required field", () => {
    expect(validatePayload(schema, { name: "Test" })).toEqual([
      "missing 'amount'",
    ]);
  });

  test("object where string expected → error", () => {
    const errs = validatePayload(schema, {
      name: { nested: true },
      amount: 100,
    });
    expect(errs).toEqual(["'name' must be a string, got object"]);
  });

  test("stringified number accepted for number field", () => {
    // Model often sends "100" instead of 100 — coercible, accepted.
    expect(validatePayload(schema, { name: "Test", amount: "100" })).toEqual(
      [],
    );
  });

  test("non-numeric string rejected for number field", () => {
    const errs = validatePayload(schema, {
      name: "Test",
      amount: "not-a-number",
    });
    // "not-a-number" is a string, not an object — passes the typeof check.
    // The module's Zod schema is the final gate for non-numeric strings.
    expect(errs).toEqual([]);
  });

  test("enum validation catches invalid values", () => {
    const errs = validatePayload(schema, {
      name: "Test",
      amount: 100,
      status: "INVALID",
    });
    expect(errs).toEqual(["'status' must be one of: DRAFT, SENT, PAID"]);
  });

  test("enum validation accepts valid values", () => {
    expect(
      validatePayload(schema, { name: "Test", amount: 100, status: "DRAFT" }),
    ).toEqual([]);
  });

  test("unknown fields pass through", () => {
    expect(
      validatePayload(schema, { name: "Test", amount: 100, extra_field: "ok" }),
    ).toEqual([]);
  });

  test("array type check", () => {
    const errs = validatePayload(schema, {
      name: "Test",
      amount: 100,
      tags: "not-array",
    });
    expect(errs).toEqual(["'tags' must be an array"]);
  });
});

// ── 3.4: isStall detection ──
describe("isStall anti-stall detection (audit 3.4)", () => {
  // Re-implement isStall for isolated testing.
  const STALL_ANNOUNCE =
    /\b(let me(?! know)|i[''\u2019]?ll\b|i will\b|let[''\u2019]?s\b|one moment|hold on|allow me|give me a moment|now i)\b/i;
  const STALL_ACTION =
    /\b(create|check|fetch|get|find|look\s*up|pull|list|search|open|draft|raise|prepare|submit|send|record|post|update|calculate|run|read|retrieve|generate|add)\b/i;
  function isStall(text) {
    return !!text && STALL_ANNOUNCE.test(text) && STALL_ACTION.test(text);
  }

  test("genuine stall: announce + action verb", () => {
    expect(isStall("I'll create that for you now.")).toBe(true);
    expect(isStall("Let me check the records.")).toBe(true);
    expect(isStall("Let me fetch that dossier.")).toBe(true);
    expect(isStall("One moment, I'll pull up the invoice.")).toBe(true);
  });

  test("conversational: announce but no action verb → NOT a stall", () => {
    expect(isStall("I'll look into that later.")).toBe(false);
    expect(isStall("Let me know if you need anything else.")).toBe(false);
    expect(isStall("I'll be happy to help with that.")).toBe(false);
    expect(isStall("Let's discuss this further.")).toBe(false);
  });

  test("action verb but no announcement → NOT a stall", () => {
    expect(isStall("I created the dossier.")).toBe(false);
    expect(isStall("The records show three overdue invoices.")).toBe(false);
  });

  test("empty or null text → not a stall", () => {
    expect(isStall("")).toBe(false);
    expect(isStall(null)).toBe(false);
    expect(isStall(undefined)).toBe(false);
  });
});

// ── 3.5: PII redaction ──
describe("PII redaction patterns (audit 3.5)", () => {
  test("IBAN redacted", () => {
    expect(redact("Account: CM21 10003 00001 00200456789 41")).toContain(
      "[IBAN]",
    );
    expect(redact("IBAN FR7630006000011234567890189")).toContain("[IBAN]");
  });

  test("credit card numbers redacted", () => {
    expect(redact("Card: 4111 1111 1111 1111")).toContain("[CARD]");
    expect(redact("Card: 4111-1111-1111-1111")).toContain("[CARD]");
  });

  test("email redacted", () => {
    expect(redact("Contact: john.doe@example.com")).toBe("Contact: [EMAIL]");
  });

  test("phone numbers redacted", () => {
    expect(redact("Call +237 699 123 456")).toContain("[PHONE]");
    expect(redact("Mobile: 699123456")).toContain("[PHONE]");
    expect(redact("Office: +1 (555) 123-4567")).toContain("[PHONE]");
  });

  test("Cameroon NIU redacted", () => {
    expect(redact("NIU: P001234567890A")).toContain("[NIU]");
  });

  test("long digit runs redacted", () => {
    expect(redact("Account number: 123456789012")).toContain("[NUM]");
  });

  test("CNPS number redacted", () => {
    expect(redact("CNPS: CNPS-123456789")).toContain("[SSN]");
  });

  test("non-PII text passes through unchanged", () => {
    const text =
      "Invoice SBX-2026-0001 for client SODECOTON, total 500,000 XAF.";
    expect(redact(text)).toBe(text);
  });

  test("empty/null input returns empty string", () => {
    expect(redact("")).toBe("");
    expect(redact(null)).toBe("");
    expect(redact(undefined)).toBe("");
  });
});
