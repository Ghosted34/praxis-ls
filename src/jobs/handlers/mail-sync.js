/**
 * Worker job: poll a tenant's IMAP mail connections for new inbound. Job data:
 * { tenantMeta, env }. For each CONNECTED imap_smtp connection, fetch since its
 * cursor, dedup-insert into email_inbound, emit email.received, advance cursor.
 * A per-connection failure is isolated (recorded on the row) and never aborts the
 * others. See doc/EMAIL_ENGINE_PLAN.md §5 and mail.service.syncConnection.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const mail = require("../../modules/mail/mail.service");
const repo = require("../../modules/mail/mail.repo");

module.exports = async function mailSync(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("mail-sync job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, async (c) => {
    const conns = await repo.listSyncable(c);
    const results = [];
    for (const conn of conns) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await mail.syncConnection(c, conn.email_connection_id, { slug: tenantMeta.slug }));
    }
    return { connections: conns.length, results };
  });
};
