/**
 * Proof obligations — the advisory bridge between the financial dictionary and
 * the compliance-flag engine (MOD-05 → MOD-65).
 *
 * THE PROBLEM. A dictionary item can declare that it always needs a receipt, or
 * that the spender must justify it (0630: `receipt_requirement`,
 * `requires_justification`). Until now nothing consumed that declaration at the
 * moment it mattered. The batch checker's `cost_entry.missing_proof` rule
 * flagged EVERY cost entry without a proof, obligation or not — which on a
 * catalogue where most lines legitimately need no receipt is a list nobody
 * reads — and it ran on a schedule, so the person who could still walk back to
 * the counter and ask for the receipt heard about it days later, if at all.
 *
 * WHAT THIS DOES. When a cash-request line or a cost entry uses an obliged item
 * with no `proof_vault_id`, it raises a WARN compliance_flag AT THAT MOMENT and
 * notifies the requester. That is the whole feature.
 *
 * ADVISORY. NOT A BLOCK. This is stated in three places because it is the design
 * decision most likely to be "improved" into a hard failure by someone reading
 * only the rule name. A freight forwarder pays a port authority in cash at
 * 06:00 and gets the paperwork at 11:00; a system that refuses the disbursement
 * until the receipt exists does not produce more receipts, it produces
 * disbursements recorded outside the system. So: every function here is
 * best-effort, never throws, and the caller's transaction is unaffected by any
 * failure inside it.
 *
 * THE SEAM. Everything is written through `compliance_flag` with three
 * dimensions 0631 added — `dictionary_item_id`, `subject_user_id`, `source` —
 * which is what lets the two things this is a foundation for be reads rather
 * than rewrites:
 *
 *   a future Compliance module      GROUP BY dictionary_item_id on open flags
 *   Employee-360 "documents owed"   WHERE subject_user_id = :employee
 *
 * Neither needs a table, an event or a change here. `listOwed()` below is that
 * query, exported now so the tab is a render when someone gets to it.
 */
"use strict";

const { logger } = require("../../config/logger");
const rules = require("../../modules/master/financial_dictionary/financial_dictionary.rules");

const RULE_KEYS = {
  cash_request_line: "dictionary.proof_missing.cash_request",
  cost_entry: "dictionary.proof_missing.cost_entry",
};

/**
 * Catalogue entry for the two advisory rules, in the shape MOD-65's rule
 * catalogue uses. Merged into it by compliance_flag.rules so the checker,
 * the catalogue endpoint and the flags screen all know these rules exist.
 */
const CATALOGUE = {
  [RULE_KEYS.cash_request_line]: {
    severity: "WARN",
    describe: "A cash-request line uses a dictionary item that always requires a receipt (or a justification) and carries no supporting document (KB §Q4 — advisory).",
  },
  [RULE_KEYS.cost_entry]: {
    severity: "WARN",
    describe: "A dossier cost entry uses a dictionary item that always requires a receipt (or a justification) and carries no supporting document (KB §Q4 — advisory).",
  },
};

/** Load the catalogue row an obligation is decided from. Null → no obligation. */
async function loadItem(client, dictionaryItemId) {
  if (!dictionaryItemId) return null;
  const { rows } = await client.query(
    `SELECT dictionary_item_id, code, label_fr, label_en, receipt_requirement,
            requires_justification, proof_source
       FROM dictionary_item WHERE dictionary_item_id = $1`,
    [dictionaryItemId],
  );
  return rows[0] || null;
}

/**
 * Raise the flag unless an identical OPEN one already exists.
 *
 * Idempotent by (rule_key, entity_ref) rather than by row identity because a
 * cash request is saved repeatedly while it is a draft, and five saves must
 * not become five warnings about the same missing receipt. Two concurrent saves
 * can still both insert — there is no unique index (0631 explains why), and a
 * duplicate advisory warning is a far cheaper outcome than a migration that
 * fails to build on a tenant with existing duplicates.
 */
async function raiseOnce(client, flag) {
  const { rows: existing } = await client.query(
    "SELECT flag_id FROM compliance_flag WHERE rule_key = $1 AND entity_ref = $2 AND resolved_at IS NULL LIMIT 1",
    [flag.rule_key, flag.entity_ref],
  );
  if (existing.length) return null;
  const { rows } = await client.query(
    `INSERT INTO compliance_flag (rule_key, entity_ref, severity, message, dictionary_item_id, subject_user_id, source)
     VALUES ($1, $2, 'WARN', $3, $4, $5, 'INLINE')
     RETURNING *`,
    [flag.rule_key, flag.entity_ref, flag.message, flag.dictionary_item_id, flag.subject_user_id],
  );
  return rows[0] || null;
}

/** Clear the open flag once the proof arrives (a re-save that attaches one). */
async function clearFor(client, ruleKey, entityRef) {
  const { rowCount } = await client.query(
    "UPDATE compliance_flag SET resolved_at = now() WHERE rule_key = $1 AND entity_ref = $2 AND resolved_at IS NULL",
    [ruleKey, entityRef],
  );
  return rowCount;
}

/**
 * Tell the person who owes the document, in-app.
 *
 * THE REQUESTER, not the module's permission-holders. The generic event fan-out
 * (shared/notifications/notify-events) notifies everyone who can view the
 * module, which is right for "an invoice was posted" and wrong for this: the
 * only person who can produce the missing receipt is the one who spent the
 * money.
 *
 * IN-APP ONLY, AND DELIBERATELY NOT `notification.service.notify()`.
 *
 * That function is the right general-purpose producer, and it fans out to email
 * and web-push — which means an SMTP round trip. Its own documentation says so:
 * "Transactional producers should call notify() AFTER their commit so the DB
 * transaction isn't held open across it." This check runs INSIDE the cash
 * request's / cost entry's transaction, because the flag must be atomic with
 * the line that caused it; holding that transaction open across an SMTP
 * handshake to send an advisory nudge would be a genuinely bad trade — it puts
 * a lock on a disbursement behind a mail server's availability.
 *
 * So this writes the IN_APP row directly (one INSERT, no network) and still
 * honours the recipient's per-category preference, exactly as notify() would.
 * That is not a downgrade: the notifications service's own premise is that "the
 * row is the notification" and the other channels are the courtesy.
 */
