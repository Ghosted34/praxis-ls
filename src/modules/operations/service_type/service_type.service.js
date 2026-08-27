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
const { atomically } = require("../../../shared/db/tx");
const repo = require("./service_type.repo");
const events = require("./service_type.events");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const opsRef = require("../../../services/documents/operation-reference");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "service_type", events });

/**
 * The operation-reference code, and the two rules that make it trustworthy.
 *
 * ONCE USED, IT IS HISTORY. A file's reference is a string stored on the row —
 * `SL7Z3K9QW2M4XBSM` — and it has been printed on a transit order and quoted to
 * a client. Changing this service type's code later cannot rewrite those, and
 * must not: the only thing it would achieve is two codes meaning "sea import",
 * with no record of when the meaning changed. So the moment any dossier of this
 * type carries a reference, the code is frozen. Renaming the SERVICE stays free
 * — that is what `name_fr`/`name_en` are for, and it is why the code is a
 * separate column rather than something derived from the name.
 *
 * `OP` IS RESERVED. It is what a file with no service type uses, so handing it
 * to a real one would make "unclassified" and that service indistinguishable in
 * every reference either ever issues.
 */
async function assertCodeAssignable(client, id, code) {
  if (code === opsRef.GENERIC_SERVICE_CODE) {
    throw new AppError(
      "CODE_RESERVED",
      `"${opsRef.GENERIC_SERVICE_CODE}" is reserved for files with no service type`,
      422,
      { ops_reference_code: ["reserved"] },
    );
  }
  if (!id) return;
  const { rows } = await client.query(
    "SELECT ops_reference_code FROM service_type WHERE service_type_id = $1",
    [id],
  );
  const current = rows[0] ? rows[0].ops_reference_code : null;
  if (!current || current === code) return;
  // `dossier_visible`: a wizard draft carries a `DRAFT-` placeholder rather
  // than a reference built from this code, so it must not freeze it.
  const used = await client.query(
    "SELECT 1 FROM dossier_visible WHERE service_type_id = $1 LIMIT 1",
    [id],
  );
  if (used.rowCount) {
    throw new AppError(
      "CODE_IN_USE",
      `Operation files already carry the code "${current}". It cannot be changed without renaming references that have been issued.`,
      422,
      { ops_reference_code: ["already used by existing operation files"] },
    );
  }
}

/**
 * Run `fn`, turning a code collision into a field error the form can show.
 *
 * The unique index stays the guard — a pre-`SELECT` would be a check-then-act
 * race with any other admin saving at the same moment. This only decides how
 * the answer is PHRASED: `ux_service_type_ops_reference_code` reaching the
 * generic error handler is a bare 409 "a record with these values already
 * exists", which does not tell the person which of the four fields they just
 * edited is the problem.
 *
 * `OPS_CODE_TAKEN` rather than the `CODE_TAKEN` the platform plan and role
 * services raise: those are 409s, and one error code answering with two
 * different statuses is exactly what doc/ERROR_CODES.md exists to surface.
 */
async function codeConflictAsField(fn, code) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.code === "23505" && /ops_reference_code/.test(String(err.constraint || ""))) {
      throw new AppError(
        "OPS_CODE_TAKEN",
        `Another service type already uses the code "${code}"`,
        422,
        { ops_reference_code: ["already in use"] },
      );
    }
    throw err;
  }
}

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
    if (args.data.ops_reference_code) await assertCodeAssignable(client, null, args.data.ops_reference_code);
    return atomically(client, async () => {
      const row = await codeConflictAsField(
        () => base.create(client, args),
        args.data.ops_reference_code,
      );
      // Assigned NOW rather than on the first dossier of this type, so the code
      // is visible on the Service Types screen from the moment the service
      // exists — and inside the same transaction, so a service type never
      // commits half-configured. `serviceTypeCode` derives it from the key,
      // walks the fallbacks on collision and persists once: the same path an
      // older row takes lazily, so there is one algorithm rather than two that
      // can disagree.
      if (row.ops_reference_code) return row;
      return { ...row, ops_reference_code: await opsRef.serviceTypeCode(client, row.service_type_id) };
    });
  },

  /**
   * The kit's update, plus the code's own rules.
   *
   * Overridden rather than left to `makeService` because "may this column
   * change?" is a question only this module can answer — it depends on whether
   * a dossier has already been given a reference built from the value.
   */
  async update(client, args) {
    if (args.patch && args.patch.ops_reference_code) {
      await assertCodeAssignable(client, args.id, args.patch.ops_reference_code);
    }
    return codeConflictAsField(
      () => base.update(client, args),
      args.patch && args.patch.ops_reference_code,
    );
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
   *
   * Archive ALSO auto-unpublishes any web profile row in the SAME transaction
   * (guide §4.2 rule 2). A web page for an archived service is a leak by
   * construction: the service_type.is_active check the public list applies
   * would catch it anyway, but doing it here makes the on-disk state honest
   * with itself and means reactivation never auto-republishes — the tenant
   * walks the checklist again.
   */
  async archive(client, { id, actor = {} }) {
    await assertNotSystem(client, id, "archived");
    const webHook = require("../service_type_web/service_type_web.service");
    return atomically(client, async () => {
      const row = await repo.update(client, id, { is_active: false });
      const unhooked = await webHook.autoUnpublishForArchive(client, id);
      await audit(client, {
        actorUserId: actor.user_id || null,
        action: events.ARCHIVED,
        moduleKey: events.MODULE,
        entityRef: "service_type:" + id,
        after: { ...row, web_unpublished: Boolean(unhooked) },
      });
      return row;
    });
  },
};
