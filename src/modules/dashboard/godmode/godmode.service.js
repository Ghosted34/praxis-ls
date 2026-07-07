"use strict";
/** God Mode (CEO-only, PIN-gated). Purges junk NON-accounting data and writes
 *  the full removed payload to the immutable ledger (PRD §8.5). Accounting-
 *  connected records can never be purged — only reversed. */
const repo = require("./godmode.repo");

const listPurgeable = (c) => repo.listSoftDeletes(c);

async function purge(c, { actor, softDeleteId, pin, ip }) {
  if (!actor || !actor.user_id) { const e = new Error("authentication required"); e.status = 401; throw e; }
  const hash = await repo.pinHash(c, actor.user_id);
  if (!hash) { const e = new Error("God Mode is restricted to the CEO (no PIN on file)"); e.status = 403; throw e; }
  let ok = false;
  try { const argon2 = require("argon2"); ok = await argon2.verify(hash, pin || ""); } catch { ok = false; }
  if (!ok) { const e = new Error("invalid God Mode PIN"); e.status = 403; throw e; }

  const row = await repo.getSoftDelete(c, softDeleteId);
  if (!row) { const e = new Error("record not found or already purged"); e.status = 404; throw e; }
  if (/^(invoice|journal|receipt|payment|asset|payroll):/i.test(row.entity_ref || "")) {
    const e = new Error("accounting-connected records can never be purged — reverse instead");
    e.status = 422; throw e;
  }
  await repo.recordPurge(c, { actorUserId: actor.user_id, entityRef: row.entity_ref, payload: row.payload_json, ip });
  return { purged: true, entity_ref: row.entity_ref };
}
module.exports = { listPurgeable, purge };
