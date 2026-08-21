/**
 * WHEN AN ATTACHMENT GETS READ (§8.6), AND WHEN IT DOES NOT.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * `jobs/handlers/mail-ocr-extract.js` was written, registered in `workers.js`,
 * and enqueued by NOTHING. That is the exact defect this whole QC pass is
 * about — a worker that exists in the tree and not in the product — and it was
 * reintroduced by the commit that closed the last of them. Worth recording
 * plainly: a registered worker looks finished in every way except the one that
 * matters, because `workers.js` is where you go to check whether a job exists.
 *
 * The rule that catches it is the same one as for tables: a handler no code
 * enqueues is an orphan. `tests/unit/mail-ocr-extract.test.js` now asserts both
 * halves — the worker is registered AND the ingest path enqueues it.
 *
 * ── THE COST PROBLEM, WHICH IS THE WHOLE DESIGN ─────────────────────────────
 *
 * A vision call costs money per page. The naive wiring — extract every
 * attachment on ingest — bills a tenant for reading three months of historical
 * receipts on the day they connect a mailbox, and nobody authorised that.
 * §8.6 says on demand or on a queue; this is the queue half, and it is
 * deliberately narrow:
 *
 *   1. NOT during a first sync. `folder.last_sync_at` is null exactly once per
 *      folder, and that pass is a backfill of up to 90 days. The on-demand
 *      route is how someone reads an old attachment.
 *   2. NOT for everything. Only files whose name or subject already looks like
 *      a supplier invoice, receipt, client PO, proof of payment or cheque —
 *      `ocr.guessKind` returning anything but UNKNOWN. A photo of a container
 *      seal has no fields to extract and would be billed for finding that out.
 *   3. NOT without the flag. `mail.ocr` is a separate switch from `mail.ai`,
 *      because a tenant can reasonably want drafting and not want us sending
 *      their scanned invoices to a vision vendor. Fails closed.
 *   4. NOT twice. `ocr.extract` returns the existing row rather than re-calling
 *      the vendor, so a BullMQ redelivery is free.
 *
 * ── BEST EFFORT, ALWAYS ─────────────────────────────────────────────────────
 *
 * Nothing here may fail a sync. A queue that is down, a flag table mid-
 * migration, a Redis blip: the message is still ingested, the attachment is
 * still stored, and the operator can still press the button. Extraction is an
 * enrichment, and an enrichment that can break ingestion is a liability.
 */
"use strict";

const { enqueue } = require("../../../jobs/queue");
const { logger } = require("../../../config/logger");
const ocr = require("./ocr.service");

/** Its own switch — see rule 3 in the header. Fails closed. */
async function ocrEnabled(client) {
  try {
    const { rows } = await client.query(
      "SELECT state FROM feature_state WHERE feature_key = 'mail.ocr'",
    );
    return rows.length > 0 && rows[0].state === "on";
  } catch {
    return false;
  }
}

/**
 * Queue extraction for the attachments on one just-ingested message.
 *
 * @param opts.isFirstSync  true while backfilling a folder that has never
 *                          synced. Rule 1 — the single most expensive mistake
 *                          available here.
 * @returns {{queued: number, skipped?: string}}
 */
async function forMessage(client, { messageId, subject, ctx = {}, isFirstSync = false } = {}) {
  if (isFirstSync) return { queued: 0, skipped: "first sync" };
  if (!ctx.tenantMeta) return { queued: 0, skipped: "no tenant context" };
  if (!(await ocrEnabled(client))) return { queued: 0, skipped: "mail.ocr off" };

  let rows = [];
  try {
    const res = await client.query(
      `SELECT a.email_attachment_id, a.filename
         FROM email_attachment a
        WHERE a.email_message_id = $1
          AND a.vault_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM attachment_extraction e
             WHERE e.email_attachment_id = a.email_attachment_id)`,
      [messageId],
    );
    rows = res.rows;
  } catch (err) {
    logger.warn({ err, messageId }, "mail OCR: could not list attachments to queue");
    return { queued: 0, skipped: "listing failed" };
  }

  let queued = 0;
  for (const a of rows) {
    // Rule 2. The same filename-first classifier the worker itself uses, so
    // what gets queued and what gets extracted cannot disagree.
    if (ocr.guessKind({ filename: a.filename, subject }) === "UNKNOWN") continue;
    try {
      await enqueue(
        "mail-ocr-extract",
        "extract",
        { tenantMeta: ctx.tenantMeta, env: ctx.env || "live", attachmentId: a.email_attachment_id },
        // One attempt. The extraction is idempotent, but a vendor that is down
        // stays down for longer than three exponential backoffs, and each retry
        // is billable. A failed row is visible in the review queue and the
        // operator can re-run it deliberately.
        { attempts: 1, removeOnComplete: 200, removeOnFail: 100 },
      );
      queued += 1;
    } catch (err) {
      logger.warn({ err, attachmentId: a.email_attachment_id }, "mail OCR: enqueue failed");
    }
  }
  return { queued };
}

module.exports = { forMessage, ocrEnabled };
