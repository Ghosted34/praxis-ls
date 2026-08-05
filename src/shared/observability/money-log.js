/**
 * Structured logging for the paths where money moves.
 *
 * Audit OBS-L2 (Critical) and the unresolved half of OBS-T1 (Critical).
 *
 * THE FINDING
 *
 * There were ZERO `logger.*` calls across all of `src/modules/finance/**`
 * (journal_entry, final_invoice, credit_note, debt, smart_receivables,
 * tax_declaration, financial_statement, asset, proforma) and all of
 * `src/services/accounting/**`. A journal posting, an invoice issuance, a credit
 * note, a tax declaration — none emitted a single line. For an OHADA-accounting
 * ERP, the paths where silent failure is most expensive were precisely the paths
 * with no logging.
 *
 * OBS-T1 walked the consequence: a user reports "posting an invoice failed this
 * morning" and step 4 of the investigation — "see how far the posting got" — has
 * no answer at all. Steps 1, 2, 3 and 6 were closed by the access log, the
 * correlation id, the tenant on every line, and log retention. Step 4 is this
 * file. Step 5 (join a ledger row back to the request that wrote it) is the
 * `request_id` column added in migration 0501.
 *
 * WHY A HELPER RATHER THAN logger.info AT EACH SITE
 *
 * A money event is only useful if you can query it. Free-form `logger.info("posted
 * invoice")` at forty sites gives forty shapes and answers no question in
 * aggregate. Every event here carries the same keys — `money_event`, `doc`,
 * `amount`, `currency`, `outcome` — so "show me every failed posting for this
 * tenant today" is one filter rather than a grep.
 *
 * Tenant, user and request_id are NOT passed in: `config/logger.js` already
 * mixes them in from the AsyncLocalStorage request context (OBS-L3). Passing
 * them again would be a second source of truth that can disagree.
 *
 * AMOUNTS ARE LOGGED, IDENTIFIERS ARE LOGGED, PARTIES ARE NOT
 *
 * A total and a document number are what you need to reconcile an incident
 * against the books. A client name or an email is not, and it turns the log
 * into a data-protection surface — OBS-L4 is a live finding about exactly that.
 * Ids only.
 */

"use strict";

const { logger } = require("../../config/logger");

/** Numbers in logs must be numbers, not "1234.00" strings from pg numeric. */
const amt = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Record that a money operation succeeded.
 *
 * @param {string} event  dotted name, e.g. "invoice.posted", "entry.reversed"
 * @param {object} fields { doc, amount, currency, entry_id, ... } — ids and
 *                        figures only
 */
function moneyOk(event, fields = {}) {
  logger.info({ money_event: event, outcome: "ok", ...normalise(fields) }, event);
}

/**
 * Record that a money operation failed, and why.
 *
 * Logged at `error` deliberately: a refused posting is not routine. The three
 * things an accountant will ask are which document, how much, and what stopped
 * it, so all three are on the line.
 */
function moneyFail(event, err, fields = {}) {
  logger.error(
    {
      money_event: event,
      outcome: "failed",
      err_code: (err && (err.code || err.name)) || null,
      err: err && err.message,
      ...normalise(fields),
    },
    `${event} failed`,
  );
}

/**
 * Wrap an operation so it logs whichever way it goes, and rethrows unchanged.
 *
 * The rethrow matters: this is observability, and observability that alters
 * control flow is a bug generator. `fields` may be a function so the caller can
 * name figures that only exist once the work is done.
 */
async function withMoneyLog(event, fields, fn) {
  const started = Date.now();
  try {
    const out = await fn();
    const f = typeof fields === "function" ? fields(out) : fields;
    moneyOk(event, { ...f, ms: Date.now() - started });
    return out;
  } catch (err) {
    const f = typeof fields === "function" ? fields(null) : fields;
    moneyFail(event, err, { ...f, ms: Date.now() - started });
    throw err;
  }
}

function normalise(f) {
  const out = { ...f };
  for (const k of ["amount", "debit", "credit", "total", "total_ttc", "balance"]) {
    if (k in out) out[k] = amt(out[k]);
  }
  return out;
}

module.exports = { moneyOk, moneyFail, withMoneyLog };
