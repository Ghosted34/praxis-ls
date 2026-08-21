/**
 * Worker job: poll a tenant's IMAP mail connections for new inbound. Job data:
 * { tenantMeta, env }. For each CONNECTED imap_smtp connection, fetch since its
 * per-folder cursor, dedup-insert into email_message, emit email.received, advance.
 * A per-connection failure is isolated (recorded on the row) and never aborts the
 * others. See doc/EMAIL_ENGINE_PLAN.md §5 and mail.service.syncConnection.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const mail = require("../../modules/mail/mail/mail.service");
const repo = require("../../modules/mail/mail/mail.repo");

module.exports = async function mailSync(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("mail-sync job needs tenantMeta");
  return registry.withTenantConnection(tenantMeta, env, async (c) => {
    const conns = await repo.listSyncable(c);
    const results = [];
    for (const conn of conns) {
       
      // `tenantMeta` and `env` ride along so the ingest path can ENQUEUE work
      // rather than only do it inline — attachment extraction (§8.6) is a
      // vendor call per file and must not sit inside the sync loop, where it
      // would make a mailbox appear broken for the length of a first sync.
      results.push(await mail.syncConnection(c, conn.email_connection_id, {
        slug: tenantMeta.slug, tenantMeta, env,
      }));
    }
    return { connections: conns.length, results };
  });
};
