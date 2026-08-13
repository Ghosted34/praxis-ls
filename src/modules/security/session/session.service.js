/**
 * Generic CRUD (Super Admin / anyone granted MOD-68) plus two actions the
 * doc's RBAC journey calls for that generic CRUD doesn't cover on its own:
 *   - mine: "Everyone... only their own sessions" — self-scoped, no grant
 *     needed beyond being authenticated.
 *   - kill: "Super Admin: sees and kills any session" / "Everyone: manages
 *     own devices" — self-kill always allowed; killing someone else's
 *     session requires the MOD-68 can_update grant (or CEO bypass). This is
 *     the first real consumer of the "own vs all" distinction the
 *     `scope`/`user_scope` tables model — see doc/WORK_DONE.md's note on
 *     record-level scope for why this is handled ad hoc here rather than
 *     through a generic scope filter (that generalization is a bigger,
 *     separate piece of work; this is the concrete case that exists today).
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const identityCache = require("../../../shared/cache/identity-cache");
const sessionStore = require("../../../shared/cache/session-store");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./session.repo");
const events = require("./session.events");

const crud = makeService({ repo, moduleKey: events.MODULE, entity: "session", events });

function mine(client, actor) {
  return repo.listForUser(client, actor.user_id);
}

async function kill(client, { id, actor }) {
  const target = await repo.findById(client, id);
  if (!target) throw new AppError("NOT_FOUND", "Session not found", 404);

  const isSelf = target.user_id === actor.user_id;
  if (!isSelf && !actor.is_ceo) {
    const grants = await identityCache.getGrants(client, {
      role_ids: actor.role_ids,
      module: events.MODULE,
    });
    const allowed = grants.some((g) => g.can_update === true);
    if (!allowed) {
      throw new AppError("PERMISSION_DENIED", "No permission to kill another user's session", 403);
    }
  }

  const killed = await repo.kill(client, id, actor.user_id);
  if (!killed) {
    // Already killed — idempotent, not an error. Return the envelope shape
    // shared/crud/with-result.js understands so the controller can send a
    // 200 with { changed:false } that the client renders as "already revoked"
    // instead of a silent no-op.
    return { changed: false, message: "Session was already revoked", data: { session_id: id } };
  }

  await sessionStore.removeSession(id, killed.user_id);
  await identityCache.invalidateUser(killed.user_id);
  await emitEvent(client, {
    eventTypeKey: events.KILLED,
    moduleKey: events.MODULE,
    entityRef: `session:${id}`,
    actorUserId: actor.user_id,
  });
  await audit(client, {
    actorUserId: actor.user_id,
    action: events.KILLED,
    moduleKey: events.MODULE,
    entityRef: `session:${id}`,
    before: target,
  });
  return { changed: true, data: { session_id: id } };
}


/** Revoke ALL of the caller's own sessions (log out everywhere). */
async function killAllMine(client, actor) {
  const ids = await repo.killAllForUser(client, actor.user_id, actor.user_id);
  for (const id of ids) {
    await sessionStore.removeSession(id, actor.user_id);
  }
  await identityCache.invalidateUser(actor.user_id);
  await audit(client, { actorUserId: actor.user_id, action: events.KILLED, moduleKey: events.MODULE, entityRef: "app_user:" + actor.user_id, after: { revoked: ids.length } });
  // If there were no live sessions to kill (only the current one, and that
  // one is not in the list because the caller is still using it), the row on
  // screen doesn't need to change and the user is told "nothing to revoke"
  // instead of a fresh-looking success.
  if (ids.length === 0) {
    return { changed: false, message: "No other sessions to revoke.", data: { killed: 0 } };
  }
  return { changed: true, data: { killed: ids.length } };
}

/**
 * DELETE refuses (audit finding A5).
 *
 * `user_session` has no active column, so the shared archive wrote a
 * soft_delete row and left the session untouched — the API answered
 * `{ archived: true }` and the session stayed live. An admin who believed they
 * had removed someone's session had not, which on a security screen is worse
 * than an error.
 *
 * Hard-deleting is not the answer either: the row is the record that a session
 * existed, and revoking is what the caller actually wants. `/sessions/:id/kill`
 * does that — it revokes in the store and in Redis. So say so, with 405.
 */
async function archive() {
  throw new AppError(
    "METHOD_NOT_ALLOWED",
    "Sessions aren't deleted — revoke it with POST /sessions/:id/kill, which ends the session everywhere.",
    405,
  );
}

module.exports = { ...crud, archive, mine, kill, killAllMine };
