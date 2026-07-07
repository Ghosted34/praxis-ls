"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { page } = require("../../../shared/db/query-helpers");
const base = makeRepo({ table: "invoice", pk: "invoice_id", orderBy: "created_at DESC" });
async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const { rows } = await client.query(
    "SELECT * FROM invoice WHERE type = 'PROFORMA' ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset],
  );
  return rows;
}
module.exports = Object.assign({}, base, { list });
