"use strict";

const { AppError } = require("../../utils/errors");

function isUsableSupplier(row) {
  return Boolean(row)
    && row.registration_status === "ACTIVE"
    && row.verification_status === "VERIFIED"
    && row.avl_status === "APPROVED";
}

async function assertSupplierUsable(client, supplierId, { required = false, lock = false } = {}) {
  if (!supplierId) {
    if (required) {
      throw new AppError("SUPPLIER_REQUIRED", "A verified supplier is required", 422,
        { supplier_id: ["required"] });
    }
    return null;
  }
  const { rows } = await client.query(
    `SELECT supplier_id, name, registration_status, verification_status, avl_status
       FROM supplier_master
      WHERE supplier_id = $1${lock ? " FOR UPDATE" : ""}`,
    [supplierId],
  );
  const row = rows[0] || null;
  if (!row) throw new AppError("NOT_FOUND", "Supplier not found", 404);
  if (!isUsableSupplier(row)) {
    throw new AppError(
      "SUPPLIER_NOT_VERIFIED",
      `${row.name || "This supplier"} is not active, verified and AVL-approved. Complete supplier verification before using it for procurement.`,
      422,
      { supplier_id: ["supplier must be ACTIVE, VERIFIED and AVL APPROVED"] },
    );
  }
  return row;
}

module.exports = { isUsableSupplier, assertSupplierUsable };
