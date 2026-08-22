/** Corporate-entity repository (MOD-01). All SQL lives here. */
"use strict";
const { insertOne, getById, page, updateOne } = require("../../../shared/db/query-helpers");

/**
 * Columns a caller may write. Declared explicitly rather than inferred from the
 * body, so a new column added by a migration is not writable until someone
 * decides it should be — `query-helpers` rejects anything outside this list
 * instead of silently dropping it (mass assignment, SEC H3).
 *
 * Service-owned columns are absent on purpose: `is_active` and
 * `registration_status` move only through setStatus (which enforces the
 * transition table), `status_changed_at`/`status_changed_by` are stamped by the
 * service, and the logo refs move only through the upload endpoint.
 */
const WRITABLE = [
  // identity
  "legal_name", "trading_name", "legal_form", "legal_form_code", "legal_form_source",
  "legal_form_jurisdiction", "niu", "rccm", "country_code", "address",
  "incorporation_date", "incorporation_country", "incorporation_place", "dissolution_date",
  "share_capital", "share_capital_currency", "share_capital_paid_up",
  "description", "industry", "website", "email", "phone", "headcount", "timezone",
  // documents & reporting
  "doc_prefix", "default_language", "fiscal_year_start_month", "accounting_framework",
  "logo_light_ref", "logo_dark_ref", "bank_block",
  // downstream defaults
  "default_currency", "default_tax_jurisdiction_id", "payroll_country",
  "numbering_reset", "vat_registered",
  // group structure
  "parent_entity_id", "relationship_type", "ownership_percent", "consolidates", "is_group_parent",
];

const insert = (client, data) => insertOne(client, "corporate_entity", data);
const get = (client, id) => getById(client, "corporate_entity", "entity_id", id);

async function getByCode(client, code) {
  const { rows } = await client.query("SELECT * FROM corporate_entity WHERE code = $1", [code]);
  return rows[0] || null;
}

/**
 * The tenant's first-created entity — the stand-in identity for contexts that
 * are not entity-scoped (spreadsheet exports, document renders). Most tenants
 * are single-entity, where this IS the entity; a multi-entity tenant passes
 * its own entity_id and never lands here.
 */
async function first(client) {
  const { rows } = await client.query("SELECT * FROM corporate_entity ORDER BY created_at LIMIT 1");
  return rows[0] || null;
}

async function update(client, id, fields, { allow = WRITABLE } = {}) {
  // PERF S19/S20: was a hand-rolled SET builder, which bypassed the
  // identifier validation and allow-list in query-helpers.
  if (!Object.keys(fields).length) return get(client, id);
  return updateOne(client, "corporate_entity", "entity_id", id, fields, "*", allow, { touch: "updated_at" });
}

/**
 * Status and other service-owned columns bypass the caller allow-list — the
 * service has already run the transition table, so this is not user input.
 */
const updateInternal = (client, id, fields) => update(client, id, fields, { allow: null });

/**
 * List entities with optional filters.
 *
 * ONE STATIC SQL STRING, every filter bound. The previous form assembled the
 * WHERE clause by concatenation — `"is_active = $" + params.length` — and only
 * ever concatenated placeholders, so it was not actually injectable. But `q` is
 * `req.query`, and "user input reaches a query built by string concatenation" is
 * the exact shape CodeQL's `js/sql-injection` looks for; a reader has to trace
 * every branch to convince themselves, and the next person to add a filter has
 * to get it right too. SEC-H3 in this codebase was precisely a case of an
 * identifier reaching SQL through a builder nobody re-read.
 *
 * `($n::type IS NULL OR col = $n)` is the standard way to make an optional
 * filter static. It costs an index scan on a table with a handful of rows per
 * tenant — entities are counted in single digits — which is a price worth paying
 * to have no query construction at all.
 */
const LIST_SQL = `
  SELECT * FROM corporate_entity
   WHERE ($3::boolean IS NULL OR is_active = $3)
     AND ($4::text    IS NULL OR registration_status = $4)
     AND ($5::uuid    IS NULL OR parent_entity_id = $5)
     AND ($6::text    IS NULL OR country_code = $6)
     AND ($7::text    IS NULL OR code ILIKE $7 OR legal_name ILIKE $7 OR trading_name ILIKE $7)
   ORDER BY code ASC
   LIMIT $1 OFFSET $2`;

async function list(client, q = {}) {
  const { limit, offset } = page(q);
  const isActive = q.is_active === undefined ? null : (q.is_active === "true" || q.is_active === true);
  const { rows } = await client.query(LIST_SQL, [
    limit,
    offset,
    isActive,
    q.registration_status || null,
    q.parent_entity_id || null,
    q.country_code ? String(q.country_code).toUpperCase() : null,
    q.q ? `%${q.q}%` : null,
  ]);
  return rows;
}

/** entity_id -> parent_entity_id for the whole tenant, for the cycle walk. */
async function parentMap(client) {
  const { rows } = await client.query("SELECT entity_id, parent_entity_id FROM corporate_entity");
  return new Map(rows.map((r) => [String(r.entity_id), r.parent_entity_id ? String(r.parent_entity_id) : null]));
}

