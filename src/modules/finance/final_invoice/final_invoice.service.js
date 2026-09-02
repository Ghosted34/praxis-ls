/**
 * Final invoice (MOD-51, KB §8.3) — full document lifecycle per
 * doc/BUILD_CONVENTIONS.md. All SQL is in final_invoice.repo; this service
 * orchestrates the transaction, the ledger post, numbering and document capture.
 *
 *   createDraft → updateDraft (while DRAFT) → submit (opens approval chain) →
 *   post (numbers, posts revenue+débours+VAT, clears advance, captures the doc).
 * Registered with the approval dispatcher so a cleared chain posts automatically.
 */
"use strict";

const repo = require("./final_invoice.repo");
const events = require("./final_invoice.events");
const { reconcileAgainstQuotation } = require("./final_invoice.rules");
const { getRule } = require("../../../shared/config/settings");
const journalEntry = require("../journal_entry/journal_entry.service");
const determination = require("../../../services/accounting/determination");
const { applyAdvances } = require("../../../services/accounting/invoicing.rules");
const numbering = require("../../../services/documents/numbering.service");
const documents = require("../../../services/documents/document.service");
const executor = require("../../../services/workflow/executor");
const onApproved = require("../../../services/workflow/on-approved");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { withMoneyLog } = require("../../../shared/observability/money-log");

const ref = (id) => "invoice:" + id;

const round2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * §2.7 — THE PRICING GUARD. Lines may not be invented at the invoice.
 *
 * `updateDraft` took whatever lines a caller sent, at whatever prices. That is
 * the hole through which costing COST figures reached invoice fb7db2f3, and it
 * is open to the AI tool surface (`update_final_invoice`) on the same terms.
 * Fixing the qty/price mangling (§2.2) does not close it: the numbers arrive
 * intact and still wrong.
 *
 * Policy is a tenant setting, because "must every charge be quoted first" is a
 * commercial rule, not a constant — some tenants bill ad-hoc work routinely:
 *
 *   QUOTATION_WHEN_PRESENT  (default) enforce when the dossier HAS an accepted
 *                           quotation; allow free billing when it has none.
 *                           Catches the real defect without blocking ad-hoc
 *                           invoices, which is why it is the default rather
 *                           than the strict mode.
 *   QUOTATION_REQUIRED      additionally refuse to bill a dossier with no
 *                           accepted quotation at all.
 *   FREE                    no check — the pre-existing behaviour, kept as an
 *                           explicit opt-out rather than a silent default.
 *
 * THE OVERRIDE is deliberately allowed, deliberately loud, and gated. A late
 * charge that genuinely was not quoted is a real business event, and a control
 * that cannot be released gets worked around (someone bills a second dossier).
 * So a caller may pass `pricing_override: { reason }`, which is stored on the
 * invoice, written to the audit trail, and shown to whoever approves. A reason
 * under 10 characters is not a reason.
 *
 * WHO may release it is decided at the edge, not here: the routes gate the
 * field's PRESENCE on `approve` + the APPROVER authority
 * (routes.js OVERRIDE_GATE) while the route itself stays on `edit`, so a
 * pricer can still fix a typo but only an approver can bill off-contract. The
 * AI surface refuses the field outright — it carries one flat permission and no
 * capability layer, so it cannot express that pairing (final_invoice.ai.js).
 *
 * This service therefore treats an override as already-authorised. It is the
 * last line, not the gate: a new caller that reaches `updateDraft` without
 * passing through one of those two doors would inherit the old hole, so keep
 * new entry points gated the same way.
 */
const PRICING_MODES = new Set(["QUOTATION_WHEN_PRESENT", "QUOTATION_REQUIRED", "FREE"]);

async function pricingPolicy(client) {
  const mode = String(await getRule(client, "finance", "invoice_pricing", "source", "QUOTATION_WHEN_PRESENT"))
    .toUpperCase().trim();
  return {
    mode: PRICING_MODES.has(mode) ? mode : "QUOTATION_WHEN_PRESENT",
    tolerance: Number(await getRule(client, "finance", "invoice_pricing", "unit_price_tolerance", 0.01)),
  };
}

