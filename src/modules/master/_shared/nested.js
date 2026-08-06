/**
 * Nested master-data CRUD (spec §7) — the child collections a client or a
 * supplier owns: contacts, addresses, bank accounts, documents, registrations,
 * beneficial owners. Same six under `/clients/:id/*` and `/suppliers/:id/*`, so
 * they are built once here and mounted on each master's router by `mountNested`.
 *
 * The parent id always comes from the ROUTE (`:id`), never the body — the body
 * schema (packages/shared partyCommon) does not even carry a `client_id`/
 * `supplier_id`, and the service supplies the parent column itself. Service-owned
 * state (a bank's `is_verified`, a document's `scan_status`/`verified_by`) is not
 * in the write allow-list, so a request cannot assert a verification it has not
 * earned (Hard Rule 9).
 *
 * `_shared` is skipped by the module loader (leading underscore), so this is a
 * helper, not a mounted module.
 */
"use strict";
const { insertOne, updateOne, getById, page } = require("../../../shared/db/query-helpers");
const { audit, emitEvent } = require("../../../shared/events/emit");
const { requirePermission } = require("../../../middleware/rbac");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { partyCommon } = require("@praxis/shared");
const { canSeeFinancials, maskBank } = require("./confidential");

const actorOf = (req) => req.user || { user_id: null };

