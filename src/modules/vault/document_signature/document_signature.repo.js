"use strict";
const { insertOne, listComplete } = require("../../../shared/db/query-helpers");
function insert(client, data) { return insertOne(client, "document_signature", data); }
async function listByRef(client, entityRef) {
  const { rows } = await listComplete(client, "SELECT * FROM document_signature WHERE entity_ref = $1 ORDER BY created_at DESC", [entityRef], { label: "Document signatures", ceiling: 5000 });
  return rows;
}
module.exports = { insert, listByRef };
