/**
 * Worker job: QES poll backstop, scheduler half. One `qes-poll` job per live
 * tenant, every thirty minutes.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §7.4 step 6.
 *
 * ── WHY THIRTY MINUTES ─────────────────────────────────────────────────────
 * The webhook is the fast path; the poll exists because webhooks get lost.
 * Thirty minutes bounds the worst-case lateness of a completion the tenant
 * is waiting on (a counterparty who just signed on the provider's platform
 * and whose webhook is stuck), and costs each tenant one indexed range scan
 * — `ix_qes_open` is a partial index that is EMPTY for the tenants that have
 * never certified anything, which is every tenant most of the time.
 *
 * ── WHY LIVE ONLY ──────────────────────────────────────────────────────────
 * The poll talks to the provider with the tenant's credentials and can
 * SETTLE a chain — writing a signature, advancing the request, emailing the
 * next party. A sandbox sweep would consume real provider state (a document
 * completed in the provider settles in the sandbox, and the live envelope
 * that the poll was standing in for is still open), and the mail is the
 * tenant's real mail. Live only, like every sweep that acts.
 *
 * ── IDEMPOTENCY ────────────────────────────────────────────────────────────
 * The per-tenant jobId dedupes an in-flight sweep the way the reminder
 * scheduler's does, and the handler's own work is idempotent under
 * re-entry: the envelope claim is a guarded transition, so a second pass
 * over the same envelope finds the claim taken and does nothing.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { enqueue } = require("../queue-producer");
const { logger } = require("../../config/logger");

/**
 * `YYYYMMDDHHMM` — the tick's own thirty-minute slot, for the dedupe key.
 *
 * No colons: a BullMQ custom job id may contain `:` only when it splits into
 * exactly three segments (the reminder scheduler's note), and the tenant's
 * db_name already takes the middle one.
 */
const slotStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

module.exports = async function qesPollScheduler() {
  const tenants = await registry.listActiveTenants();
  const stamp = slotStamp();
  let enqueued = 0;
  let skipped = 0;

  for (const meta of tenants) {
    try {
      await enqueue(
        "qes-poll",
        "sweep",
        { tenantMeta: meta, env: "live" },
        {
          jobId: `qespoll:${meta.db_name}:live-${stamp}`,
          // Several attempts: a provider blip or a platform-DB hiccup is
          // exactly the condition the backstop exists for, and a backstop
          // that dies on the first blip is not a backstop. The handler is
          // idempotent, so the retry is free.
          attempts: 3,
          removeOnComplete: true,
          removeOnFail: 50,
        },
      );
      enqueued += 1;
    } catch (err) {
      // One unreachable tenant must not stop the fan-out for the rest.
      logger.warn({ err, tenant: meta.db_name }, "[qes] poll scheduler could not enqueue tenant");
      skipped += 1;
    }
  }

  logger.debug({ tenants: tenants.length, enqueued, skipped }, "[qes] poll tick");
  return { tenants: tenants.length, enqueued, skipped };
};
