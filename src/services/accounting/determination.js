/**
 * Account-determination engine (KB §22 flow + §8 cookbook).
 *
 * Turns a document's economic lines (each a dictionary_item + amount) into a
 * BALANCED set of journal lines, then (optionally) posts them through the ledger
 * engine (finance/journal_entry.service). Two contexts today:
 *
 *   sale     (final invoice, §8.3): per line -> credit revenue 706/707 (+ output
 *            VAT 4432 from the tax code); débours -> credit 4731, NO VAT; the
 *            counterpart 4111 is debited the full total (HT + VAT + débours).
 *   purchase (supplier invoice, §8.5): per line -> debit expense 6xx (+ recoverable
 *            input VAT 4452); the counterpart 4011 is credited the full TTC.
 *
 * `compute` is pure (no DB) and cent-accurate so it is unit-testable against the
 * KB worked numbers. `resolve` does the DB lookups (posting_rule + the tax_code
 * version effective at the entry date, KB §23.13) and hands the result to compute.
 * `postDocument` resolves then posts one validated entry via the ledger engine.
 * The final authority on balance is still the DB trigger in 0220_ledger.sql.
 */
"use strict";

const { AppError } = require("../../utils/errors");
const journalEntry = require("../../modules/finance/journal_entry/journal_entry.service");

const toCents = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError("INVALID_AMOUNT", "amount must be a non-negative number", 422);
  const c = Math.round(n * 100);
  if (Math.abs(n * 100 - c) > 1e-6) throw new AppError("INVALID_AMOUNT", "amount may have at most 2 decimals", 422);
  return c;
};
const major = (cents) => cents / 100;
const taxCents = (htCents, ratePercent) => Math.round((htCents * Number(ratePercent)) / 100);

function compute({ context, counterpartAccount, currency = "XAF", resolvedLines }) {
  if (context !== "sale" && context !== "purchase") {
    throw new AppError("BAD_CONTEXT", "context must be 'sale' or 'purchase'", 422);
  }
  if (!counterpartAccount) throw new AppError("NO_COUNTERPART", "counterpartAccount is required", 422);
  if (!Array.isArray(resolvedLines) || resolvedLines.length === 0) {
    throw new AppError("NO_LINES", "at least one line is required", 422);
  }

  const legs = [];
  let subtotalCents = 0;
  let taxTotalCents = 0;
  let disbursementCents = 0;

  const push = (account, side, cents, extra = {}) => {
    if (cents <= 0) return;
    legs.push({
      account_code: account,
      debit: side === "debit" ? major(cents) : 0,
      credit: side === "credit" ? major(cents) : 0,
      dossier_id: extra.dossierId || null,
      dictionary_item_id: extra.dictionaryItemId || null,
      is_disbursement: extra.isDisbursement === true,
      tax_code_id: extra.taxCodeId || null,
      currency,
    });
  };

  for (const ln of resolvedLines) {
    const htCents = toCents(ln.amount);
    if (htCents === 0) throw new AppError("ZERO_LINE", "a line amount must be > 0", 422);

    if (context === "sale") {
      if (ln.isDisbursement) {
        if (!ln.creditAccount) throw new AppError("NO_DISBURSEMENT_ACCOUNT", "débours line needs a credit account (e.g. 4731)", 422);
        push(ln.creditAccount, "credit", htCents, { dossierId: ln.dossierId, dictionaryItemId: ln.dictionaryItemId, isDisbursement: true });
        disbursementCents += htCents;
      } else {
        if (!ln.creditAccount) throw new AppError("NO_REVENUE_ACCOUNT", "service line needs a revenue account (706/707)", 422);
        push(ln.creditAccount, "credit", htCents, { dossierId: ln.dossierId, dictionaryItemId: ln.dictionaryItemId });
        subtotalCents += htCents;
        if (ln.taxRate) {
          if (!ln.taxCreditAccount) throw new AppError("NO_VAT_ACCOUNT", "taxed line needs an output-VAT account (4432)", 422);
          const t = taxCents(htCents, ln.taxRate);
          push(ln.taxCreditAccount, "credit", t, { taxCodeId: ln.taxCodeId });
          taxTotalCents += t;
        }
      }
    } else {
      if (!ln.debitAccount) throw new AppError("NO_EXPENSE_ACCOUNT", "purchase line needs an expense account (6xx)", 422);
      push(ln.debitAccount, "debit", htCents, { dossierId: ln.dossierId, dictionaryItemId: ln.dictionaryItemId });
      subtotalCents += htCents;
      if (ln.taxRate) {
        if (!ln.taxDebitAccount) throw new AppError("NO_VAT_ACCOUNT", "taxed purchase line needs an input-VAT account (4452)", 422);
        const t = taxCents(htCents, ln.taxRate);
        push(ln.taxDebitAccount, "debit", t, { taxCodeId: ln.taxCodeId });
        taxTotalCents += t;
      }
    }
  }

  const counterpartCents = subtotalCents + taxTotalCents + disbursementCents;
  if (context === "sale") {
    legs.unshift({ account_code: counterpartAccount, debit: major(counterpartCents), credit: 0, dossier_id: null, dictionary_item_id: null, is_disbursement: false, tax_code_id: null, currency });
  } else {
    legs.push({ account_code: counterpartAccount, debit: 0, credit: major(counterpartCents), dossier_id: null, dictionary_item_id: null, is_disbursement: false, tax_code_id: null, currency });
  }

  return {
    lines: legs,
    totals: {
      subtotal_ht: major(subtotalCents),
      tax_total: major(taxTotalCents),
      disbursement_total: major(disbursementCents),
      total: major(counterpartCents),
    },
  };
}

