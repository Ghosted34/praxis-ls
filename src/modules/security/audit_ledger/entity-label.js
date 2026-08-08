"use strict";

/**
 * entity_ref type -> where to find a human label for it, for the audit
 * detail modal's "Entity" row (today: raw `corporate_entity:fc3f680f-…`).
 *
 * Deliberately NOT sourced from shared/crud/entity-registry.js. That registry
 * keys on the string each module passes to `makeService({ entity })`, which
 * its own header comment documents as unreliable for this exact purpose:
 * iam_role.service.js passes entity:"iam_role" for table `role`, and
 * corporate_entity.service.js is hand-rolled — it never calls makeService at
 * all (its own `ref()` hardcodes the "corporate_entity:" prefix directly), so
 * it has no entry in that registry whatsoever despite being the entity type
 * in the screenshot that started this. This map keys on the REAL entity_ref
 * prefix each module actually writes — verified per entry against the module
 * that emits it — rather than inheriting that registry's guesswork.
 *
 * Start small and exact rather than wrong-by-default for the ~90 entity
 * types this doesn't cover yet: an unlisted type just falls back to showing
 * the raw entity_ref, same as today. Add a line here as each type comes up.
 *
 * `table`/`pk`/`column` are never built from request input — same trust
 * boundary as audit_ledger.repo.js's rowExists/reactivate (see the comment
 * there) — so interpolating them directly into SQL is safe; only the id
 * value is a query parameter.
 *
 * `schema` picks which connection resolves the row:
 *   "identity"  always the live/identity schema (req.identityDb) — app_user,
 *               role and the rest of RBAC live there regardless of LIVE/TEST
 *               (see middleware/tenant-context.js).
 *   "tenant"    the caller's current env (req.tenantDb) — ordinary business
 *               tables, sandboxed separately from live.
 */
const ENTITY_LABEL = {
  app_user: { schema: "identity", table: "app_user", pk: "user_id", column: "full_name" },
  corporate_entity: { schema: "tenant", table: "corporate_entity", pk: "entity_id", column: "legal_name" },
  vacancy: { schema: "tenant", table: "vacancy", pk: "vacancy_id", column: "title" },
};

function parseRef(entityRef) {
  if (!entityRef) return null;
  const s = String(entityRef);
  const i = s.indexOf(":");
  if (i === -1) return null;
  const type = s.slice(0, i);
  const id = s.slice(i + 1);
  if (!type || !id) return null;
  return { type, id };
}

/**
 * Resolve `entity_ref` (e.g. "corporate_entity:fc3f680f-…") to a human label
 * ("SLAS Cameroun") for the audit detail modal. Best-effort: an unmapped
 * type, a since-deleted row, or a query error all resolve to `null` rather
 * than throwing — the modal already falls back to the raw entity_ref, and a
 * label lookup failing must never break the detail view.
 */
async function resolveEntityLabel(req, entityRef) {
  const parsed = parseRef(entityRef);
  if (!parsed) return null;
  const meta = ENTITY_LABEL[parsed.type];
  if (!meta) return null;
  const db = meta.schema === "identity" ? req.identityDb : req.tenantDb;
  try {
    const { rows } = await db((c) =>
      c.query(`SELECT ${meta.column} AS label FROM ${meta.table} WHERE ${meta.pk} = $1`, [parsed.id]),
    );
    return rows[0] ? rows[0].label || null : null;
  } catch {
    return null;
  }
}

module.exports = { ENTITY_LABEL, resolveEntityLabel };
