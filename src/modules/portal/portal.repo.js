/** Portal repository. portal_access grants + a couple of client-scoped reads. */
"use strict";
const { insertOne, page } = require("../../shared/db/query-helpers");

const insertAccess = (client, data) => insertOne(client, "portal_access", data);
async function listAccess(client, { portal = null, limit = 50, offset = 0 } = {}) {
  const params = [limit, offset]; const wh = ["is_active = true"];
  if (portal) { params.push(portal); wh.push("portal = $" + params.length); }
  return (await client.query("SELECT * FROM portal_access WHERE " + wh.join(" AND ") + " ORDER BY created_at DESC LIMIT $1 OFFSET $2", params)).rows;
}
async function activeFor(client, email, portal) {
  const { rows } = await client.query(
    "SELECT * FROM portal_access WHERE subject_email = $1 AND portal = $2 AND is_active = true ORDER BY created_at DESC LIMIT 1",
    [email, portal],
  );
  return rows[0] || null;
}
async function revoke(client, id) {
  const { rows } = await client.query("UPDATE portal_access SET is_active = false WHERE portal_access_id = $1 AND is_active = true RETURNING *", [id]);
  return rows[0] || null;
}
// Client-portal scoped reads (a client only ever sees their own).
async function clientDossiers(client, clientId) {
  return (await client.query("SELECT dossier_id, ref, status, created_at FROM dossier WHERE client_id = $1 ORDER BY created_at DESC LIMIT 100", [clientId])).rows;
}
async function clientInvoices(client, clientId) {
  return (await client.query("SELECT invoice_id, doc_number, total_ttc, status, payment_due_on FROM invoice WHERE client_id = $1 AND type = 'FINAL' ORDER BY created_at DESC LIMIT 100", [clientId])).rows;
}
module.exports = { insertAccess, listAccess, activeFor, revoke, clientDossiers, clientInvoices, page };
