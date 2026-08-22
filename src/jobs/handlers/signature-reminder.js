/**
 * Worker job: nudge the parties who have had a signing link for too long, and
 * expire the requests that have run out of time.
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md §6.8.
 *
 * TWO NUDGES, THEN SILENCE. `reminder_days` (default `[2, 5]`) is the schedule
 * and `[]` disables it; the cap is enforced in SQL — `WHERE reminder_count < 2`
 * — rather than by counting here, so a retried sweep cannot produce a third
 * email. A third email teaches people to filter you, and the one thing worse
 * than an unsigned document is an unsigned document whose sender is now in a
 * spam folder.
 *
 * Reminders stop on any settlement and on request expiry, which
 * `partiesDueReminder` expresses as a join rather than as a second pass: a
 * party who signed while the sweep was running is simply not selected.
 */
"use strict";

const registry = require("../../services/tenant/registry.service");
const { logger } = require("../../config/logger");

module.exports = async function signatureReminder(job) {
  const { tenantMeta, env = "live" } = job.data || {};
  if (!tenantMeta) throw new Error("signature-reminder needs tenantMeta");

  return registry.withTenantConnection(tenantMeta, env, async (client) => {
    const service = require("../../modules/vault/signature_request/signature_request.service");
    const mail = require("../../modules/vault/signature_request/signature_request.mail");
    const { originForSlug } = require("../../services/signatures/verify-link");

    // The worker has no request, so the host comes from the tenant's own slug —
    // the same resolution the QR uses (services/signatures/verify-link.js).
    const origin = originForSlug(tenantMeta.slug);

    // Expiry first: a request that has run out of time must not be nudged on
    // its way out of the door.
    const expired = await service.expireOverdue(client);

    const due = await service.dueReminders(client);
    let sent = 0;

    for (const row of due) {
      try {
        const language = String(row.language || "fr").toLowerCase().startsWith("en") ? "en" : "fr";

        /*
         * A FRESH token, and the email says so.
         *
         * The plaintext of the original was emailed once and never stored
         * (§3.7), so there is nothing to re-send — and rotating a credential
         * that has been sitting in an inbox for five days is the better answer
         * anyway. `remintSignToken` returns null for a party who settled
         * between the sweep's SELECT and now, which is the race worth having:
         * somebody signed, and they get no nudge.
         */
        // eslint-disable-next-line no-await-in-loop -- serial by design: these
        // are outbound emails, and a burst is what gets a domain throttled.
        const minted = await service.remintSignToken(client, {
          partyId: row.party_id, expiresAt: row.sign_expires_at,
        });
        if (!minted) continue;

        const url = `${origin}/sign/${encodeURIComponent(minted.token)}`;
        const { subject, html, text } = mail.reminderEmail({
          party: row,
          request: { doc_type: row.doc_type, entity_ref: row.entity_ref, expires_at: row.sign_expires_at },
          url,
          tenantName: tenantMeta.name || "",
          language,
          nudge: Number(row.reminder_count || 0) + 1,
        });

        // eslint-disable-next-line no-await-in-loop
        await mail.send(client, {
          to: row.email, subject, html, text,
          entityRef: row.entity_ref, sendPoint: "signature.reminder",
        });
        // eslint-disable-next-line no-await-in-loop
        const recorded = await service.recordReminder(client, {
          requestId: row.req_id, partyId: row.party_id, entityRef: row.entity_ref,
        });
        if (recorded) sent += 1;
      } catch (err) {
        // One bad address must not stop the sweep. The counter advances only on
        // a successful send, so this party is picked up again next hour.
        logger.warn(
          { err: err && err.message, party_id: row.party_id },
          "[signatures] reminder could not be sent",
        );
      }
    }

    logger.debug({ due: due.length, sent, expired }, "[signatures] reminder sweep");
    return { due: due.length, sent, expired };
  });
};