/** Resolve the tax_code version effective at `date` for the rule's tax code (#23.13). */
async function effectiveTax(client, taxCodeId, date) {
  const base = (await client.query("SELECT code, jurisdiction_id FROM tax_code WHERE tax_code_id = $1", [taxCodeId])).rows[0];
  if (!base) return null;
  const eff = (await client.query(
    "SELECT * FROM tax_code WHERE jurisdiction_id = $1 AND code = $2 AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $3) ORDER BY effective_from DESC LIMIT 1",
    [base.jurisdiction_id, base.code, date],
  )).rows[0];
  if (!eff) throw new AppError("NO_EFFECTIVE_TAX", "No tax_code " + base.code + " effective at " + date, 422);
  return eff;
}

/**
 * DB resolve: economic lines -> resolvedLines -> compute(). Each economic line is
 * { dictionary_item_id, amount, is_disbursement?, dossier_id? }.
 */
async function resolve(client, { context, counterpartAccount, entryDate, currency, lines }) {
  const resolvedLines = [];
  for (const ln of lines) {
    const rule = (await client.query(
      "SELECT * FROM posting_rule WHERE dictionary_item_id = $1 AND applies_context = $2 ORDER BY created_at ASC LIMIT 1",
      [ln.dictionary_item_id, context],
    )).rows[0];
    if (!rule) throw new AppError("NO_POSTING_RULE", "No posting_rule for item " + ln.dictionary_item_id + " (" + context + ")", 422);

    const item = (await client.query("SELECT is_disbursement FROM dictionary_item WHERE dictionary_item_id = $1", [ln.dictionary_item_id])).rows[0];
    const isDisbursement = typeof ln.is_disbursement === "boolean" ? ln.is_disbursement : (rule.is_disbursement || (item && item.is_disbursement) || false);

    let taxRate = null; let taxDebitAccount = null; let taxCreditAccount = null; let taxCodeId = null;
    if (rule.tax_code_id && !isDisbursement) {
      const eff = await effectiveTax(client, rule.tax_code_id, entryDate);
      if (eff) {
        taxRate = eff.rate_percent;
        taxDebitAccount = eff.posts_debit_account;
        taxCreditAccount = eff.posts_credit_account;
        taxCodeId = eff.tax_code_id;
      }
    }

    resolvedLines.push({
      amount: ln.amount,
      isDisbursement,
      debitAccount: rule.debit_account,
      creditAccount: rule.credit_account,
      taxRate,
      taxDebitAccount,
      taxCreditAccount,
      taxCodeId,
      dossierId: ln.dossier_id,
      dictionaryItemId: ln.dictionary_item_id,
    });
  }
  return compute({ context, counterpartAccount, currency, resolvedLines });
}

/**
 * Resolve + post one validated journal entry through the ledger engine. Used by
 * Phase-1 invoicing. Returns { entry, lines, totals }.
 */
async function postDocument(client, opts) {
  const { context, counterpartAccount, entryDate, journalCode, entityId, sourceDocRef, description, currency, lines, actor, ip } = opts;
  const determined = await resolve(client, { context, counterpartAccount, entryDate, currency, lines });
  const posted = await journalEntry.post(client, {
    journalCode,
    entityId,
    entryDate,
    description,
    sourceDocRef,
    source: "SYSTEM_RULE",
    lines: determined.lines,
    actor,
    ip,
  });
  return { ...posted, totals: determined.totals };
}

module.exports = { compute, toCents, resolve, postDocument, effectiveTax };
