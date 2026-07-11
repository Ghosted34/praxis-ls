/** Chart of Accounts rules (MOD-06, KB §5/§22) — pure. */
"use strict";
const { AppError } = require("../../../utils/errors");

const classOf = (code) => parseInt(String(code)[0], 10);

/** A new/edited account's class digit must match the first digit of its code. */
function assertCodeClass(code, klass) {
  if (!/^[1-9][0-9]*$/.test(String(code))) throw new AppError("BAD_CODE", "account code must be numeric OHADA (e.g. 4111)", 422);
  if (classOf(code) !== Number(klass)) throw new AppError("CLASS_MISMATCH", "class " + klass + " must match the first digit of " + code, 422);
}

/** A child code should sit under its parent (parent is a prefix). */
function isChildOf(code, parentCode) {
  return String(code).startsWith(String(parentCode)) && String(code) !== String(parentCode);
}

module.exports = { classOf, assertCodeClass, isChildOf };