/**
 * Returns the override reason to persist (or null). Throws 422 listing every
 * violation — all of them, not the first: a pricer fixing one line at a time
 * against a silent endpoint is how an afternoon disappears.
 */
async function assertPricedSource(client, { invoice, dossierId, lines, override = null, actor = {} }) {
  const policy = await pricingPolicy(client);
  if (policy.mode === "FREE" || !Array.isArray(lines) || !lines.length) return null;

  const dossier = dossierId || (invoice && invoice.dossier_id) || null;
  const quotation = await repo.acceptedQuotationFor(client, dossier);

  const reason = override && String(override.reason || "").trim();
  const overriding = Boolean(reason);
  if (overriding && reason.length < 10) {
    throw new AppError("OVERRIDE_REASON_REQUIRED", "Billing off-quotation needs a written reason of at least 10 characters — it is shown to whoever approves the invoice", 422);
  }

  if (!quotation) {
    if (policy.mode === "QUOTATION_REQUIRED" && !overriding) {
      throw new AppError(
        "NO_ACCEPTED_QUOTATION",
        "This operations file has no accepted quotation, and the tenant requires one before a charge can be billed. Quote and have it accepted first, or supply pricing_override.reason.",
        422,
      );
    }
    return overriding ? reason : null;
  }

  if (overriding) {
    await audit(client, {
      actorUserId: actor.user_id || null, action: "final_invoice.pricing_override", moduleKey: events.MODULE,
      entityRef: invoice ? ref(invoice.invoice_id) : "invoice:new",
      after: { quotation_id: quotation.quotation_id, doc_number: quotation.doc_number, reason },
    });
    return reason;
  }

  const quoted = await repo.quotationLinesFor(client, quotation.quotation_id);
  const { ok, violations } = reconcileAgainstQuotation(lines, quoted, { tolerance: policy.tolerance });
  if (!ok) {
    throw new AppError(
      "NOT_PRICED_BY_QUOTATION",
      `These lines do not match the accepted quotation ${quotation.doc_number || quotation.quotation_id}: ` +
        violations.map((v) => v.message).join("; ") +
        ". Correct the lines, re-quote, or supply pricing_override.reason.",
      422,
      { quotation_id: quotation.quotation_id, doc_number: quotation.doc_number, violations },
    );
  }
  return null;
}

/**
 * §2.2 — qty and unit price are preserved, and the extension is OURS.
 *
 * This used to hardcode `qty: 1` and write the caller's `amount` into
 * `unit_price`, discarding any real quantity. An invoice built from a costing
 * of "40 × 2,000,000" therefore printed ONE unit at 80,000,000 — the extended
 * cost masquerading as a unit price (invoice fb7db2f3). `invoice_line.qty` has
 * existed since 0230:85; nothing was ever putting anything in it.
 *
 * `line_ht` is now computed here rather than taken from the payload. A caller
 * that can state the total independently of qty × price is a caller that can
 * state a total which does not equal qty × price, and the printed document
 * would then contradict its own arithmetic.
 *
 * `tax_code_id` is persisted (0230:88). Dropping it was the other half of the
 * TVA 0.00 on that invoice: `determination.resolve` (:143) only taxes a line
 * whose rule names a tax code and which is not a disbursement.
 */
async function replaceLines(client, invoiceId, lines) {
  await repo.deleteLines(client, invoiceId);
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    // The deprecated `amount` form means one unit at that price.
    const qty = ln.unit_price !== undefined ? Number(ln.qty ?? 1) : 1;
    const unitPrice = ln.unit_price !== undefined ? Number(ln.unit_price) : Number(ln.amount);
    const isDisbursement = ln.is_disbursement === true;
    await repo.insertLine(client, {
      invoice_id: invoiceId, dictionary_item_id: ln.dictionary_item_id,
      label: ln.label || "Line", qty, unit_price: unitPrice, is_disbursement: isDisbursement,
      // Never on a disbursement: the DB CHECK and the ledger trigger both
      // refuse that pair, and a 422 from the schema is the first line of
      // defence — this is the second, for callers that bypass it.
      tax_code_id: isDisbursement ? null : ln.tax_code_id || null,
      // Which box this charge was for (0663). NULL for anything with no
      // equipment dimension, and for every line invoiced before it shipped.
      container_type_ref_id: ln.container_type_ref_id || null,
      line_ht: round2(qty * unitPrice), line_no: i + 1,
    });
  }
}

