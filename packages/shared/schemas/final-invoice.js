"use strict";
/**
 * Final invoice payloads.
 *
 * Lifted VERBATIM in meaning from `src/modules/finance/final_invoice/
 * final_invoice.validator.js`, which is now the consumer rather than the owner.
 * This is the first domain moved because it is the one the audit names: F12
 * cites `features/finance/pages.tsx:141`'s `canSubmit` boolean as the client's
 * parallel, un-shared re-statement of these same rules.
 *
 * The only changes from the original are messages. The API's schema produced
 * Zod's defaults ("Invalid uuid"), which was acceptable when they were only
 * ever flattened into one banner. Now that the client renders them per FIELD
 * (see the Field `error` prop), they are read by an operator and need to say
 * something an operator can act on.
 */
const { z } = require("zod");
const { uuid, isoDate, requiredText, positiveAmount } = require("./common");

/**
 * AN INVOICE LINE IS qty × unit_price, NOT A LUMP (§2.2).
 *
 * This schema used to accept a single `amount`, and the service turned that
 * into `qty: 1, unit_price: amount`. So a caller holding "40 containers at
 * 2,000,000" had nowhere to put the 40: it pre-multiplied to 80,000,000 and the
 * invoice printed one unit at eighty million. That is invoice fb7db2f3 exactly
 * — three lines, every qty 1, every unit price an extended COST, and no VAT.
 *
 * `qty` and `unit_price` are the real shape (invoice_line has carried both
 * since 0230:85), and the extension is computed server-side rather than
 * trusted from the caller.
 *
 * `amount` is retained as a deprecated alias so existing callers and the AI
 * tool surface keep working; it means "one unit at this price" and nothing
 * else. Exactly one of the two forms must be present.
 *
 * `tax_code_id` was simply absent — the column exists (0230:88) and nothing
 * ever wrote it, which is the other half of why the invoice showed TVA 0.00.
 */
const line = z
  .object({
    dictionary_item_id: uuid,
    label: z.string().optional(),
    qty: z.number().positive().max(1e9).optional(),
    unit_price: positiveAmount.optional(),
    /** @deprecated use qty + unit_price. Treated as one unit at this price. */
    amount: positiveAmount.optional(),
    is_disbursement: z.boolean().optional(),
    tax_code_id: uuid.nullish(),
    // Which container type the charge was priced for (0663). NULL/absent is the
    // normal case — most of the catalogue has no equipment dimension at all.
    container_type_ref_id: uuid.nullish(),
  })
  .refine((l) => l.unit_price !== undefined || l.amount !== undefined, {
    message: "A line needs either unit_price (with qty) or the deprecated amount",
    path: ["unit_price"],
  })
  // The database refuses this pair outright — chk_disbursement_no_tax on
  // invoice_line (0230:92) and assert_line_valid() (0640:156). Caught here so
  // the caller gets a 422 naming the line instead of a 500 from a trigger.
  .refine((l) => !(l.is_disbursement === true && l.tax_code_id), {
    message: "A disbursement line may not carry a tax code — pass-through charges are never taxed (KB §23.5)",
    path: ["tax_code_id"],
  });

/**
 * §2.7 — billing something the accepted quotation does not cover.
 *
 * Deliberately releasable: a genuinely unquoted late charge is a real event,
 * and a control with no release valve gets routed around. The reason is stored
 * on the invoice and shown to whoever approves it.
 *
 * Releasing it is a DECISION, so the API gates this field's presence on
 * `approve` + the APPROVER authority while leaving the route itself on `edit` —
 * a pricer fixes a typo, an approver bills off-contract. The client should
 * therefore only offer this control to a user who holds both; a 403 here is the
 * gate working, not a bug.
 */
const pricingOverride = z.object({
  reason: z.string().trim().min(10, "Say why this is being billed off-quotation — the approver reads it").max(2000),
});

const createDraft = z.object({
  entity_id: uuid,
  client_id: uuid.optional(),
  dossier_id: uuid.optional(),
  lines: z.array(line).optional(),
  pricing_override: pricingOverride.optional(),
});

const updateDraft = z.object({
  client_id: uuid.optional(),
  dossier_id: uuid.optional(),
  lines: z.array(line).optional(),
  pricing_override: pricingOverride.optional(),
});

const submit = z.object({
  entry_date: isoDate,
  source_doc_ref: requiredText("Document reference"),
});

// AI-facing variants: the same payloads with the invoice identified in the body
// rather than the path, for the tool-calling surface.
const aiUpdate = updateDraft.extend({ invoice_id: uuid });
const aiSubmit = submit.extend({ invoice_id: uuid });

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
exports.line = line;
exports.pricingOverride = pricingOverride;
exports.createDraft = createDraft;
exports.updateDraft = updateDraft;
exports.submit = submit;
exports.aiUpdate = aiUpdate;
exports.aiSubmit = aiSubmit;
