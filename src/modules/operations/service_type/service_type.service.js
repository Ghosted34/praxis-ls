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
  // Same `repo.get` → `repo.findById` fix as service_type_360.service.js — this
  // repo inherits only the factory's `findById`. Not yet seen in production
  // because it is on the delete/archive path rather than a page load, but it
  // would have thrown the moment anyone tried to remove a service type.
  const row = await repo.findById(client, id);
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
   * Set a dictionary line's tier on this service (the tier matrix on ST-360).
   *
   * BASIC ⊆ ADVANCED ⊆ FULL, so `tier` is the LOWEST bundle the line appears
   * in — moving a line to BASIC makes every ADVANCED and FULL costing pull it
   * too. That is why this is one control and not three checkboxes.
   *
   * The item must exist and be operational: an overhead line (office rent,
   * salaries) is NON_OPERATIONAL and has no business on a service's pick-list,
   * and silently accepting it would put it on every costing sheet of that type.
   */
  async setDictionaryTier(client, { id, dictionaryItemId, tier, actor = {} }) {
    const st = await repo.findById(client, id);
    if (!st) throw new AppError("NOT_FOUND", "Service type not found", 404);

    const { rows } = await client.query(
      "SELECT dictionary_item_id, code, label_en, label_fr, applicability_mode, is_active " +
        "FROM dictionary_item WHERE dictionary_item_id = $1",
      [dictionaryItemId],
    );
    const item = rows[0];
    if (!item) throw new AppError("NOT_FOUND", "Dictionary item not found", 404);
    if (item.applicability_mode === "NON_OPERATIONAL") {
      throw new AppError(
        "NOT_OPERATIONAL",
        "This line is non-operational (an overhead) and cannot be scoped to a service",
        422,
        { dictionary_item_id: ["non-operational lines never surface on a dossier"] },
      );
    }

    const link = await repo.setDictionaryTier(client, id, dictionaryItemId, tier);
    await repo.syncServiceTypeKey(client, dictionaryItemId);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.TIER_SET,
      moduleKey: events.MODULE,
      entityRef: "service_type:" + id,
      after: { dictionary_item_id: dictionaryItemId, code: item.code, tier },
    });
    return link;
  },

  /**
   * Unlink a dictionary line from this service. Not a delete of the line — the
   * catalogue row survives and stays available to every other service; only the
   * mapping goes.
   */
  async removeDictionaryTier(client, { id, dictionaryItemId, actor = {} }) {
    const st = await repo.findById(client, id);
    if (!st) throw new AppError("NOT_FOUND", "Service type not found", 404);
    const removed = await repo.removeDictionaryTier(client, id, dictionaryItemId);
    if (!removed) throw new AppError("NOT_FOUND", "That line is not scoped to this service", 404);
    await repo.syncServiceTypeKey(client, dictionaryItemId);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.TIER_REMOVED,
      moduleKey: events.MODULE,
      entityRef: "service_type:" + id,
      before: removed,
    });
    return removed;
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
