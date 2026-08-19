/**
 * Who may work a mailbox, and what they may do with it.
 *
 * ── WHY READ AND SEND ARE SEPARATE RIGHTS ───────────────────────────────────
 *
 * A junior clerk should be able to read billing@ and see what a client was told,
 * without being able to put the company's name on an outbound message. One
 * "is a member" boolean cannot express that, so membership carries a role:
 *
 *   VIEWER   read the mailbox.
 *   AGENT    read, and send as the mailbox.
 *   MANAGER  everything an AGENT can, plus manage members and edit the
 *            connection — so a team lead can add a colleague without an admin.
 *
 * A PERSONAL mailbox has no members. Its owner is the access, which is why every
 * predicate here short-circuits on ownership before it looks at grants.
 *
 * ── THIS IS NOT A REPLACEMENT FOR RBAC ──────────────────────────────────────
 *
 * MOD-72 decides whether you may touch mail at all; this decides which mailboxes.
 * Both apply, and the route gate runs first. A user with no MOD-72 grant never
 * reaches these functions.
 *
 * ── LIVE IN ITS OWN FILE TO AVOID A CYCLE ───────────────────────────────────
 *
 * mail.service (the engine) has to ask "may this person send as this mailbox?"
 * before it sends. mailbox.service (administration) has to ask the engine to test
 * a connection when it creates one. Putting the predicates here — depending only
 * on the repo — keeps that from becoming a require cycle.
 */
"use strict";

const repo = require("./mailbox.repo");
const { AppError } = require("../../../utils/errors");
const { audit, emitEvent, resolveActorId } = require("../../../shared/events/emit");

const MODULE = "MOD-72";
const ROLES = ["VIEWER", "AGENT", "MANAGER"];
/** Read < send < administer. Compared by index, so order is the meaning. */
const RANK = { VIEWER: 1, AGENT: 2, MANAGER: 3 };

const ref = (id) => `email_connection:${id}`;

/**
 * What this user may do with this mailbox, as one word.
 * Returns null when they have no access at all — callers turn that into a 403 or
 * a filtered-out row depending on whether the mailbox was named or listed.
 */
async function roleFor(client, connectionId, userId) {
  if (!userId) return null;
  const conn = await repo.getConnection(client, connectionId);
  if (!conn) return null;
  if (conn.status === "ARCHIVED") return null;
  if (conn.kind === "PERSONAL") return conn.owner_user_id === userId ? "OWNER" : null;
  // The owner of a shared mailbox administers it even without a grant row — the
  // backfill in 10725 writes one, but a mailbox created before that, or one whose
  // grant was revoked by mistake, must not lock its own creator out.
  if (conn.owner_user_id === userId) return "MANAGER";
  const m = await repo.liveMember(client, connectionId, userId);
  return m ? m.member_role : null;
}

const rank = (role) => (role === "OWNER" ? 4 : RANK[role] || 0);

async function assertAtLeast(client, connectionId, userId, needed, what) {
  const role = await roleFor(client, connectionId, userId);
  if (rank(role) < rank(needed)) {
    throw new AppError("MAILBOX_FORBIDDEN", `You do not have permission to ${what} on this mailbox.`, 403);
  }
  return role;
}

const assertCanRead = (client, connectionId, userId) =>
  assertAtLeast(client, connectionId, userId, "VIEWER", "read mail");
const assertCanSend = (client, connectionId, userId) =>
  assertAtLeast(client, connectionId, userId, "AGENT", "send mail");
const assertCanManage = (client, connectionId, userId) =>
  assertAtLeast(client, connectionId, userId, "MANAGER", "manage members or settings");

const listMembers = (client, connectionId, opts) => repo.listMembers(client, connectionId, opts);

/**
 * Give someone access. Idempotent on role: granting an existing member a role
 * they already hold is a no-op rather than an error, because the UI's employee
 * picker cannot know what every colleague already has.
 */
