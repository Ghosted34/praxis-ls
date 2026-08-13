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
const { partyCommon, entityCommon } = require("@praxis/shared");
const { canSeeFinancials, maskBank } = require("./confidential");
const changeRequest = require("./change-request.service");
const numbering = require("../../../services/documents/numbering.service");

const actorOf = (req) => req.user || { user_id: null };

/** Zod middleware from a shared schema — keeps every write route validated. */
const validate = (schema) => (req, _res, next) => {
  const p = schema.safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

function buildResource(cfg) {
  const { table, pk, parentCol, parentTable, parentPk, moduleKey, label, writable, touch, isBank, isDocument, kind, governed, numberingKey, immutable = [] } = cfg;
  const insertAllow = [...writable, parentCol];
  const updateAllow = writable.filter((field) => !immutable.includes(field));

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
    async create(c, { parentId, data, actor = {}, env }) {
      await assertParent(c, parentId);
      // Sensitive-field maker-checker (§8): in LIVE a bank / tax-registration
      // create is written as a PENDING change request and applied only on a
      // second authorization; in TEST/sandbox it applies directly.
      if (governed && changeRequest.isGoverned(env)) {
        await c.query("BEGIN");
        try {
          const cr = await changeRequest.open(c, { kind, partyId: parentId, changeType: governed.create, targetTable: table, payload: data, actor });
          await c.query("COMMIT");
          return cr;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      }
      await c.query("BEGIN");
      try {
        const insertData = { ...data };
        if (isDocument && numberingKey) {
          // Counterparty document numbers are internal system references, not
          // user-entered values. Prefer the normal entity-scoped allocator when
          // the party is already linked to a corporate entity; the fallback
          // keeps onboarding valid for a party created before that link exists.
          const parent = await c.query(
            `SELECT entity_id FROM ${parentTable} WHERE ${parentPk} = $1`,
            [parentId],
          );
          const entityId = parent.rows[0] && parent.rows[0].entity_id;
          const issuedOrToday = insertData.issued_on || new Date().toISOString().slice(0, 10);
          const allocated = entityId
            ? await numbering.allocate(c, { moduleKey: numberingKey, entityId, date: issuedOrToday })
            : await numbering.allocatePartyDocument(c, { moduleKey: numberingKey, partyKind: kind, date: issuedOrToday });
          insertData.document_number = allocated.number;
        }
        const row = await insertOne(c, table, { ...insertData, [parentCol]: parentId }, "*", insertAllow);
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
    async update(c, { parentId, id, patch, actor = {}, env }) {
      const before = await getById(c, table, pk, id);
      if (!belongs(before, parentId)) throw new AppError("NOT_FOUND", `${label} not found`, 404);
      // Sensitive-field maker-checker (§8): a bank / tax-registration EDIT is
      // governed in LIVE the same way a create is.
      if (governed && changeRequest.isGoverned(env)) {
        await c.query("BEGIN");
        try {
          const cr = await changeRequest.open(c, { kind, partyId: parentId, changeType: governed.update, targetTable: table, targetId: id, payload: patch, actor });
          await c.query("COMMIT");
          return cr;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      }
      await c.query("BEGIN");
      try {
        const row = await updateOne(c, table, pk, id, patch, "*", updateAllow, touch ? { touch: "updated_at" } : {});
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
    create: asyncHandler(async (req, res) => {
      const row = await req.tenantDb((c) => service.create(c, { parentId: req.params.id, data: req.body, actor: actorOf(req), env: req.env }));
      // A governed change awaits a second authorizer — 202, not 201 (created).
      res.status(row && row.pending ? 202 : 201).json({ data: row });
    }),
    update: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.update(c, { parentId: req.params.id, id: req.params.childId, patch: req.body, actor: actorOf(req), env: req.env })) })),
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
    { seg: "banks", table: `${kind}_bank_account`, pk: "bank_account_id", create: partyCommon.bankCreate, update: partyCommon.bankUpdate, touch: true, isBank: true, governed: { create: "BANK_CREATE", update: "BANK_UPDATE" }, writable: ["beneficiary_name", "bank_name", "branch", "account_number", "iban", "swift_bic", "routing_code", "currency", "momo_network", "momo_number", "is_primary", "is_active"] },
    {
      seg: "documents", table: `${kind}_document`, pk: "document_id",
      create: partyCommon.documentCreate, update: partyCommon.documentUpdate,
      touch: true, isDocument: true, numberingKey: kind === "client" ? "MOD-03-DOC" : "MOD-04-DOC",
      // The number is assigned by the allocator on create and is immutable
      // afterwards. Keeping it in the insert allow-list lets the service write
      // the generated value while rejecting a PATCH that tries to renumber it.
      immutable: ["document_number"],
      writable: ["document_type_id", "document_number", "issuing_authority", "issued_on", "expires_on", "vault_id", "physical_ref"],
    },
    { seg: "registrations", table: "party_registration", pk: "registration_id", parentCol: `${kind}_id`, create: partyCommon.registrationCreate, update: partyCommon.registrationUpdate, touch: false, governed: { create: "TAX_REGISTRATION", update: "TAX_REGISTRATION" }, writable: ["country_code", "kind", "number", "issuing_authority", "issued_on", "expires_on"] },
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
      touch: r.touch, isBank: r.isBank, isDocument: r.isDocument, numberingKey: r.numberingKey,
      immutable: r.immutable, kind, governed: r.governed,
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

/**
 * The five nested resources a CORPORATE ENTITY owns (MOD-01).
 *
 * Separate from `resourceSpecs` above because the shapes genuinely differ — an
 * entity's people carry a cap table, its addresses carry a REGISTERED type that
 * a counterparty has no equivalent of — but the machinery (`buildResource`) is
 * identical, so this is a spec list, not a second implementation.
 *
 * No `banks` entry, deliberately: an entity's bank accounts are
 * `treasury_account` rows owned by MOD-09, surfaced read-only on the dossier and
 * created through Treasury. Mounting a writable bank collection here is exactly
 * the duplicate source of truth the entity revamp set out to remove.
 *
 * `verified` / `verified_by` / `verified_at` on a registration are absent from
 * every allow-list — verification is a service-owned step, not something a PATCH
 * can assert about itself.
 */
function entityResourceSpecs() {
  return [
    {
      seg: "people", table: "entity_person", pk: "person_id",
      create: entityCommon.personCreate, update: entityCommon.personUpdate, touch: true,
      writable: [
        "role", "holder_type", "full_name", "title",
        "date_of_birth", "nationality", "country_of_residence", "id_type", "id_number",
        "company_registration_number", "company_country", "holder_entity_id",
        "email", "phone",
        "share_class", "share_count", "share_nominal_value", "ownership_percent", "voting_percent",
        "is_pep", "is_primary_contact", "signature_limit_amount", "signature_limit_currency",
        "effective_from", "effective_to",
        "employee_id", "client_id", "supplier_id",
        "notes", "is_active",
      ],
    },
    {
      seg: "contacts", table: "entity_contact", pk: "contact_id",
      create: entityCommon.contactCreate, update: entityCommon.contactUpdate, touch: true,
      writable: ["name", "title", "email", "phone", "role_tags", "is_primary", "language", "timezone", "is_active"],
    },
    {
      seg: "addresses", table: "entity_address", pk: "address_id",
      create: entityCommon.addressCreate, update: entityCommon.addressUpdate, touch: true,
      writable: ["type", "line1", "line2", "city", "region", "postal_code", "country_code", "po_box", "is_primary", "is_active"],
    },
    {
      seg: "registrations", table: "entity_registration", pk: "registration_id",
      create: entityCommon.registrationCreate, update: entityCommon.registrationUpdate, touch: true,
      writable: ["country_code", "kind", "number", "issuing_authority", "issued_on", "expires_on", "is_primary", "notes"],
    },
    {
      seg: "establishments", table: "entity_establishment", pk: "establishment_id",
      create: entityCommon.establishmentCreate, update: entityCommon.establishmentUpdate, touch: true,
      writable: ["code", "name", "kind", "country_code", "city", "address_line", "tax_office_ref",
        "registration_ref", "customs_office", "manager_employee_id", "opened_on", "closed_on", "is_active"],
    },
    {
      // Administrative documents (0516). `isDocument` gives the same
      // PENDING -> SCANNED bump the party masters get when a scan arrives;
      // verification stays a human step, and `verification_status`,
      // `verified_by`, `content_hash` are absent from the allow-list so a
      // request cannot assert a verification it has not earned.
      seg: "documents", table: "entity_document", pk: "document_id",
      create: entityCommon.documentCreate, update: entityCommon.documentUpdate,
      touch: true, isDocument: true, numberingKey: "MOD-01-DOC",
      // The reference is allocated by the server when the document is created
      // and is immutable afterwards, just like client/supplier document numbers.
      immutable: ["document_number"],
      writable: ["document_type_id", "title", "document_number", "issuing_authority",
        "issued_on", "expires_on", "country_code", "establishment_id", "vault_id",
        "physical_ref", "renewal_lead_days", "notes", "is_active"],
    },
    {
      // Per-entity tax registrations (0516) — the entity's own VAT/TVA number,
      // regime and filing frequency in one jurisdiction. Rate cards stay in
      // MOD-07; this is the binding between an entity and a jurisdiction.
      seg: "tax-registrations", table: "entity_tax_registration", pk: "tax_registration_id",
      create: entityCommon.taxRegistrationCreate, update: entityCommon.taxRegistrationUpdate, touch: true,
      writable: ["jurisdiction_id", "country_code", "tax_kind", "tax_number", "regime",
        "filing_frequency", "filing_due_day", "currency", "is_withholding_agent",
        "reverse_charge_applies", "registered_on", "deregistered_on", "is_primary",
        "is_active", "filing_portal_url", "responsible_user_id", "notes"],
    },
  ];
}

/**
 * Mount the entity's nested collections on the MOD-01 router.
 *
 * `people` is gated harder than the rest: reading a cap table needs the same
 * UPDATE grant that `entity-360.service.canSeeGovernance` tests, so a Sales user
 * who can view entities cannot enumerate shareholders and their identifiers by
 * calling the collection endpoint directly — which would otherwise route around
 * the dossier's redaction entirely.
 */
function mountEntityNested(router, { moduleKey, parentTable, parentPk }) {
  for (const r of entityResourceSpecs()) {
    const { controller } = buildResource({
      table: r.table, pk: r.pk, parentCol: "entity_id",
      parentTable, parentPk, moduleKey, label: r.table,
      writable: r.writable, touch: r.touch, isDocument: r.isDocument,
      numberingKey: r.numberingKey, immutable: r.immutable,
    });
    // `people` carries the cap table and personal identifiers, and `documents`
    // the statutes and tax certificates — both need the same UPDATE grant that
    // entity-360's redaction tests, or the collection endpoint becomes a way to
    // read around the dossier's redaction entirely.
    const viewAction = ["people", "documents"].includes(r.seg) ? "edit" : "view";
    router.get(`/:id/${r.seg}`, requirePermission(moduleKey, viewAction), controller.list);
    router.post(`/:id/${r.seg}`, requirePermission(moduleKey, "create"), validate(r.create), controller.create);
    router.patch(`/:id/${r.seg}/:childId`, requirePermission(moduleKey, "edit"), validate(r.update), controller.update);
    router.delete(`/:id/${r.seg}/:childId`, requirePermission(moduleKey, "delete"), controller.remove);
  }
}

module.exports = { mountNested, mountEntityNested, buildResource, resourceSpecs, entityResourceSpecs, validate };