async function notifyOwner(client, { userId, item, message, entityRef }) {
  if (!userId) return 0;
  try {
    const repo = require("../../modules/notification/notification.repo");
    const { categoryFor } = require("../../shared/notifications/categories");
    const category = categoryFor("compliance_flag.raised");
    if (!(await repo.isChannelEnabled(client, userId, "IN_APP", category))) return 0;
    await repo.insertForUser(client, {
      userId,
      eventTypeKey: "compliance_flag.raised",
      title: `Supporting document needed — ${item.code || "dictionary line"}`,
      body: message,
      entityRef,
      priority: "NORMAL",
      category,
    });
    return 1;
  } catch (err) {
    logger.warn({ err, entityRef }, "[proof-obligation] could not notify the requester");
    return 0;
  }
}

/**
 * The one entry point the document modules call.
 *
 * @param {object} client                tenant connection (the caller's transaction)
 * @param {object} input
 * @param {'cash_request_line'|'cost_entry'} input.kind
 * @param {string} input.entityRef       "cash_request_line:<id>" — what the flag points at
 * @param {string} input.dictionaryItemId
 * @param {string|null} input.proofVaultId
 * @param {string|null} input.requesterUserId  who owes the document
 * @param {number|null} input.amount
 * @param {string} [input.docLabel]      human noun for the message ("cash request")
 * @returns {Promise<{raised:boolean, cleared:number, notified:number, reasons:string[]}>}
 */
async function check(client, input = {}) {
  const { kind, entityRef, dictionaryItemId, proofVaultId = null, requesterUserId = null, amount = null, docLabel = null } = input;
  const ruleKey = RULE_KEYS[kind];
  const out = { raised: false, cleared: 0, notified: 0, reasons: [] };
  if (!ruleKey || !entityRef) return out;

  try {
    const item = await loadItem(client, dictionaryItemId);
    if (!item) return out;

    const obligation = rules.proofObligation(item);
    out.reasons = obligation.reasons;
    if (!obligation.required) {
      // No obligation: if a previous version of this line HAD one, the flag it
      // raised is now wrong and must not linger.
      out.cleared = await clearFor(client, ruleKey, entityRef);
      return out;
    }
    if (!rules.missingProof(item, { proof_vault_id: proofVaultId })) {
      out.cleared = await clearFor(client, ruleKey, entityRef);
      return out;
    }

    const message = rules.proofMessage(item, { docLabel: docLabel || kind.replace(/_/g, " "), amount });
    const flag = await raiseOnce(client, {
      rule_key: ruleKey,
      entity_ref: entityRef,
      message,
      dictionary_item_id: item.dictionary_item_id,
      subject_user_id: requesterUserId,
    });
    if (flag) {
      out.raised = true;
      out.notified = await notifyOwner(client, { userId: requesterUserId, item, message, entityRef });
    }
    return out;
  } catch (err) {
    // ADVISORY: a compliance warning must never fail the disbursement it is
    // warning about. Log and let the caller's transaction commit.
    logger.warn({ err, entityRef }, "[proof-obligation] advisory check failed");
    return out;
  }
}

/** Fan the check across a document's lines. Same guarantees; returns a summary. */
async function checkLines(client, lines = [], common = {}) {
  const summary = { raised: 0, cleared: 0, notified: 0 };
  for (const line of lines) {
    // Sequential on purpose: these run inside the caller's transaction on ONE
    // connection, so a Promise.all would interleave statements on it.
     
    const r = await check(client, { ...common, ...line });
    summary.raised += r.raised ? 1 : 0;
    summary.cleared += r.cleared;
    summary.notified += r.notified;
  }
  return summary;
}

/**
 * SEAM — Employee-360 "supporting documents owed".
 *
 * Open proof-obligation flags for one person, newest first, with the catalogue
 * line that demanded the document. This is the whole backend of that tab; it
 * exists now so the tab is a render rather than another round of schema work.
 */
async function listOwed(client, { userId = null, dictionaryItemId = null, limit = 50 } = {}) {
  const params = [];
  const wh = ["cf.resolved_at IS NULL", `cf.rule_key = ANY($${params.push(Object.values(RULE_KEYS))}::text[])`];
  if (userId) wh.push(`cf.subject_user_id = $${params.push(userId)}`);
  if (dictionaryItemId) wh.push(`cf.dictionary_item_id = $${params.push(dictionaryItemId)}`);
  const { rows } = await client.query(
    `SELECT cf.flag_id, cf.rule_key, cf.entity_ref, cf.severity, cf.message, cf.created_at,
            cf.dictionary_item_id, cf.subject_user_id,
            di.code AS item_code, di.label_fr AS item_label_fr, di.label_en AS item_label_en,
            di.receipt_requirement, di.proof_source
       FROM compliance_flag cf
       LEFT JOIN dictionary_item di ON di.dictionary_item_id = cf.dictionary_item_id
      WHERE ${wh.join(" AND ")}
      ORDER BY cf.created_at DESC
      LIMIT $${params.push(Math.min(Math.max(Number(limit) || 50, 1), 200))}`,
    params,
  );
  return rows;
}

module.exports = { check, checkLines, listOwed, clearFor, RULE_KEYS, CATALOGUE };
