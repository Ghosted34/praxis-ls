/**
 * THE PRE-SEND GUARDRAIL CHECK (§8.8).
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 *
 * `assist.guardrails.check()` was written, unit-tested, and exposed at
 * `POST /mail/assist/guardrails`. The composer could ask "is this message
 * alright?" and get a correct answer. Nothing on the SEND path asked. So the
 * one hard block in the programme —
 *
 *   "a financial document to a domain rated Suspicious or Likely impersonation"
 *
 * — was advisory: a client that skipped the optional call, a send from the AI
 * action catalogue, a send from a script, a composer bug that dropped the
 * request, all sent the invoice. A check that the caller may decline to run is
 * not a block, and §8.8 calls this one a block.
 *
 * It runs HERE, in `outbox.service.send`, because that is the single point
 * every send passes through — `POST /mail/send`, `reply`, the AI catalogue's
 * `send_mail`, and the scheduled path all queue through it. Putting it in the
 * route would leave the other three open.
 *
 * ── THE OVERRIDE IS THE POINT, NOT AN ESCAPE HATCH ──────────────────────────
 *
 * A hard block with no override stops a legitimate invoice going to a client
 * whose new domain nobody has verified yet, at 17:55 on a Friday. That is a
 * real cost and people route around it — by sending from Outlook, where there
 * is no check at all. So the block is overridable, and the override:
 *
 *   · requires a typed REASON, not a checkbox. A checkbox records that someone
 *     clicked; a sentence records what they believed.
 *   · writes that reason to `immutable_ledger` — append-only, 10-year
 *     retention, `trg_ledger_ro` forbids UPDATE and DELETE. The record of the
 *     decision outlives the person who made it and the mailbox it came from.
 *   · is recorded BEFORE the message is queued. A ledger entry for a send that
 *     then failed is a harmless surplus; a send with no ledger entry is the
 *     thing being prevented.
 *
 * Warnings are NOT blocks and never became one. They ride along on the response
 * so the composer can show them; nothing here refuses a send over a missing
 * subject line.
 */
"use strict";

const guardrails = require("../assist/assist.guardrails");
const { AppError } = require("../../../utils/errors");
const { audit } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");

const MODULE = "MOD-72";

const domainOf = (addr) => String(addr || "").toLowerCase().split("@")[1] || null;

/**
 * The verdict to judge an OUTBOUND message by.
 *
 * Anti-spoof stamps INBOUND messages: it answers "is the person writing to us
 * who they claim to be". Sending asks the mirror question — "is the address I
 * am about to send this invoice to actually theirs" — and the two are not the
 * same lookup, which is why this cannot just read `auth_verdict` and stop.
 *
 * Two signals, in this order:
 *
 *  1. If the bound party HAS admin-verified domains and the recipient is not on
 *     one of them, that is the payment-redirection pattern almost exactly: a
 *     real thread, a real client, one recipient address that is not theirs.
 *     SUSPICIOUS. Note the precondition — a party with NO verified domains
 *     tells us nothing, and treating "we never configured this" as "this is an
 *     impostor" would block every send in a tenant that has not done the
 *     set-up, which teaches everyone to override reflexively.
 *  2. Otherwise, the worst verdict already stamped on the thread's inbound
 *     messages. If we concluded an hour ago that someone in this thread was
 *     likely impersonating a client, replying to it with a statement attached
 *     deserves the same block.
 */
const RANK = { VERIFIED: 0, UNVERIFIED: 1, SUSPICIOUS: 2, LIKELY_IMPERSONATION: 3 };