/** Direct children of an entity — the Structure tab's subsidiary list. */
async function children(client, id) {
  const { rows } = await client.query(
    `SELECT entity_id, code, legal_name, country_code, relationship_type, ownership_percent,
            consolidates, registration_status, is_active, accounting_framework
       FROM corporate_entity WHERE parent_entity_id = $1 ORDER BY code`,
    [id],
  );
  return rows;
}

/**
 * The chain of ancestors, nearest first. Recursive CTE with a depth cap: the
 * cycle guard in rules.js runs on write, but a row that predates it (or arrived
 * by direct SQL) must not hang a page render.
 */
async function ancestors(client, id) {
  const { rows } = await client.query(
    `WITH RECURSIVE up AS (
       SELECT e.entity_id, e.parent_entity_id, e.code, e.legal_name, e.country_code, 1 AS depth
         FROM corporate_entity e WHERE e.entity_id = (SELECT parent_entity_id FROM corporate_entity WHERE entity_id = $1)
       UNION ALL
       SELECT p.entity_id, p.parent_entity_id, p.code, p.legal_name, p.country_code, up.depth + 1
         FROM corporate_entity p JOIN up ON p.entity_id = up.parent_entity_id
        WHERE up.depth < 20
     )
     SELECT entity_id, code, legal_name, country_code, depth FROM up ORDER BY depth`,
    [id],
  );
  return rows;
}

/**
 * Child collections for the 360 aggregation. One round trip each, no joins to
 * fan out.
 *
 * Sequential, not Promise.all: these all run on the SAME tenant client (one per
 * request), and a pg client cannot execute two queries at once — it serialises
 * them anyway and warns that the behaviour is removed in pg@9.
 */
async function collections(client, id) {
  const people = await client.query(
    `SELECT p.*, e.code AS holder_entity_code, e.legal_name AS holder_entity_name
       FROM entity_person p
       LEFT JOIN corporate_entity e ON e.entity_id = p.holder_entity_id
      WHERE p.entity_id = $1
      ORDER BY p.role, p.ownership_percent DESC NULLS LAST, p.full_name`,
    [id],
  );
  const contacts = await client.query("SELECT * FROM entity_contact WHERE entity_id = $1 ORDER BY is_primary DESC, name", [id]);
  const addresses = await client.query("SELECT * FROM entity_address WHERE entity_id = $1 ORDER BY is_primary DESC, type", [id]);
  const registrations = await client.query("SELECT * FROM entity_registration WHERE entity_id = $1 ORDER BY is_primary DESC, country_code, kind", [id]);
  // The manager is joined for the same reason the holder entity is above: the
  // dossier can only show a name it was given, and a bare uuid in a table column
  // is indistinguishable from having no manager at all.
  const establishments = await client.query(
    `SELECT s.*, m.full_name AS manager_name
       FROM entity_establishment s
       LEFT JOIN employee m ON m.employee_id = s.manager_employee_id
      WHERE s.entity_id = $1
      ORDER BY s.is_active DESC, s.name`,
    [id],
  );
  return {
    people: people.rows,
    contacts: contacts.rows,
    addresses: addresses.rows,
    registrations: registrations.rows,
    establishments: establishments.rows,
  };
}

/**
 * Documents, tax registrations and the letterhead configuration (0516).
 *
 * Split from `collections` so the dossier can load the identity half without
 * paying for the documents half, and so PR-2 callers that only want renewals do
 * not drag in five unrelated queries. Sequential for the same reason as
 * `collections` — one pg client per request.
 */
async function documentsAndTax(client, id) {
  const documents = await client.query(
    `SELECT d.*,
            t.code AS document_type_code,
            t.name AS document_type_name,
            t.default_severity,
            t.requires_expiry,
            t.renewal_lead_days AS type_renewal_lead_days,
            v.storage_path, v.content_hash AS vault_hash, v.status AS vault_status,
            s.name AS establishment_name
       FROM entity_document d
       LEFT JOIN party_document_type t   ON t.document_type_id = d.document_type_id
       LEFT JOIN document_vault v        ON v.doc_id = d.vault_id
       LEFT JOIN entity_establishment s  ON s.establishment_id = d.establishment_id
      WHERE d.entity_id = $1
      ORDER BY d.expires_on NULLS LAST, d.created_at DESC`,
    [id],
  );
  const taxRegistrations = await client.query(
    `SELECT tr.*, j.name AS jurisdiction_name, j.currency AS jurisdiction_currency,
            u.full_name AS responsible_name
       FROM entity_tax_registration tr
       LEFT JOIN tax_jurisdiction j ON j.jurisdiction_id = tr.jurisdiction_id
       LEFT JOIN app_user u         ON u.user_id = tr.responsible_user_id
      WHERE tr.entity_id = $1
      ORDER BY tr.is_primary DESC, tr.country_code, tr.tax_kind`,
    [id],
  );
  const letterhead = await client.query("SELECT * FROM entity_letterhead WHERE entity_id = $1", [id]);
  return {
    documents: documents.rows,
    tax_registrations: taxRegistrations.rows,
    letterhead: letterhead.rows[0] || null,
  };
}

