/**
 * treasury_category — pure rules.
 *
 * A category is the user-editable dimension a treasury account picks from.
 * Seeded rows (BANK, CASH, PETTY_CASH, MTN_MOMO, ORANGE_MONEY) carry
 * is_system=true and cannot be deleted; the treasurer may rename them or
 * deactivate them, but the row survives so history that references its
 * category_id stays resolvable.
 */
"use strict";
const { AppError } = require("../../../utils/errors");

// The wire's `code` is UPPER_SNAKE_CASE. Not enforced by the DB (citext
// UNIQUE), but by the create rule so the picker labels stay tidy.
const CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

function assertCode(code) {
  if (!code || !CODE_RE.test(code)) {
    throw new AppError(
      "BAD_CODE",
      "category code must be UPPER_SNAKE_CASE letters/digits/underscore, starting with a letter",
      422,
    );
  }
  return true;
}

/** The CoA parent this category will hang leaves under. Class 5, non-postable. */
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

/** legacy_kind is denormalised onto each treasury_account so pre-revamp readers
 *  keep working. It's the wide bucket the category lives in. */
function assertLegacyKind(k) {
  if (!k || !["BANK", "CASH", "MOMO"].includes(k)) {
    throw new AppError("BAD_LEGACY_KIND", "legacy_kind must be BANK, CASH or MOMO", 422);
  }
  return true;
}

module.exports = { assertCode, assertCoaParent, assertLegacyKind };