async function grant(client, { connectionId, userId, role = "AGENT", actor = {} }) {
  if (!ROLES.includes(role)) throw new AppError("VALIDATION_ERROR", `role must be one of ${ROLES.join(", ")}`, 422);
  const conn = await repo.getConnection(client, connectionId);
  if (!conn) throw new AppError("NOT_FOUND", "mailbox not found", 404);
  if (conn.kind === "PERSONAL") {
    throw new AppError(
      "PERSONAL_MAILBOX",
      "A personal mailbox cannot be shared. Hand it over to a team first, which converts it to a shared mailbox and records who did it.",
      422,
    );
  }
  const existing = await repo.liveMember(client, connectionId, userId);
  if (existing && existing.member_role === role) return existing;

  // resolveActorId, not the raw id (DATA 2.4). Identity is pinned to the LIVE
  // schema while business writes go wherever the request selected, so storing an
  // unresolved user id beside sandbox data raises 23503 and fails the grant.
  const grantedBy = await resolveActorId(client, actor.user_id);
  const row = existing
    ? await repo.setMemberRole(client, connectionId, userId, role)
    : await repo.insertMember(client, {
        email_connection_id: connectionId,
        user_id: userId,
        member_role: role,
        granted_by: grantedBy,
      });

  await repo.recordAccessAudit(client, {
    email_connection_id: connectionId,
    action: existing ? "ROLE_CHANGED" : "GRANTED",
    subject_user_id: userId,
    actor_user_id: actor.user_id || null,
    detail: { role, previous_role: existing ? existing.member_role : null },
  });
  await emitEvent(client, {
    eventTypeKey: "mailbox.access.granted", moduleKey: MODULE, entityRef: ref(connectionId),
    actorUserId: actor.user_id || null,
    payload: { user_id: userId, role, mailbox: conn.email_address },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mailbox.access.granted",
    moduleKey: MODULE, entityRef: ref(connectionId),
    after: { user_id: userId, role }, isSensitive: true,
  });
  return row;
}

async function revoke(client, { connectionId, userId, actor = {} }) {
  const conn = await repo.getConnection(client, connectionId);
  if (!conn) throw new AppError("NOT_FOUND", "mailbox not found", 404);
  const row = await repo.revokeMember(client, connectionId, userId, await resolveActorId(client, actor.user_id));
  if (!row) return { revoked: false };

  await repo.recordAccessAudit(client, {
    email_connection_id: connectionId, action: "REVOKED",
    subject_user_id: userId, actor_user_id: actor.user_id || null,
    detail: { previous_role: row.member_role },
  });
  await emitEvent(client, {
    eventTypeKey: "mailbox.access.revoked", moduleKey: MODULE, entityRef: ref(connectionId),
    actorUserId: actor.user_id || null,
    payload: { user_id: userId, mailbox: conn.email_address },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mailbox.access.revoked",
    moduleKey: MODULE, entityRef: ref(connectionId),
    before: { user_id: userId, role: row.member_role }, isSensitive: true,
  });
  return { revoked: true, member_role: row.member_role };
}

/**
 * Record that a message went out AS a shared mailbox, and who actually sent it.
 *
 * The From header says billing@; without this row nothing says which human
 * pressed send, and a team address becomes an accountability hole. Best-effort
 * on purpose — an audit write must never be the reason a client does not get
 * their invoice.
 */
async function recordSentAs(client, { connectionId, actor = {}, to, subject, sendPoint = null }) {
  try {
    await repo.recordAccessAudit(client, {
      email_connection_id: connectionId, action: "SENT_AS",
      subject_user_id: actor.user_id || null, actor_user_id: actor.user_id || null,
      detail: { to: Array.isArray(to) ? to.join(", ") : to || null, subject: subject || null, send_point: sendPoint },
    });
  } catch (err) {
    /* @silent:storage the send succeeded; losing its audit row must not fail it */
    const { logger } = require("../../../config/logger");
    logger.warn({ err, connectionId }, "[mail] sent-as audit row not written");
  }
}

const listAudit = (client, opts) => repo.listAccessAudit(client, opts);

module.exports = {
  MODULE, ROLES, roleFor, rank,
  assertCanRead, assertCanSend, assertCanManage,
  listMembers, grant, revoke, recordSentAs, listAudit,
};