/** The obligation calendar rows for this entity (0342's tax_calendar). */
async function taxObligations(client, id, { limit = 24 } = {}) {
  const { rows } = await client.query(
    `SELECT c.*, tr.tax_kind, tr.country_code, tr.tax_number
       FROM tax_calendar c
       LEFT JOIN entity_tax_registration tr ON tr.tax_registration_id = c.tax_registration_id
      WHERE c.entity_id = $1
      ORDER BY c.status = 'PENDING' DESC, c.due_on
      LIMIT $2`,
    [id, limit],
  );
  return rows;
}

/**
 * Columns the letterhead designer may write. As with WRITABLE above, this is an
 * explicit allow-list rather than "whatever the body carried" — `updated_by` is
 * stamped by the service and `entity_id` is the key, so neither is writable.
 */
const LETTERHEAD_WRITABLE = [
  "show_legal_form", "show_share_capital", "show_registered_address", "show_registrations",
  "show_contact", "show_bank_block", "show_establishment",
  "header_note_fr", "header_note_en", "footer_note_fr", "footer_note_en",
  "legal_mentions_fr", "legal_mentions_en",
  "brand_color", "accent_color", "logo_position", "paper_size",
  "header_height_mm", "footer_height_mm",
];

const getLetterhead = (client, id) => getById(client, "entity_letterhead", "entity_id", id);

/**
 * Upsert the letterhead configuration.
 *
 * 0516 seeds a row for every entity that existed then; this covers entities
 * created after it, so the designer never opens on a missing row. The UPDATE
 * goes through `updateOne`, which validates and quotes every identifier and
 * enforces the allow-list — the SET clause must not be built by string
 * concatenation here (SEC H3).
 */
async function upsertLetterhead(client, id, fields, actorUserId = null) {
  await client.query(
    "INSERT INTO entity_letterhead (entity_id) VALUES ($1) ON CONFLICT (entity_id) DO NOTHING",
    [id],
  );
  const patch = {};
  for (const k of LETTERHEAD_WRITABLE) if (fields[k] !== undefined) patch[k] = fields[k];
  if (actorUserId) patch.updated_by = actorUserId;
  if (!Object.keys(patch).length) return getLetterhead(client, id);
  return updateOne(
    client, "entity_letterhead", "entity_id", id, patch, "*",
    [...LETTERHEAD_WRITABLE, "updated_by"], { touch: "updated_at" },
  );
}

/**
 * How much of the tenant's operational history hangs off this entity. Read by
 * the dossier header, and by setStatus to explain why an entity cannot simply be
 * deleted. Counts are cheap here (indexed FK columns) and honest — an entity with
 * ledger rows is permanent, and the UI should say so rather than offering a
 * delete that will fail.
 */
async function usage(client, id) {
  const { rows } = await client.query(
    `SELECT
       (SELECT count(*) FROM journal_entry   WHERE entity_id = $1) AS journal_entries,
       (SELECT count(*) FROM employee        WHERE entity_id = $1) AS employees,
       (SELECT count(*) FROM treasury_account WHERE entity_id = $1) AS treasury_accounts,
       (SELECT count(*) FROM corporate_entity WHERE parent_entity_id = $1) AS subsidiaries`,
    [id],
  );
  const r = rows[0] || {};
  return {
    journal_entries: Number(r.journal_entries || 0),
    employees: Number(r.employees || 0),
    treasury_accounts: Number(r.treasury_accounts || 0),
    subsidiaries: Number(r.subsidiaries || 0),
  };
}

/**
 * Treasury accounts for the entity — READ-ONLY here by design. Creating and
 * editing them belongs to MOD-09 (Treasury), and the dossier deep-links there
 * rather than duplicating the form. Account numbers never appear: `treasury_account`
 * stores a GL mapping and a label, not a number.
 */
async function treasuryAccounts(client, id) {
  // The bank-detail columns (0516) are selected because the letterhead's payment
  // block is assembled from them — without them `paymentBlock` finds nothing on
  // every row and silently falls back to the frozen `bank_block` forever, which
  // defeats the whole point of making treasury_account the source of truth.
  //
  // They are the finance-confidential fields, so every caller that serializes
  // this list masks them unless the caller holds Treasury read: the dossier and
  // the letterhead endpoint both run it through maskPaymentBlock (gate 14).
  const { rows } = await client.query(
    `SELECT treasury_account_id, kind, label, coa_code, currency, momo_network,
            is_active, is_primary, show_on_documents,
            bank_name, branch, account_number, iban, swift_bic, beneficiary_name,
            created_at
       FROM treasury_account WHERE entity_id = $1 ORDER BY is_active DESC, kind, label`,
    [id],
  );
  return rows;
}

module.exports = {
  WRITABLE, LETTERHEAD_WRITABLE,
  insert, get, getByCode, first, update, updateInternal, list,
  parentMap, children, ancestors, collections, usage, treasuryAccounts,
  documentsAndTax, taxObligations, getLetterhead, upsertLetterhead,
};