async function verdictForSend(client, { threadId, to = [] }) {
  if (!threadId) return { verdict: "VERIFIED", why: null };

  const { rows: threadRows } = await client.query(
    "SELECT entity_ref FROM email_thread WHERE email_thread_id = $1",
    [threadId],
  );
  const entityRef = threadRows[0] && threadRows[0].entity_ref;

  const m = /^(client|supplier):(.+)$/.exec(String(entityRef || ""));
  if (m) {
    const { rows } = await client.query(
      `SELECT domain::text AS domain FROM party_verified_domain
        WHERE party_kind = $1 AND party_id = $2 AND source = 'ADMIN_VERIFIED'`,
      [m[1].toUpperCase(), m[2]],
    );
    const verified = rows.map((r) => String(r.domain).toLowerCase());
    if (verified.length) {
      const strangers = to.map(domainOf).filter((d) => d && !verified.includes(d));
      if (strangers.length) {
        return {
          verdict: "SUSPICIOUS",
          why: `${strangers.join(", ")} is not a verified domain for this party.`,
        };
      }
    }
  }

  const { rows: seen } = await client.query(
    `SELECT auth_verdict FROM email_message
      WHERE email_thread_id = $1 AND direction = 'IN' AND auth_verdict IS NOT NULL`,
    [threadId],
  );
  let worst = "VERIFIED";
  for (const r of seen) {
    if ((RANK[r.auth_verdict] || 0) > (RANK[worst] || 0)) worst = r.auth_verdict;
  }
  return {
    verdict: worst,
    why: worst === "VERIFIED" ? null : `This thread carries a ${worst} sender verdict.`,
  };
}

/**
 * Run the checks and either return warnings, or refuse.
 *
 * @param input the send payload, already assembled (html/text/subject/to/
 *              attachments) — checked as it will actually be SENT rather than
 *              as it was typed, so a signature or a template that introduced
 *              bank details is inside the check rather than appended after it.
 * @returns {{warnings: [], blocks: [], verdict, overridden: boolean}}
 * @throws  AppError 422 GUARDRAIL_BLOCKED when a block stands and no reason
 *          was typed.
 */
async function check(client, actor, input = {}, { html, text, attachments = [] } = {}) {
  const to = [].concat(input.to || []).filter(Boolean);
  const { verdict, why } = await verdictForSend(client, { threadId: input.email_thread_id, to });

  const message = {
    html, text,
    subject: input.subject || null,
    to,
    attachments: attachments.map((a) => ({ filename: a.filename })),
    htmlBytes: html ? Buffer.byteLength(html, "utf8") : 0,
  };

  const result = guardrails.check(message, {
    authVerdict: verdict,
    preferredLanguage: input.recipient_language || null,
    draftLanguage: input.draft_language || null,
  });

  if (!result.blocks.length) {
    return { ...result, verdict, verdict_reason: why, overridden: false };
  }

  const reason = String(input.guardrail_override_reason || "").trim();
  if (!reason) {
    throw new AppError(
      "GUARDRAIL_BLOCKED",
      result.blocks[0].message,
      422,
      { blocks: result.blocks, warnings: result.warnings, auth_verdict: verdict, verdict_reason: why },
    );
  }
  if (reason.length < 10) {
    // A ten-character floor is not a quality bar — it is a speed bump against
    // "ok", "fine" and ".", which is what a mandatory free-text field collects
    // when the person filling it is in a hurry and the field will accept
    // anything.
    throw new AppError(
      "GUARDRAIL_REASON_TOO_SHORT",
      "The override reason is written to the permanent ledger. Please say why in a sentence.",
      422,
      { blocks: result.blocks },
    );
  }

  // Written BEFORE the queue row. See the header.
  //
  // Not wrapped in a swallow-everything catch, unlike most audit calls in this
  // module: the ledger entry IS the control. If it cannot be written, the send
  // must not proceed on the strength of an override that left no trace.
  await audit(client, {
    actorUserId: (actor && actor.user_id) || null,
    action: "mail.guardrail.overridden",
    moduleKey: MODULE,
    entityRef: input.email_thread_id ? `email_thread:${input.email_thread_id}` : "email_send_queue:pending",
    after: {
      reason,
      blocks: result.blocks.map((b) => b.code),
      auth_verdict: verdict,
      verdict_reason: why,
      to,
      subject: input.subject || null,
    },
  });

  logger.warn(
    { user_id: (actor && actor.user_id) || null, blocks: result.blocks.map((b) => b.code), verdict },
    "mail guardrail overridden",
  );

  return { ...result, verdict, verdict_reason: why, overridden: true, override_reason: reason };
}

module.exports = { check, verdictForSend, domainOf, RANK };
