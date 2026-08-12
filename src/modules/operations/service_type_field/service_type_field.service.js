/**
 * Editing the shipment/service-detail form of a service type.
 *
 * This is the config side of the SSDC: the screen where a manager decides that
 * Sea Freight Import asks for a Bill of Lading and Warehousing asks for a
 * bonded status. It deliberately mirrors how milestone templates already work
 * on the same page, because they are the same shape of problem and a user who
 * has learned one should not have to learn the other.
 *
 * THE VERSIONING RULE, and why it is not negotiable.
 *
 *   A PUBLISHED (active) version is immutable. To change the form you clone it
 *   into a draft, edit the draft, and publish — which supersedes the old
 *   version without touching it.
 *
 * The alternative — editing the live form in place — breaks quietly and badly.
 * Two hundred open files were created against the old form; adding a required
 * field to it makes all of them retroactively invalid, renaming a key orphans
 * every value already captured under the old name, and a locked invoice ends up
 * citing a field that no longer exists. Versions cost one extra click and make
 * all three impossible.
 *
 * SYSTEM FIELDS (Q9). Rows we ship are marked `is_system`. A tenant may
 * relabel, reorder, re-scope, make required, mark client-visible or DEACTIVATE
 * them — everything that makes the form theirs. They may not delete one or
 * change its `key`, because the key is what values are stored under and what a
 * future upgrade matches on. Their own fields carry no such restriction.
 */
"use strict";

