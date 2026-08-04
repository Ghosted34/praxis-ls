"use strict";
/**
 * Field-level building blocks reused across domains.
 *
 * These exist so "what is a valid date" is answered once. The API had the same
 * `/^\d{4}-\d{2}-\d{2}$/` written out in several validators and the client had
 * no opinion at all, which is exactly the split the audit's F12 describes.
 */
const { z } = require("zod");

/** A UUID primary key. */
const uuid = z.string().uuid("Must be a valid id.");

/**
 * Calendar date, `YYYY-MM-DD`. The wire format the API uses everywhere.
 *
 * The round-trip check is the point: `new Date("2026-02-31")` does NOT return
 * NaN — JavaScript rolls it over to 3 March and reports success. A naive
 * `!Number.isNaN(...)` refinement therefore accepts every impossible date in the
 * calendar, which on an `entry_date` means a journal entry silently posting to
 * the wrong period. Formatting the parsed date back and comparing catches it.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "That date doesn't exist.");

/**
 * A required piece of text.
 *
 * `.trim()` before `.min(1)` on purpose: a field holding only spaces is empty
 * to a person, and the client used to send it happily because its `canSubmit`
 * boolean tested `value !== ""`.
 */
const requiredText = (label = "This field") => z.string().trim().min(1, `${label} is required.`);

/**
 * A money amount.
 *
 * Accepts a numeric STRING as well as a number, because form inputs produce
 * strings and coercing at the schema boundary is better than every call site
 * remembering to `Number()` first. Rejects NaN and Infinity explicitly — a
 * bare `z.number()` accepts both, and `Infinity` reaching a ledger is not a
 * theoretical concern.
 */
const amount = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : Number(String(v).replace(/\s/g, ""))))
  .refine((n) => Number.isFinite(n), "Enter a number.");

/** An amount that must be greater than zero (an invoice line, a payment). */
const positiveAmount = amount.refine((n) => n > 0, "Must be greater than zero.");

/** ISO-4217-ish currency code. Cameroon/OHADA defaults to XAF. */
const currency = z.string().trim().length(3, "Use a 3-letter currency code.").toUpperCase();

// Named `exports.x =` assignments, NOT `module.exports = { x }`.
//
// Both are identical to Node, so the API is unaffected — but the client is
// BUNDLED, and cjs-module-lexer (which esbuild and Rollup both use to discover
// a CommonJS module's named exports) cannot see through the object-literal
// form. With `module.exports = { … }` the bundlers found no named exports at
// all: `vite build` failed with `"finalInvoice" is not exported by
// packages/shared/index.js`, and in dev the import silently resolved to
// `undefined` — a form arrived at with no validation and a blank screen when
// zodResolver was handed it. See client/config/shared-alias.ts.
exports.uuid = uuid;
exports.isoDate = isoDate;
exports.requiredText = requiredText;
exports.amount = amount;
exports.positiveAmount = positiveAmount;
exports.currency = currency;