const econLinesFrom = (lineRows, dossierId) =>
  lineRows.map((l) => ({ dictionary_item_id: l.dictionary_item_id, amount: Number(l.line_ht), is_disbursement: l.is_disbursement, dossier_id: dossierId }));

/** Insert a DRAFT invoice. TX-AGNOSTIC: assumes the caller's transaction context
 *  (so it can run inside a costing-approval tx OR standalone). */
async function createDraftCore(client, opts) {
  const { entityId, clientId = null, dossierId = null, lines = [], actor = {}, pricingOverride = null } = opts;
  // §2.7 — check BEFORE the row exists: a refused invoice should leave nothing
  // behind. The quotation-conversion path passes lines lifted straight off the
  // quotation, so it reconciles against itself and sails through.
  const overrideReason = await assertPricedSource(client, { invoice: null, dossierId, lines, override: pricingOverride, actor });
  const invoice = await repo.insertInvoice(client, {
    entity_id: entityId, client_id: clientId, dossier_id: dossierId, type: "FINAL",
    status: "DRAFT", issued_by: await resolveActorId(client, actor.user_id),
    pricing_override_reason: overrideReason,
  });
  if (lines.length) await replaceLines(client, invoice.invoice_id, lines);
  await audit(client, { actorUserId: actor.user_id || null, action: events.DRAFTED, moduleKey: events.MODULE, entityRef: ref(invoice.invoice_id), after: invoice });
  return get(client, invoice.invoice_id);
}

