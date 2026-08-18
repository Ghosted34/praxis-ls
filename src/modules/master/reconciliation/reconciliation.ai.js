/**
 * AI manifest (MOD-09 reconciliation).
 *
 * READ WHAT IS AND IS NOT HERE.
 *
 * The AI can look at a reconciliation, run the matcher, and build the period's
 * etat de rapprochement. It CANNOT confirm a match, cannot approve a
 * reconciliation, and cannot attest a cash count — those are the three acts
 * that carry accounting consequence, and each of them names a responsible human
 * in a database column. An action whose whole meaning is "a person took
 * responsibility for this" cannot be delegated to a model without becoming a
 * lie about who did.
 *
 * `run_matcher` is exposed with auto_confirm forced OFF: the assistant may do
 * the tedious part — sweep the statement and rank candidates — and leave every
 * pairing in the queue for a person. Even that is confirm-gated as an action
 * card, per doc/BUILD_CONVENTIONS.md §4.
 */
"use strict";

const service = require("./reconciliation.service");
const validator = require("./reconciliation.validator");

module.exports = {
  entity: "reconciliation",
  module_key: "MOD-09",
  screens: [],
  reads: [
    {
      key: "list_bank_statements",
      service: (c, p) => service.listStatements(c, p || {}),
      permission: { module: "MOD-09", action: "view" },
      describe: "List imported bank / mobile-money statements for a treasury account.",
    },
    {
      key: "get_bank_statement",
      service: (c, p) => service.getStatement(c, p.statement_id, p),
      permission: { module: "MOD-09", action: "view" },
      describe: "Get one statement with its lines and their match status.",
    },
    {
      key: "list_reconciliations",
      service: (c, p) => service.listReconciliations(c, p || {}),
      permission: { module: "MOD-09", action: "view" },
      describe: "List reconciliation statements (etats de rapprochement) for a treasury account.",
    },
    {
      key: "list_cash_counts",
      service: (c, p) => service.listCashCounts(c, p || {}),
      permission: { module: "MOD-09", action: "view" },
      describe: "List physical cash counts for a cash or petty-cash account.",
    },
  ],
  writes: [
    {
      key: "run_reconciliation_matcher",
      // auto_confirm is pinned false regardless of what the caller passes: an
      // assistant may propose pairings, never accept its own.
      service: (c, p) => service.runMatcher(c, {
        statementId: p.statement_id,
        options: { near_days: p.near_days, far_days: p.far_days, auto_confirm: false },
      }),
      schema: validator.schemas.aiRunMatcher,
      permission: { module: "MOD-09", action: "create" },
      confirm: true,
      describe: "Sweep a statement against the ledger and queue candidate matches for a human to confirm.",
    },
    {
      key: "build_reconciliation",
      service: (c, p) => service.buildReconciliation(c, {
        treasuryAccountId: p.treasury_account_id,
        periodStart: p.period_start,
        periodEnd: p.period_end,
      }),
      schema: validator.schemas.aiBuildReconciliation,
      permission: { module: "MOD-09", action: "create" },
      confirm: true,
      describe: "Draft the etat de rapprochement for a treasury account and period. Does not approve it.",
    },
  ],
};
