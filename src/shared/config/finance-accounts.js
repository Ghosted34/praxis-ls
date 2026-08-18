/**
 * Default GL accounts for the posting services, read from tenant settings.
 *
 * WHY THIS EXISTS — TWO LIVE DEFECTS, NOT A REFACTOR.
 *
 * Six services carried `treasuryCoa = "521"` as a JS default parameter, and one
 * carried `interestCoa = "671"`. NEITHER ACCOUNT IS POSTABLE:
 *
 *   521  Banques locales     is_postable = false  (9000:77) — a 3-digit grouping
 *                            whose postable leaves are 5211 / 5212
 *   671  Intérêts des emprunts is_postable = false (9001) — a leaf with NO
 *                            children, so the flag is simply wrong
 *
 * `journal_line.account_code` is `REFERENCES chart_of_accounts(code)` (0220:56)
 * AND the `assert_line_valid()` trigger (0640:150) raises
 * `'account % is not postable (KB §23.3)'`. So every posting that fell through
 * to one of those defaults failed — not silently, but at the moment money moved.
 *
 * The defaults were reachable because each caller's validator marks the override
 * OPTIONAL (`treasury_coa: z.string().optional()`), and an absent field arrives
 * as `undefined`, which is exactly what triggers a JS default parameter. So the
 * broken value applied whenever the client did not name an account explicitly —
 * i.e. the normal case.
 *
 * TWO DIFFERENT FIXES, BECAUSE THEY ARE TWO DIFFERENT BUGS:
 *
 *   521 → the flag is CORRECT (it really is a grouping with children). The
 *         DEFAULT is wrong and must become a postable leaf: 5211.
 *   671 → the flag is WRONG (a childless leaf that should be postable). Seed
 *         9095 corrects `is_postable` rather than redirecting callers to some
 *         other account, because 671 is where loan interest belongs.
 *
 * WHY SETTINGS RATHER THAN A NEW CONSTANT. A hardcoded '5211' is the same class
 * of mistake as the '521' it replaces — it assumes every tenant numbers its
 * chart the way the seed does. These read `('finance','accounts')` so a tenant
 * that renumbers, or runs two banks, can say so without a code change. The JS
 * values below are last-resort fallbacks for an un-seeded tenant, and every one
 * of them is verified postable against the 9000/9001 seeds.
 */
"use strict";

const { getSetting } = require("./settings");
const { AppError } = require("../../utils/errors");

/**
 * Fallbacks. Each is a POSTABLE leaf in the seeded chart — that is the property
 * that was violated, so it is the property to preserve when editing this map.
 *
 *   grep -n "('5211'," migrations/seeds/9000_seed_coa.sql   → is_postable = true
 */
const FALLBACK = {
  treasury: "5211", // Banque principale (NOT 521 — see the header)
  cash: "571", // Caisse siège
  disbursement: "4731", // Mandants (requires_analytic → needs a dossier_id)
  customer: "4111", // Clients
  customer_advance: "4191", // Clients, avances et acomptes reçus
  supplier: "4011", // Fournisseurs
  loan: "162", // Emprunts auprès des établissements de crédit
  loan_interest: "671", // Intérêts des emprunts (made postable by seed 9095)
  fx_loss: "676", // Pertes de change
};

/**
 * The tenant's account map, merged over the fallbacks.
 *
 * One SELECT. Callers that need several accounts should call this once and read
 * fields off the result rather than calling `accountFor` repeatedly.
 */
async function financeAccounts(client) {
  const configured = await getSetting(client, "finance", "accounts", null);
  return { ...FALLBACK, ...(configured || {}) };
}

/**
 * One account by role, honouring an explicit override.
 *
 * `override` wins when the caller named an account — that is the existing
 * behaviour of every `treasuryCoa` parameter and it must not change; only the
 * value used when nothing is named is being corrected. `null` and `undefined`
 * both mean "not specified", because controllers pass `b.treasury_coa` straight
 * through and an absent JSON field is `undefined`.
 */
async function accountFor(client, role, override = null) {
  if (override !== null && override !== undefined && override !== "") return override;
  const accounts = await financeAccounts(client);
  const code = accounts[role];
  if (!code) {
    throw new AppError("NO_ACCOUNT", `No finance account configured for role "${role}"`, 500);
  }
  return code;
}

module.exports = { financeAccounts, accountFor, FALLBACK };
