/**
 * IMAP IDLE worker (opt-in, experimental) — low-latency inbound for IMAP mailboxes
 * as an alternative/complement to interval polling. Run as its own process:
 *
 *   node src/jobs/mail-idle.js        (or `npm run idle`)
 *
 * Design: it holds one long-lived IMAP connection per CONNECTED imap_smtp mailbox
 * and listens for the `exists` event (new message). On a signal it just ENQUEUES
 * the normal `mail-sync` job for that tenant — the actual fetch/dedup/store runs on
 * the proven job path with a fresh tenant DB connection. IDLE only lowers latency;
 * the periodic mail-sync scheduler remains the safety net, so a dropped IDLE
 * connection never loses mail.
 *
 * Caveats (why it's opt-in): it keeps N persistent IMAP sockets open, refreshes
 * the mailbox list only at startup, and does best-effort reconnect. For large
 * fleets prefer provider webhooks (Graph/Gmail) + polling for IMAP.
 */
"use strict";

const { ImapFlow } = require("imapflow");
const registry = require("../services/tenant/registry.service");
const settings = require("../modules/security/setting/setting.service");
const mailRepo = require("../modules/mail/mail.repo");
const { enqueue } = require("./queue-producer");
const { initRedis, closeRedis } = require("../config/redis");
const { logger } = require("../config/logger");

const RECONNECT_MS = 15000;
const idlers = new Map(); // key → ImapFlow
let stopping = false;

function triggerSync(meta) {
  enqueue("mail-sync", "sync", { tenantMeta: meta, env: "live" },
    { jobId: `mailsync:${meta.db_name}:live`, removeOnComplete: true, removeOnFail: 100 })
    .catch((err) => logger.warn({ err }, "[mail-idle] enqueue failed"));
}

async function idleConnection(meta, conn) {
  const key = `${meta.db_name}:${conn.email_connection_id}`;
  if (idlers.has(key) || stopping) return;

  let password = null;
  await registry.withTenantConnection(meta, "live", async (c) => {
    password = conn.secret_key ? await settings.readSecret(c, conn.secret_key) : null;
  });
  if (!password) return;

  const imap = new ImapFlow({
    host: conn.imap_host, port: conn.imap_port || 993, secure: conn.imap_secure !== false,
    auth: { user: conn.auth_user || conn.email_address, pass: password }, logger: false,
  });
  idlers.set(key, imap);

  imap.on("exists", () => triggerSync(meta));
  imap.on("close", () => {
    idlers.delete(key);
    if (!stopping) setTimeout(() => idleConnection(meta, conn).catch(() => {}), RECONNECT_MS);
  });

  await imap.connect();
  await imap.mailboxOpen("INBOX"); // imapflow auto-maintains IDLE while open
  triggerSync(meta); // catch anything that arrived before we connected
  logger.info({ conn: conn.email_connection_id, mailbox: conn.email_address }, "[mail-idle] idling");
}

async function main() {
  await initRedis();
  const tenants = await registry.listActiveTenants();
  for (const meta of tenants) {
    // eslint-disable-next-line no-await-in-loop
    const conns = await registry.withTenantConnection(meta, "live", (c) => mailRepo.listSyncable(c));
    for (const conn of conns.filter((x) => x.provider === "imap_smtp")) {
      // eslint-disable-next-line no-await-in-loop
      await idleConnection(meta, conn).catch((err) => logger.warn({ err, conn: conn.email_connection_id }, "[mail-idle] start failed"));
    }
  }
  logger.info({ idlers: idlers.size }, "[mail-idle] ready");

  const shutdown = async () => {
    stopping = true;
    for (const imap of idlers.values()) { try { await imap.logout(); } catch { /* noop */ } }
    await closeRedis();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  main().catch((err) => { logger.error({ err }, "[mail-idle] failed to start"); process.exit(1); });
}

module.exports = { main };