async function createDraft(client, opts) {
  await client.query("BEGIN");
  try {
    const r = await createDraftCore(client, opts);
    await client.query("COMMIT");
    return r;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Idempotently open a DRAFT invoice shell for a dossier's approved costing.
 * Shared by BOTH the synchronous costing-approval handoff (A7 #3) and the async
 * orchestration backstop handler — so they can never diverge or double-create.
 * TX-agnostic; skips if a FINAL invoice already exists for the dossier.
 */
async function ensureDraftForCosting(client, costingId) {
  if (!costingId) return { skipped: "no costing id" };
  const { rows } = await client.query(
    "SELECT c.dossier_id, d.entity_id, d.client_id " +
      "FROM costing c JOIN dossier d ON d.dossier_id = c.dossier_id WHERE c.costing_id = $1",
    [costingId],
  );
  const r = rows[0];
  if (!r || !r.dossier_id) return { skipped: "costing has no dossier" };
  if (!r.entity_id) return { skipped: "dossier has no entity" };
  const exists = await client.query("SELECT 1 FROM invoice WHERE dossier_id = $1 AND type = 'FINAL' LIMIT 1", [r.dossier_id]);
  if (exists.rows.length) return { skipped: "final invoice already exists for dossier" };
  const inv = await createDraftCore(client, { entityId: r.entity_id, clientId: r.client_id, dossierId: r.dossier_id, actor: { user_id: null } });
  return { created: true, invoice_id: inv.invoice_id };
}

async function updateDraft(client, { invoiceId, patch = {}, lines = null, actor = {}, pricingOverride = null }) {
  const inv = await repo.getInvoice(client, invoiceId);
  if (!inv) throw new AppError("NOT_FOUND", "Invoice not found", 404);
  if (inv.status !== "DRAFT") throw new AppError("LOCKED", "Only a DRAFT invoice can be edited (post a reversal instead)", 422);
  // §2.7 — the hole this closes. Checked against the dossier the lines will
  // END UP on, not the one they came from: a patch may move the invoice and
  // its lines in the same call, and validating the old dossier's quotation
  // would check the lines against an offer they no longer belong to.
  const overrideReason = Array.isArray(lines)
    ? await assertPricedSource(client, {
        invoice: inv,
        dossierId: patch.dossier_id !== undefined ? patch.dossier_id : inv.dossier_id,
        lines, override: pricingOverride, actor,
      })
    : null;
  await client.query("BEGIN");
  try {
    const fields = {};
    for (const k of ["client_id", "dossier_id"]) if (patch[k] !== undefined) fields[k] = patch[k];
    // Only ever set on a call that actually re-stated the lines; a later patch
    // that touches nothing else must not silently clear the recorded reason.
    if (Array.isArray(lines)) fields.pricing_override_reason = overrideReason;
    if (Object.keys(fields).length) await repo.updateInvoice(client, invoiceId, fields);
    if (Array.isArray(lines)) await replaceLines(client, invoiceId, lines);
    await client.query("COMMIT");
    return get(client, invoiceId);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function submit(client, { invoiceId, entryDate, sourceDocRef, actor = {}, ip = null }) {
  const inv = await repo.getInvoice(client, invoiceId);
  if (!inv) throw new AppError("NOT_FOUND", "Invoice not found", 404);
  if (inv.status !== "DRAFT") throw new AppError("BAD_STATE", "Only a DRAFT invoice can be submitted", 422);
  const lineRows = await repo.listLines(client, invoiceId);
  if (lineRows.length === 0) throw new AppError("NO_LINES", "Invoice has no lines", 422);
  const econLines = econLinesFrom(lineRows, inv.dossier_id);

  await client.query("BEGIN");
  try {
    await repo.updateInvoice(client, invoiceId, { status: "SUBMITTED_FOR_APPROVAL" });
    const determined = await determination.resolve(client, { context: "sale", counterpartAccount: "4111", entryDate, lines: econLines });
    const started = await executor.start(client, { eventTypeKey: events.ISSUED, entityRef: ref(invoiceId), amountXaf: determined.totals.total });
    await emitEvent(client, { eventTypeKey: events.ISSUED, moduleKey: events.MODULE, entityRef: ref(invoiceId), actorUserId: actor.user_id || null });
    let posted = null;
    if (started.autoApproved) posted = await postCore(client, { invoice: inv, econLines, entryDate, sourceDocRef, actor, ip });
    await client.query("COMMIT");
    return { invoice: await get(client, invoiceId), approval: started, posted };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/** Post to GL + number + capture. Assumes an OPEN transaction. */
async function postCore(client, { invoice, econLines, entryDate, sourceDocRef, actor = {}, ip = null }) {
  const determined = await determination.resolve(client, { context: "sale", counterpartAccount: "4111", entryDate, lines: econLines });
  const saleEntry = await journalEntry.buildAndInsert(client, {
    journalCode: "VT", entityId: invoice.entity_id, entryDate,
    description: "Final invoice", sourceDocRef, source: "SYSTEM_RULE",
    lines: determined.lines, validate: true, actor, ip,
  });
  const { number } = await numbering.allocate(client, { moduleKey: events.MODULE, entityId: invoice.entity_id, date: entryDate });

  const advances = await repo.openAdvances(client, { clientId: invoice.client_id, dossierId: invoice.dossier_id });
  const advanceApplied = applyAdvances(determined.totals.total, advances);
  if (advanceApplied.applied_total > 0) {
    await journalEntry.buildAndInsert(client, {
      journalCode: "OD", entityId: invoice.entity_id, entryDate,
      description: "Apply customer advance to invoice", sourceDocRef, source: "SYSTEM_RULE",
      lines: [
        { account_code: "4191", debit: advanceApplied.applied_total, credit: 0, dossier_id: invoice.dossier_id },
        { account_code: "4111", debit: 0, credit: advanceApplied.applied_total, dossier_id: invoice.dossier_id },
      ],
      validate: true, actor, ip,
    });
    for (const alloc of advanceApplied.allocations) {
       
      await repo.addAdvanceApplied(client, alloc.advance_id, alloc.amount);
    }
  }

  const updated = await repo.updateInvoice(client, invoice.invoice_id, {
    status: "POSTED_LOCKED", doc_number: number, entry_id: saleEntry.entry.entry_id,
    service_ht: determined.totals.subtotal_ht, disbursement_total: determined.totals.disbursement_total,
    vat_total: determined.totals.tax_total, total_ttc: determined.totals.total,
  });
  await documents.capture(client, { entityRef: ref(invoice.invoice_id), docType: "FINAL_INVOICE", status: "VERIFIED" });
  await emitEvent(client, { eventTypeKey: events.POSTED, moduleKey: events.MODULE, entityRef: ref(invoice.invoice_id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.POSTED, moduleKey: events.MODULE, entityRef: ref(invoice.invoice_id), after: { doc_number: number, totals: determined.totals, advanceApplied }, ip });
  return { invoice: updated, entry: saleEntry.entry, doc_number: number, totals: determined.totals, advance_applied: advanceApplied };
}

/** Dispatcher entry point: post an approved invoice by id (in the acting txn). */
/**
 * OBS L2. Issuing an invoice is the single most-asked-about event in the product and it wrote nothing to the log. `postApproved` returns null when the invoice is already POSTED_LOCKED, so a duplicate post is now visible as an ok event with a null entry_id rather than as nothing at all.
 */
async function postApproved(client, opts) {
  const { id } = opts;
  return withMoneyLog(
    "invoice.posted",
    (out) => ({ doc: id, invoice_id: id, entry_id: out && out.entry ? out.entry.entry_id : null, total_ttc: out && out.invoice ? out.invoice.total_ttc : null, doc_number: out && out.invoice ? out.invoice.doc_number : null }),
    () => postApprovedCore(client, opts),
  );
}

async function postApprovedCore(client, { id, actor = {} }) {
  const invoice = await repo.getInvoice(client, id);
  if (!invoice || invoice.status === "POSTED_LOCKED") return null;
  const lineRows = await repo.listLines(client, id);
  const entryDate = new Date().toISOString().slice(0, 10);
  return postCore(client, { invoice, econLines: econLinesFrom(lineRows, invoice.dossier_id), entryDate, sourceDocRef: "approval:" + id, actor });
}

/**
 * One page of invoices plus the total matching the filter, for the HTTP layer
 * to surface as `X-Total-Count`.
 */
const listPaged = (client, q) => repo.listInvoices(client, q);

/**
 * Bare array of invoices. Kept as-is for the AI tool registry, which describes
 * `list` as returning a list and would otherwise start handing the model a
 * `{rows, total}` envelope it has no schema for.
 */
const list = async (client, q) => (await repo.listInvoices(client, q)).rows;

async function get(client, id) {
  const invoice = await repo.getInvoice(client, id);
  if (!invoice) return null;
  invoice.lines = await repo.listLines(client, id);
  return invoice;
}

onApproved.register("invoice", (client, { id, actor }) => postApproved(client, { id, actor }));

/**
 * Read-only VAT/total preview for a DRAFT invoice. Runs determination WITHOUT
 * posting so the UI can show HT / disbursement / TVA / TTC (and any customer advance
 * that will net) before the user records the invoice.
 */
async function previewTotals(client, { invoiceId, entryDate = null }) {
  const inv = await repo.getInvoice(client, invoiceId);
  if (!inv) throw new AppError("NOT_FOUND", "Invoice not found", 404);
  const lineRows = await repo.listLines(client, invoiceId);
  const at = entryDate || new Date().toISOString().slice(0, 10);
  const econLines = econLinesFrom(lineRows, inv.dossier_id);
  const determined = econLines.length
    ? await determination.resolve(client, { context: "sale", counterpartAccount: "4111", entryDate: at, lines: econLines })
    : { totals: { subtotal_ht: 0, disbursement_total: 0, tax_total: 0, total: 0 } };
  const advances = await repo.openAdvances(client, { clientId: inv.client_id, dossierId: inv.dossier_id });
  const advanceOpen = (advances || []).reduce((acc, a) => acc + (Number(a.amount || 0) - Number(a.applied_amount || 0)), 0);
  return { totals: determined.totals, advance_open: advanceOpen, line_count: lineRows.length };
}

module.exports = { createDraft, createDraftCore, ensureDraftForCosting, updateDraft, submit, postApproved, previewTotals, list, listPaged, get };
