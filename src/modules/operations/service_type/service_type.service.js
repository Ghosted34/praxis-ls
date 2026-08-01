/**
 * Service taxonomy (MOD-29, PRD/transcript §11.3 "services as DATA, not code").
 *
 * Until 2026-08-01 this table had NO module at all — it was referenced by ten
 * others but the only thing that ever inserted a row was the sandbox seed, so a
 * freshly provisioned tenant could not define its own services, and therefore
 * could not have milestone templates either (templates hang off a service type).
 * That made self-service onboarding impossible. This is that gap closed.
 *
 * SQL in the repo; this layer owns the rules.
 */
"use strict";
const { makeService } = require("../../../shared/crud/resource");
const repo = require("./service_type.repo");
const events = require("./service_type.events");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "service_type", events });

/** Rows shipped by provisioning are protected: renaming is fine, removing isn't. */
async function assertNotSystem(client, id, verb) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Service type not found", 404);
  if (row.is_system) throw new AppError("SYSTEM_RECORD", `A system service type cannot be ${verb}`, 422);
  return row;
}

module.exports = {
  ...base,

  async create(client, args) {
    // citext UNIQUE on `key` means the DB is the real guard; this turns the
    // raw 23505 into something the form can show against the right field.
    const existing = await client.query("SELECT 1 FROM service_type WHERE key = $1", [args.data.key]);
    if (existing.rowCount) {
      throw new AppError("DUPLICATE_KEY", `Service type '${args.data.key}' already exists`, 422, { key: ["already in use"] });
    }
    return base.create(client, args);
  },

  /**
   * Archive rather than delete.
   *
   * `dossier.service_type_id` is a plain FK with no ON DELETE, so removing a
   * service type that any dossier has ever used would fail on the constraint —
   * and if it didn't, it would erase the classification of historical files.
   * Deactivating hides it from pickers while every existing dossier keeps its
   * meaning, which is also why `list` can include inactive rows on request.
   */
  async archive(client, { id, actor = {} }) {
    await assertNotSystem(client, id, "archived");
    const row = await repo.update(client, id, { is_active: false });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.ARCHIVED,
      moduleKey: events.MODULE,
      entityRef: "service_type:" + id,
      after: row,
    });
    return row;
  },
};