const repo = require("../shipment_details/shipment_details.repo");
const events = require("./service_type_field.events");
const { audit, emitEvent, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

async function assertServiceType(client, serviceTypeId) {
  const { rows } = await client.query(
    "SELECT service_type_id, key, name_fr, name_en, captures_containers, container_detail_mode FROM service_type WHERE service_type_id = $1",
    [serviceTypeId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Service type not found", 404);
  return rows[0];
}

/** A set that belongs to this service type, or 404 — never trust the id pair
 *  from the URL to be consistent. */
async function assertSet(client, serviceTypeId, fieldSetId) {
  const set = await repo.fieldSetById(client, fieldSetId);
  if (!set || set.service_type_id !== serviceTypeId) {
    throw new AppError("NOT_FOUND", "Field set not found on this service type", 404);
  }
  return set;
}

/** Published versions are read-only. This is the guard behind that. */
function assertDraft(set) {
  if (set.is_active) {
    throw new AppError(
      "PUBLISHED_SET",
      "This version is live and cannot be edited. Create a new version from it, edit that, then publish.",
      422,
    );
  }
  return set;
}

/* ── Reads ─────────────────────────────────────────────────────────────────── */

async function list(client, serviceTypeId) {
  await assertServiceType(client, serviceTypeId);
  return repo.fieldSetsFor(client, serviceTypeId);
}

async function get(client, serviceTypeId, fieldSetId) {
  await assertServiceType(client, serviceTypeId);
  const set = await assertSet(client, serviceTypeId, fieldSetId);
  const fields = await repo.fieldsOf(client, fieldSetId);
  return { ...set, fields, in_use: await repo.fieldSetInUse(client, fieldSetId) };
}

/* ── Versions ──────────────────────────────────────────────────────────────── */

/**
 * Start a new draft version.
 *
 * With `from` (or by default, from the active version if there is one) it is a
 * CLONE — which is what "edit the live form" actually means here. Without one
 * it is an empty set, for a service type being defined from scratch.
 */
async function createVersion(client, { serviceTypeId, from = null, name = null, actor = {} }) {
  const st = await assertServiceType(client, serviceTypeId);
  await client.query("BEGIN");
  try {
    const source = from
      ? await assertSet(client, serviceTypeId, from)
      : await repo.activeFieldSet(client, serviceTypeId);

    const version = await repo.nextVersion(client, serviceTypeId);
    const set = await repo.insertFieldSet(client, {
      service_type_id: serviceTypeId,
      version,
      is_active: false,
      name: name || `${st.name_fr} — v${version}`,
      source_version: source ? source.version : null,
      // DATA 2.4: identity lives in the LIVE schema and this write may land in
      // SANDBOX, where the user does not exist. Resolve it to null there rather
      // than recording an id that points at nothing.
      created_by: await resolveActorId(client, actor.user_id),
    });
    if (source) await repo.copyFields(client, source.service_type_field_set_id, set.service_type_field_set_id);

    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.SET_CREATED,
      moduleKey: events.MODULE,
      entityRef: "service_type:" + serviceTypeId,
      after: { version, cloned_from: source ? source.version : null },
    });
    await client.query("COMMIT");
    return get(client, serviceTypeId, set.service_type_field_set_id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/**
 * Publish a draft: it becomes the form every NEW file of this service type is
 * created against. Existing files keep the version they were created under.
 */
async function publish(client, { serviceTypeId, fieldSetId, actor = {} }) {
  await assertServiceType(client, serviceTypeId);
  const set = await assertSet(client, serviceTypeId, fieldSetId);
  if (set.is_active) return set;

  const fields = await repo.fieldsOf(client, fieldSetId, { activeOnly: true });
  if (!fields.length) {
    throw new AppError(
      "EMPTY_SET",
      "A version with no active fields cannot be published — a file created against it would ask for nothing.",
      422,
    );
  }

  await client.query("BEGIN");
  try {
    const row = await repo.activateFieldSet(client, serviceTypeId, fieldSetId);
    await emitEvent(client, {
      eventTypeKey: events.SET_PUBLISHED,
      moduleKey: events.MODULE,
      entityRef: "service_type:" + serviceTypeId,
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.SET_PUBLISHED,
      moduleKey: events.MODULE,
      entityRef: "service_type:" + serviceTypeId,
      after: { version: row.version, fields: fields.length },
    });
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/* ── Fields ────────────────────────────────────────────────────────────────── */

/**
 * A field's key must be unique in its set, snake_case, and — when it binds to a
 * dossier column — that column must not already be taken by another field of
 * the same set. Two fields writing `bl_mawb` would silently overwrite each
 * other on every save, which is the kind of bug that is invisible until an
 * invoice prints the wrong reference.
 */
async function assertBindable(client, fieldSetId, { column_name }, excludeFieldId = null) {
  if (!column_name) return;
  const { rows } = await client.query(
    `SELECT key FROM service_type_field
      WHERE service_type_field_set_id = $1 AND column_name = $2
        AND ($3::uuid IS NULL OR service_type_field_id <> $3)`,
    [fieldSetId, column_name, excludeFieldId],
  );
  if (rows[0]) {
    throw new AppError(
      "COLUMN_TAKEN",
      `"${rows[0].key}" already stores into ${column_name} on this version — two fields cannot share one column.`,
      422,
      { column_name: [`already used by "${rows[0].key}"`] },
    );
  }
}

async function addField(client, { serviceTypeId, fieldSetId, data, actor = {} }) {
  await assertServiceType(client, serviceTypeId);
  const set = assertDraft(await assertSet(client, serviceTypeId, fieldSetId));
  await assertBindable(client, fieldSetId, data);

  const existing = await repo.fieldsOf(client, fieldSetId);
  if (existing.some((f) => f.key === data.key)) {
    throw new AppError("DUPLICATE_KEY", `"${data.key}" already exists on this version`, 422, {
      key: ["already used on this version"],
    });
  }
  // Land a new field at the end of its group unless the caller placed it.
  if (data.seq === undefined) {
    const inGroup = existing.filter((f) => f.group_code === (data.group_code || "DETAILS"));
    data.seq = inGroup.length ? Math.max(...inGroup.map((f) => Number(f.seq))) + 10 : 10;
  }
  const row = await repo.insertField(client, fieldSetId, data);
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: events.FIELD_ADDED,
    moduleKey: events.MODULE,
    entityRef: "service_type_field_set:" + set.service_type_field_set_id,
    after: row,
  });
  return row;
}

async function updateField(client, { serviceTypeId, fieldSetId, fieldId, patch, actor = {} }) {
  await assertServiceType(client, serviceTypeId);
  assertDraft(await assertSet(client, serviceTypeId, fieldSetId));
  const before = await repo.getField(client, fieldId);
  if (!before || before.service_type_field_set_id !== fieldSetId) {
    throw new AppError("NOT_FOUND", "Field not found on this version", 404);
  }
  // The key is the storage address of every value already captured under it.
  if (patch.key !== undefined && patch.key !== before.key) {
    throw new AppError(
      "KEY_IMMUTABLE",
      "A field's key cannot be changed — values are stored under it. Add a new field and retire this one.",
      422,
      { key: ["immutable"] },
    );
  }
  if (patch.column_name !== undefined && patch.column_name !== before.column_name) {
    await assertBindable(client, fieldSetId, patch, fieldId);
  }
  const row = await repo.updateField(client, fieldId, patch);
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: events.FIELD_UPDATED,
    moduleKey: events.MODULE,
    entityRef: "service_type_field_set:" + fieldSetId,
    before,
    after: row,
  });
  return row;
}

/**
 * Remove a field. A tenant's own field is deleted; one we shipped is
 * DEACTIVATED instead — see the header. Either way values already captured
 * under its key are left in `details_json` untouched, so nothing a user typed
 * is destroyed by a change to the form.
 */
async function removeField(client, { serviceTypeId, fieldSetId, fieldId, actor = {} }) {
  await assertServiceType(client, serviceTypeId);
  assertDraft(await assertSet(client, serviceTypeId, fieldSetId));
  const before = await repo.getField(client, fieldId);
  if (!before || before.service_type_field_set_id !== fieldSetId) {
    throw new AppError("NOT_FOUND", "Field not found on this version", 404);
  }

  const row = before.is_system
    ? await repo.updateField(client, fieldId, { is_active: false })
    : await repo.deleteField(client, fieldId);

  await audit(client, {
    actorUserId: actor.user_id || null,
    action: events.FIELD_REMOVED,
    moduleKey: events.MODULE,
    entityRef: "service_type_field_set:" + fieldSetId,
    before,
    after: before.is_system ? row : null,
  });
  return { removed: !before.is_system, deactivated: before.is_system, field: row };
}

/* ── Equipment capture ─────────────────────────────────────────────────────── */

/**
 * The container toggle, on the service type.
 *
 * Two independent decisions, and the UI is required to explain both because
 * neither is guessable from its name:
 *
 *   captures_containers — does a file of this service type track equipment at
 *   all? Off means no container table anywhere on the file. On means the file
 *   carries the boxes it moves.
 *
 *   container_detail_mode — GROUPED records "3 × 40' HC" and is enough for
 *   everything charged per type or per TEU. PER_BOX additionally records each
 *   box's number, seal and dates, which is what makes anything charged per
 *   container per day exact rather than estimated. PER_BOX never blocks a save:
 *   the counts are still entered first and the numbers filled in when the BL
 *   arrives.
 */
async function configureContainers(client, { serviceTypeId, capturesContainers, detailMode, actor = {} }) {
  const before = await assertServiceType(client, serviceTypeId);
  const { rows } = await client.query(
    `UPDATE service_type
        SET captures_containers = COALESCE($2, captures_containers),
            container_detail_mode = COALESCE($3, container_detail_mode)
      WHERE service_type_id = $1
      RETURNING service_type_id, key, captures_containers, container_detail_mode`,
    [serviceTypeId, capturesContainers ?? null, detailMode ?? null],
  );
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: events.CONTAINERS_CONFIGURED,
    moduleKey: events.MODULE,
    entityRef: "service_type:" + serviceTypeId,
    before: { captures_containers: before.captures_containers, container_detail_mode: before.container_detail_mode },
    after: rows[0],
  });
  return rows[0];
}

module.exports = {
  list,
  get,
  createVersion,
  publish,
  addField,
  updateField,
  removeField,
  configureContainers,
};
