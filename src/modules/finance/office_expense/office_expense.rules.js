/** Office expenses (MOD-77) — pure posting maths.
 *
 *  One shape only: Dr <expense account> / Cr <treasury or cash>. The expense
 *  account comes off the ROW (office_expense.expense_coa — see 13910's header
 *  for why it is per-row and not a category map), the credit side is resolved
 *  by the service via finance-accounts ('treasury' or 'cash' by pay method),
 *  so this helper carries NO account defaults at all — the class of bug the
 *  debt rules' '521'/'671' fallbacks caused cannot recur here.
 */
"use strict";
const { AppError } = require("../../../utils/errors");
const round2 = (n) => Math.round(n * 100) / 100;

function buildExpenseLines({ amount, expenseCoa, creditCoa }) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) throw new AppError("BAD_AMOUNT", "amount must be > 0", 422);
  if (!expenseCoa) throw new AppError("NO_EXPENSE_ACCOUNT", "the expense row names no expense account", 422);
  if (!creditCoa) throw new AppError("NO_CREDIT_ACCOUNT", "no treasury/cash account resolved", 422);
  return [
    { account_code: expenseCoa, debit: round2(a), credit: 0 },
    { account_code: creditCoa, debit: 0, credit: round2(a) },
  ];
}

module.exports = { buildExpenseLines };
