/**
 * Approval-flow notifications — the first real domain events wired through the
 * canonical notification producer (notification.service.notify).
 *
 *   onTaskOpened → tells the eligible approvers (active holders of the step's
 *                  role) that something awaits their approval. Fires when a chain
 *                  opens (executor.start) and when it advances a step (executor.act).
 *   onOutcome    → tells the original requester their item was approved/rejected.
 *
 * Category is "approvals", so it honours each recipient's per-channel preference
 * (in-app by default; email if they opted in). EVERYTHING here is best-effort:
 * a notification failure must never break approval creation/decisioning, so the
 * whole body is wrapped and errors are swallowed (logged). Runs on the acting
 * transaction's client — in-app writes are atomic with the approval change.
 */
"use strict";

const { logger } = require("../../config/logger");

/** "invoice:9f8c…" → "invoice 9f8c" (type + short id). */
function shortEntity(entityRef) {
  const [type, id] = String(entityRef || "").split(":");
  if (!type) return "an item";
  const label = type.replace(/_/g, " ");
  const shortId = id && id.length > 8 ? id.slice(0, 8) : id;
  return shortId ? `${label} ${shortId}` : label;
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function fmtAmount(x) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${new Intl.NumberFormat("en-US").format(n)} XAF`;
}

/** Notify the approvers for a freshly-opened step. `excludeUserId` drops the
 *  person who just triggered/advanced it (no "approve your own action" noise). */
async function onTaskOpened(client, { entityRef, roleId, amountXaf = null, excludeUserId = null }) {
  try {
    if (!roleId) return 0;
    const repo = require("../../modules/notification/notification.repo");
    const service = require("../../modules/notification/notification.service");
    const recipients = await repo.roleRecipients(client, roleId);
    const amt = fmtAmount(amountXaf);
    const body = `${cap(shortEntity(entityRef))} is awaiting your approval${amt ? ` — ${amt}` : ""}.`;
    let sent = 0;
    for (const userId of recipients) {
      if (excludeUserId && userId === excludeUserId) continue;
      await service.notify(client, {
        userId,
        eventTypeKey: "approval.pending",
        title: "Approval needed",
        body,
        entityRef,
        category: "approvals",
        priority: "NORMAL",
      });
      sent += 1;
    }
    return sent;
  } catch (err) {
    logger.warn({ err: err.message, entityRef }, "[notify-approvals] onTaskOpened failed");
    return 0;
  }
}

/** Notify the original requester of the final decision. */
async function onOutcome(client, { entityRef, approved, actorUserId = null }) {
  try {
    const repo = require("../../modules/notification/notification.repo");
    const service = require("../../modules/notification/notification.service");
    const requester = await repo.requesterFor(client, entityRef);
    if (!requester || requester === actorUserId) return 0; // don't ping the actor about their own decision
    await service.notify(client, {
      userId: requester,
      eventTypeKey: approved ? "approval.approved" : "approval.rejected",
      title: approved ? "Approved" : "Not approved",
      body: `Your ${shortEntity(entityRef)} was ${approved ? "approved" : "rejected"}.`,
      entityRef,
      category: "approvals",
      priority: approved ? "NORMAL" : "HIGH",
    });
    return 1;
  } catch (err) {
    logger.warn({ err: err.message, entityRef }, "[notify-approvals] onOutcome failed");
    return 0;
  }
}

module.exports = { onTaskOpened, onOutcome };