/** Zod middleware from a shared schema — keeps every write route validated. */
const validate = (schema) => (req, _res, next) => {
  const p = schema.safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

function buildResource(cfg) {
  const { table, pk, parentCol, parentTable, parentPk, moduleKey, label, writable, touch, isBank, isDocument } = cfg;
  const insertAllow = [...writable, parentCol];

  async function assertParent(c, parentId) {
    const { rows } = await c.query(`SELECT 1 FROM ${parentTable} WHERE ${parentPk} = $1`, [parentId]);
    if (!rows.length) throw new AppError("NOT_FOUND", "Parent record not found", 404);
  }

  const belongs = (row, parentId) => row && String(row[parentCol]) === String(parentId);

  /** Extra behaviour after a write: bank events (BEC control) and the doc scan bump. */
  async function afterWrite(c, { op, row, actor }) {
    if (isBank) {
      // High-priority event for every bank change (BEC fraud control). In Live
      // this is where maker-checker hooks in; the event is emitted unconditionally.
      await emitEvent(c, {
        eventTypeKey: "party.bank_account_changed", moduleKey,
        entityRef: `${label}:${row[pk]}`, actorUserId: actor.user_id || null,
        priority: "HIGH", payload: { op, is_verified: row.is_verified === true },
      });
    }
    if (isDocument && row.vault_id && row.scan_status === "PENDING") {
      // A scan just arrived on a paper-only record — advance PENDING → SCANNED so
      // the compliance engine stops warning about a missing scan. Verification
      // (SCANNED → VERIFIED) stays a human step.
      await c.query(`UPDATE ${table} SET scan_status = 'SCANNED', updated_at = now() WHERE ${pk} = $1`, [row[pk]]);
      row.scan_status = "SCANNED";
    }
  }

  const service = {
    list: async (c, parentId, q = {}) => {
      const { limit, offset } = page(q);
      const { rows } = await c.query(
        `SELECT * FROM ${table} WHERE ${parentCol} = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [parentId, limit, offset],
      );
      return rows;
    },
    async create(c, { parentId, data, actor = {} }) {
      await assertParent(c, parentId);
      await c.query("BEGIN");
      try {
        const row = await insertOne(c, table, { ...data, [parentCol]: parentId }, "*", insertAllow);
        await audit(c, { actorUserId: actor.user_id || null, action: `${label}.created`, moduleKey, entityRef: `${label}:${row[pk]}`, after: row });
        await afterWrite(c, { op: "create", row, actor });
        await c.query("COMMIT");
        return row;
      } catch (e) {
        await c.query("ROLLBACK");
        if (e.code === "23503") throw new AppError("NOT_FOUND", "Parent or referenced record not found", 404);
        throw e;
      }
    },
    async update(c, { parentId, id, patch, actor = {} }) {
      const before = await getById(c, table, pk, id);
      if (!belongs(before, parentId)) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      await c.query("BEGIN");
      try {
        const row = await updateOne(c, table, pk, id, patch, "*", writable, touch ? { touch: "updated_at" } : {});
        await audit(c, { actorUserId: actor.user_id || null, action: `${label}.updated`, moduleKey, entityRef: `${label}:${id}`, before, after: row });
        await afterWrite(c, { op: "update", row, actor });
        await c.query("COMMIT");
        return row;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    },
    async remove(c, { parentId, id, actor = {} }) {
      const before = await getById(c, table, pk, id);
      if (!belongs(before, parentId)) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      await c.query("BEGIN");
      try {
        await c.query(`DELETE FROM ${table} WHERE ${pk} = $1`, [id]);
        await audit(c, { actorUserId: actor.user_id || null, action: `${label}.deleted`, moduleKey, entityRef: `${label}:${id}`, before });
        await c.query("COMMIT");
        return { deleted: true, id };
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      }
    },
  };

  const controller = {
    list: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.list(c, req.params.id, req.query)) })),
    create: asyncHandler(async (req, res) => res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { parentId: req.params.id, data: req.body, actor: actorOf(req) })) })),
    update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { parentId: req.params.id, id: req.params.childId, patch: req.body, actor: actorOf(req) })) })),
    remove: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.remove(c, { parentId: req.params.id, id: req.params.childId, actor: actorOf(req) })) })),
  };

  return { service, controller };
}

/**
 * The six nested resources, keyed by URL segment. `kind` is "client" or
 * "supplier"; the child table is `<kind>_<x>` except registrations, which are the
 * one shared table (party_registration) keyed by `<kind>_id`.
 */
function resourceSpecs(kind) {
  return [
    { seg: "contacts", table: `${kind}_contact`, pk: "contact_id", create: partyCommon.contactCreate, update: partyCommon.contactUpdate, touch: true, writable: ["name", "title", "email", "phone", "role_tags", "is_primary", "language", "timezone", "portal_access", "is_active"] },
    { seg: "addresses", table: `${kind}_address`, pk: "address_id", create: partyCommon.addressCreate, update: partyCommon.addressUpdate, touch: true, writable: ["line1", "line2", "city", "region", "postal_code", "country_code", "type", "is_primary", "is_active"] },
    { seg: "banks", table: `${kind}_bank_account`, pk: "bank_account_id", create: partyCommon.bankCreate, update: partyCommon.bankUpdate, touch: true, isBank: true, writable: ["beneficiary_name", "bank_name", "branch", "account_number", "iban", "swift_bic", "routing_code", "currency", "momo_network", "momo_number", "is_primary", "is_active"] },
    { seg: "documents", table: `${kind}_document`, pk: "document_id", create: partyCommon.documentCreate, update: partyCommon.documentUpdate, touch: true, isDocument: true, writable: ["document_type_id", "document_number", "issuing_authority", "issued_on", "expires_on", "vault_id", "physical_ref", "scan_due_on"] },
    { seg: "registrations", table: "party_registration", pk: "registration_id", parentCol: `${kind}_id`, create: partyCommon.registrationCreate, update: partyCommon.registrationUpdate, touch: false, writable: ["country_code", "kind", "number", "issuing_authority", "issued_on", "expires_on"] },
    { seg: "beneficial-owners", table: `${kind}_beneficial_owner`, pk: "owner_id", create: partyCommon.beneficialOwnerCreate, update: partyCommon.beneficialOwnerUpdate, touch: false, writable: ["full_name", "date_of_birth", "nationality", "id_type", "id_number", "ownership_percent", "is_pep", "notes", "vault_id"] },
  ];
}

/**
 * Mount all six nested resources on a master router.
 *
 * @param {import('express').Router} router the master's router (basePath /clients or /suppliers)
 * @param {object} opts { kind, moduleKey, parentTable, parentPk }
 */
function mountNested(router, { kind, moduleKey, parentTable, parentPk }) {
  for (const r of resourceSpecs(kind)) {
    const { service, controller } = buildResource({
      table: r.table, pk: r.pk, parentCol: r.parentCol || `${kind}_id`,
      parentTable, parentPk, moduleKey, label: r.table, writable: r.writable,
      touch: r.touch, isBank: r.isBank, isDocument: r.isDocument,
    });
    // Bank numbers are masked in the list unless the caller has finance
    // visibility (gate 14) — masking in the serializer, never in the client.
    const listHandler = r.isBank
      ? asyncHandler(async (req, res) => {
          const canSee = await canSeeFinancials(req);
          const rows = await req.tenantDb((c) => service.list(c, req.params.id, req.query));
          res.json({ data: rows.map((b) => maskBank(b, canSee)) });
        })
      : controller.list;
    router.get(`/:id/${r.seg}`, requirePermission(moduleKey, "view"), listHandler);
    router.post(`/:id/${r.seg}`, requirePermission(moduleKey, "create"), validate(r.create), controller.create);
    router.patch(`/:id/${r.seg}/:childId`, requirePermission(moduleKey, "edit"), validate(r.update), controller.update);
    router.delete(`/:id/${r.seg}/:childId`, requirePermission(moduleKey, "delete"), controller.remove);
  }
}

module.exports = { mountNested, buildResource, resourceSpecs, validate };
