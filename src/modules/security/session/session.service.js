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
  if (!killed) return { killed: false, session_id: id }; // already killed — idempotent, not an error

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
  return { killed: true, session_id: id };
}


/** Revoke ALL of the caller's own sessions (log out everywhere). */
async function killAllMine(client, actor) {
  const ids = await repo.killAllForUser(client, actor.user_id, actor.user_id);
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await sessionStore.removeSession(id, actor.user_id);
  }
  await identityCache.invalidateUser(actor.user_id);
  await audit(client, { actorUserId: actor.user_id, action: events.KILLED, moduleKey: events.MODULE, entityRef: "app_user:" + actor.user_id, after: { revoked: ids.length } });
  return { killed: ids.length };
}

module.exports = { ...crud, mine, kill, killAllMine };
