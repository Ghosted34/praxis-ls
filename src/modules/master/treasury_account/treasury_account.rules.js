/**
 * Treasury account (MOD-09) — pure rules.
 *
 * A treasury account belongs to ONE treasury_category. The category carries
 * the class-5 CoA parent the account's leaf hangs off, and three capability
 * flags that drive both the create form and these rules:
 *
 *   requires_custodian  → custodian_user_id is mandatory (petty cash)
 *   is_bank_identity    → the create form asks for IBAN/SWIFT/bank/branch
 *   is_momo_identity    → the create form asks for momo_number/till/agent
 *
 * The coa_code column is auto-minted by the service (nextLeafCode below) —
 * never entered by the caller. Passing it from the outside is rejected: it
 * would let a body reach around the allocator and post to any account.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

/**
 * Full coherence check called before an insert.
 *
 * `category` is the row loaded from treasury_category (with the capability
 * flags). Everything else comes from the request body.
 */
function assertCreate({ category, custodianUserId, coaCode }) {
  if (coaCode) {
    // The service allocates the leaf; a body that supplies coaCode is either
    // reaching around the allocator or racing it. Both are bugs.
    throw new AppError(
      "COA_IS_MANAGED",
      "treasury_account.coa_code is auto-minted by the system — do not supply it",
      422,
    );
  }
  if (!category) {
    throw new AppError("NO_CATEGORY", "category_id is required", 422);
  }
  if (category.is_active === false) {
    throw new AppError("CATEGORY_INACTIVE", "category " + category.code + " is inactive", 422);
  }
  if (category.requires_custodian && !custodianUserId) {
    throw new AppError(
      "NO_CUSTODIAN",
      "category " + category.code + " needs a custodian_user_id " +
      "(the person responsible for the account's payouts)",
      422,
    );
  }
  return true;
}

/**
 * A CoA parent that's fit to hang a treasury leaf under:
 *   – must exist
 *   – must be class 5 (the treasury class)
 *   – must be non-postable (parents are not postable; leaves are)
 *   – must have room for another 6-digit child
 *
 * Called by both treasury_category (on create) and by the treasury_account
 * service before allocating a leaf. Idempotent; throws AppError otherwise.
 */
function assertCoaParent(row) {
  if (!row) throw new AppError("BAD_PARENT", "CoA parent not found", 422);
  if (row.class !== 5) {
    throw new AppError(
      "NOT_TREASURY_CLASS",
      "CoA parent " + row.code + " is class " + row.class + " — treasury needs class 5",
      422,
    );
  }
  if (row.is_postable === true) {
    throw new AppError(
      "PARENT_POSTABLE",
      "CoA parent " + row.code + " is postable — pick a non-postable parent to hang leaves under",
      422,
    );
  }
  return true;
}

/**
 * The MoMo fee CoA (if supplied) is a class-6 charge account.
 * Kept as a soft check because most installs will take the platform default
 * posting rule from MOD-06.
 */
function assertMomoFeeAccount(momoFeeAccount) {
  if (!momoFeeAccount) return true;
  if (String(momoFeeAccount)[0] !== "6") {
    throw new AppError(
      "BAD_FEE_ACCOUNT",
      "momo_fee_account should be a class-6 charge account",
      422,
    );
  }
  return true;
}

/**
 * Compute the NEXT sub-account CoA code under a given parent.
 *
 * Rule: children are 6-digit codes that start with the parent's digits. Pick
 * the highest existing 6-digit child under this parent and increment; if
 * there are none, start at `<parent><padding><1>` where the padding fills to
 * width 6.
 *
 *   parent '521'   → first child '521101'   (three-digit parent + '101')
 *   parent '571'   → first child '571101'
 *   parent '5711'  → first child '571110'   (four-digit parent + '10')
 *   parent '5381'  → first child '538110'
 *   parent '5382'  → first child '538210'
 *
 * A treasurer looking at the trial balance can always tell which parent a
 * leaf hangs off. Adding a new MoMo-style category tomorrow (a treasurer picks
 * '5383' or the next 4-digit slot the treasury_category service allocated for
 * them) works with no special casing — same function, same rule.
 *
 * Passed the array of existing child codes (already narrowed to `parent_code
 * = parent`) so the pure function stays testable.
 */
function nextLeafCode(parent, existingCodes) {
  const p = String(parent);
  const width = 6;
  if (p.length >= width) {
    throw new AppError(
      "BAD_PARENT",
      "cannot allocate a 6-digit sub-account under a " + p.length + "-digit parent " + p,
      500,
    );
  }
  const digitsForSuffix = width - p.length;              // 3 for a 3-digit parent, 2 for a 4-digit
  // First suffix: "10" for width 2, "101" for width 3, "1001" for width 4 …
  // — a leading '1', trailing '1', zeros in between. Reads as "the first
  // real leaf under this parent" rather than "…100" which looks like a parent
  // itself. Matches the spec 521101 / 571101 / 571110 / 538110 / 538210.
  const firstSuffix = digitsForSuffix <= 2
    ? Math.pow(10, digitsForSuffix - 1).toString()       // "10" for width 2
    : "1" + "0".repeat(digitsForSuffix - 2) + "1";       // "101" for 3, "1001" for 4
  const start = parseInt(firstSuffix, 10);
  let max = start - 1;
  for (const code of existingCodes || []) {
    const c = String(code);
    if (c.length !== width) continue;
    if (!c.startsWith(p)) continue;
    const tail = c.slice(p.length);
    if (!/^[0-9]+$/.test(tail)) continue;
    const asNum = parseInt(c, 10);
    if (asNum > max) max = asNum;
  }
  const next = max < start ? parseInt(p + String(start), 10) : max + 1;
  const s = String(next);
  if (s.length !== width) {
    // Safety net: 900 accounts under 521 exhausts the pool (521100–521999).
    // If this fires the tenant has more accounts of one type than any real
    // business, and the treasurer will restructure before the 1000th.
    throw new AppError(
      "POOL_EXHAUSTED",
      "sub-account pool under parent " + p + " is exhausted",
      500,
    );
  }
  return s;
}

// ── Legacy shims (kept so no other module has to change on the same PR) ──
// The pre-revamp rules were `assertCashAccount(coaCode)` and `assertMomo({...})`.
// treasury_account.controller and its tests still name them; keep them working
// so this diff stays scoped to the treasury module.

/** Legacy: assert a supplied coa_code is class 5. Auto-mint bypasses this. */
function assertCashAccount(coaCode) {
  const c = String(coaCode || "").trim();
  if (!c) throw new AppError("NO_COA", "coa_code is required", 422);
  if (c[0] !== "5") throw new AppError("NOT_CASH_ACCOUNT", "coa_code " + c + " must be a class-5 treasury account", 422);
  return true;
}

/** Legacy: MoMo accounts must name a network; category-driven flow supersedes this. */
function assertMomo({ kind, momoNetwork, momoFeeAccount }) {
  if (kind !== "MOMO") return true;
  if (!momoNetwork) throw new AppError("NO_NETWORK", "a MoMo treasury account needs momo_network (MTN/ORANGE)", 422);
  return assertMomoFeeAccount(momoFeeAccount);
}

module.exports = {
  assertCreate, assertCoaParent, assertMomoFeeAccount, nextLeafCode,
  // legacy re-exports
  assertCashAccount, assertMomo,
};
