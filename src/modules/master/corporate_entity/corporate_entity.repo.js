/** Corporate-entity repository (MOD-01). All SQL lives here. */
"use strict";
const {
  insertOne, getById, page, updateOne, splitTotal,
} = require("../../../shared/db/query-helpers");

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
 *
 * PR-09 (CE-03 / CE-35): the SELECT also carries `COUNT(*) OVER() AS _total`,
 * so a caller that pages through the list knows the true match count before
 * LIMIT truncates it. That count is what lets the entity list and the pickers
 * move their search SERVER-SIDE — the previous client contract fetched
 * `?limit=200` (the `page()` maximum) and filtered those rows in the browser,
 * so entity 201 was unreachable from any picker no matter what it was called.
 */
const LIST_SQL = `
  SELECT *, COUNT(*) OVER() AS _total FROM corporate_entity
   WHERE ($3::boolean IS NULL OR is_active = $3)
     AND ($4::text    IS NULL OR registration_status = $4)
     AND ($5::uuid    IS NULL OR parent_entity_id = $5)
     AND ($6::text    IS NULL OR country_code = $6)
     AND ($7::text    IS NULL OR code ILIKE $7 OR legal_name ILIKE $7 OR trading_name ILIKE $7)
   ORDER BY code ASC
   LIMIT $1 OFFSET $2`;

/**
 * One page of entities plus the total matching the filter.
 *
 * `registration_status = 'ACTIVE'` is the lifecycle predicate the pickers send
 * for NEW links (Decision Q6): only ACTIVE entities may be newly linked as the
 * billing entity, a parent or a corporate shareholder. Existing links to an
 * entity that has since been deactivated are history — they stay visible where
 * they are already recorded and are never offered as a fresh choice.
 */
async function listPaged(client, q = {}) {
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
  return splitTotal(rows);
}

/**
 * Bare rows, unchanged. This is the AI tool contract — `list_entities` is
 * described to the model as returning a list, and handing it a
 * `{ rows, total }` envelope it has no schema for would change that contract
 * for a UI concern the AI path does not have.
 */
async function list(client, q = {}) {
  return (await listPaged(client, q)).rows;
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
 *
 * `scan_stored_unlinked` (PR-07, CE-11): true when the file reached the vault
 * under this row's `entity_ref` but `vault_id` was never linked — the middle
 * request of the attach flow failed. One scalar EXISTS per unlinked row, so
 * the register can say "file stored, link pending" instead of rendering the
 * bytes' existence as "no scan at all". A workflow state, not an identifier:
 * it survives document redaction, which strips vault references and hashes.
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
            s.name AS establishment_name,
            CASE WHEN d.vault_id IS NULL THEN EXISTS (
              SELECT 1 FROM document_vault w
               WHERE w.entity_ref = 'entity_document:' || d.document_id::text
                 AND w.status <> 'ARCHIVED'
                 AND w.storage_path NOT LIKE 'pending://%'
            ) ELSE false END AS scan_stored_unlinked
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
 * The obligation calendar as a LIST the filing view can page through (PR-05).
 *
 * Separate from `taxObligations` rather than an extension of it: that one is
 * the dossier's top-of-page strip and its ordering ("open first") is a display
 * decision, while this one is a working list where an accountant filtering to
 * one quarter of one country needs a stable `due_on` order and a real total.
 *
 * Joins the responsible person's NAME, not just the id — CE-33: a filing with a
 * UUID where a person should be is a filing nobody can chase. Redaction of
 * `tax_number` stays with the serializer, not here, for the same reason PR-04
 * put it there.
 */
async function obligations(client, id, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const where = ["c.entity_id = $1"];
  const params = [id];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };

  // A comma list is accepted because "show me everything still open" is one
  // filter, not two round trips.
  if (query.status) {
    const statuses = String(query.status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    // `::text[]` is not decoration: an empty JS array arrives as `{}`, which
    // Postgres cannot type-deduce on its own and answers with 42P18. The cast
    // is the house spelling (see insight.repo.js, costing.repo.js).
    if (statuses.length) add("c.status = ANY(?::text[])", statuses);
  }
  if (query.from) add("c.due_on >= ?", query.from);
  if (query.to) add("c.due_on <= ?", query.to);
  if (query.period_code) add("c.period_code = ?", query.period_code);
  if (query.tax_registration_id) add("c.tax_registration_id = ?", query.tax_registration_id);
  if (query.obligation) add("c.obligation = ?", String(query.obligation).toUpperCase());
  if (query.responsible_user_id) add("c.responsible_user_id = ?", query.responsible_user_id);
  // The finding the generator reports, and this list has to be filterable by
  // it: obligations nobody has been told about.
  if (String(query.unassigned) === "true") where.push("c.responsible_user_id IS NULL");
  // Generated rows only, so a hand-typed legacy calendar entry cannot be
  // mistaken for something the registration model produced.
  if (String(query.generated) === "true") where.push("c.generated = true");

  const predicate = where.join(" AND ");
  const { rows } = await client.query(
    `SELECT c.*,
            tr.tax_kind, tr.country_code, tr.tax_number, tr.jurisdiction_id,
            j.name AS jurisdiction_name,
            u.full_name AS responsible_name
       FROM tax_calendar c
       LEFT JOIN entity_tax_registration tr ON tr.tax_registration_id = c.tax_registration_id
       LEFT JOIN tax_jurisdiction j         ON j.jurisdiction_id = tr.jurisdiction_id
       LEFT JOIN app_user u                 ON u.user_id = c.responsible_user_id
      WHERE ${predicate}
      ORDER BY c.due_on, c.obligation
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = await client.query(`SELECT count(*)::int AS n FROM tax_calendar c WHERE ${predicate}`, params);
  return { items: rows, total: total.rows[0].n, limit, offset };
}

/*
 * ── Tax obligation generator (PR-05, audit CE-16) ──────────────────────────
 *
 * The SQL behind `corporate_entity.tax-calendar.js`, kept here because this
 * file is where the module's SQL lives and because the generator is worth
 * testing the way `leave-accrual` is: a fake repo enforcing the unique index,
 * with the loop's arithmetic and stopping conditions under test. Queries
 * inline in the generator would have made that a fake of Postgres's parser
 * instead of a fake of a table.
 */

/** Every tax registration on an entity, joined to what the generator labels with. */
async function taxRegistrationsForGeneration(client, entityId) {
  const { rows } = await client.query(
    `SELECT tr.*, j.name AS jurisdiction_name
       FROM entity_tax_registration tr
       LEFT JOIN tax_jurisdiction j ON j.jurisdiction_id = tr.jurisdiction_id
      WHERE tr.entity_id = $1
      ORDER BY tr.country_code, tr.tax_kind`,
    [entityId],
  );
  return rows;
}

/**
 * Insert one generated obligation, or nothing if its generation key exists.
 *
 * THE LINE THE WHOLE ACCEPTANCE CONDITION RESTS ON. `ux_tax_calendar_
 * generation_key` (13970) is a unique index over `generation_key`, and this is
 * the only place a generated row is written — so "a re-run produces no
 * duplicates" is enforced by Postgres here rather than by the caller's
 * bookkeeping above it. Two overlapping runs, or a bug in the generator's own
 * "have I generated this period?" logic, still cannot produce a second row.
 *
 * The conflict target names the index PREDICATE as well as the column because
 * the index is partial: a bare `ON CONFLICT (generation_key)` matches no index
 * and fails with 42P10 rather than deduplicating.
 *
 * BOTH user columns go through the `(SELECT user_id FROM app_user …)`
 * sub-select, and it is doing two jobs at once:
 *
 *   - it is the house guard from `emitEvent`/`audit` (DATA 2.4): under TEST the
 *     user's row lives in the LIVE schema, and a raw bind would raise 23503 and
 *     take the whole generation run with it;
 *   - it is the existence check the FOREIGN KEY would have made. 13970 could
 *     not add one — `tax_calendar` pre-exists, and per the 13791 rule a table a
 *     migration did not create gains PLAIN columns only — so an id that does
 *     not resolve stores NULL here rather than raising. For `created_by` that
 *     is the right answer anyway (a scheduled run has no actor); for
 *     `responsible_user_id` the caller catches the NULL, because silently
 *     un-assigning a statutory filing is worse than refusing.
 *
 * @returns {object|null} the inserted row, or null when the key already existed.
 */
async function insertObligation(client, row) {
  const { rows } = await client.query(
    `INSERT INTO tax_calendar
       (entity_id, obligation, due_on, status, tax_registration_id, period_code,
        generated, generation_key, period_start, period_end, responsible_user_id, created_by)
     VALUES ($1,$2,$3,'PENDING',$4,$5,true,$6,$7,$8,
             (SELECT user_id FROM app_user WHERE user_id = $9),
             (SELECT user_id FROM app_user WHERE user_id = $10))
     ON CONFLICT (generation_key) WHERE generation_key IS NOT NULL DO NOTHING
     RETURNING tax_calendar_id`,
    [
      row.entity_id, row.obligation, row.due_on, row.tax_registration_id, row.period_code,
      row.generation_key, row.period_start, row.period_end,
      row.responsible_user_id || null, row.created_by || null,
    ],
  );
  return rows[0] || null;
}

/**
 * Supersede every open generated obligation on one registration.
 *
 * For when the registration itself closes. Reaches LATE as well as PENDING: an
 * overdue filing on a number the authority has closed is a task nobody can
 * perform, and leaving it LATE would have the reminder engine chasing it
 * forever. DONE and WAIVED are untouched — see the generator's header.
 */
async function supersedeOpenForRegistration(client, taxRegistrationId, { reason, actorUserId = null }) {
  const { rows } = await client.query(
    `UPDATE tax_calendar
        SET status = 'SUPERSEDED',
            status_changed_at = now(),
            status_changed_by = (SELECT user_id FROM app_user WHERE user_id = $2),
            status_reason = $3
      WHERE tax_registration_id = $1
        AND generated
        AND status IN ('PENDING', 'LATE')
      RETURNING tax_calendar_id`,
    [taxRegistrationId, actorUserId || null, reason],
  );
  return rows;
}

/**
 * Supersede the open generated obligations on one registration whose
 * `generation_key` is no longer expected inside a window.
 *
 * Scoped to the window on purpose: obligations outside it were not considered
 * by this run and must not be swept up by it. This is what turns a cadence
 * change into a visible decision rather than a silent one — the old obligation
 * is superseded with a reason, and the new one exists beside it.
 *
 * An EMPTY `keys` array is meaningful, not a degenerate case: it means the run
 * expects nothing from this registration inside the window (every remaining
 * period falls after a deregistration), so everything open there is superseded.
 * `= ANY('{}'::text[])` is false for every row, which makes `NOT (...)` true
 * for every row — the right answer, and the reason the cast is explicit.
 */
async function supersedeUnexpectedForRegistration(
  client, taxRegistrationId, { keys, windowStart, windowEnd, reason, actorUserId = null },
) {
  const { rows } = await client.query(
    `UPDATE tax_calendar
        SET status = 'SUPERSEDED',
            status_changed_at = now(),
            status_changed_by = (SELECT user_id FROM app_user WHERE user_id = $2),
            status_reason = $3
      WHERE tax_registration_id = $1
        AND generated
        AND status IN ('PENDING', 'LATE')
        AND generation_key IS NOT NULL
        AND NOT (generation_key = ANY($4::text[]))
        AND period_start <= $6
        AND period_end   >= $5
      RETURNING tax_calendar_id, generation_key`,
    [taxRegistrationId, actorUserId || null, reason, keys, windowStart, windowEnd],
  );
  return rows;
}

/**
 * Flip PENDING obligations past their deadline to LATE.
 *
 * Returns the rows so the caller can emit one event each. An obligation whose
 * deadline passed is the single most important thing this module can tell
 * anybody, and it is advisory: a status and an event, never a block.
 */
async function markOverdue(client, entityId, today, { actorUserId = null } = {}) {
  const { rows } = await client.query(
    `UPDATE tax_calendar
        SET status = 'LATE',
            status_changed_at = now(),
            status_changed_by = (SELECT user_id FROM app_user WHERE user_id = $2),
            status_reason = 'past_due_on'
      WHERE entity_id = $1
        AND status = 'PENDING'
        AND due_on < $3
      RETURNING tax_calendar_id, obligation, period_code, due_on, responsible_user_id`,
    [entityId, actorUserId || null, today],
  );
  return rows;
}

/** One obligation by id. */
async function obligationById(client, taxCalendarId) {
  const { rows } = await client.query("SELECT * FROM tax_calendar WHERE tax_calendar_id = $1", [taxCalendarId]);
  return rows[0] || null;
}

/** Write a status transition onto one obligation and hand back the row. */
async function setObligationStatus(client, taxCalendarId, { status, reason = null, actorUserId = null }) {
  const { rows } = await client.query(
    `UPDATE tax_calendar
        SET status = $2,
            status_changed_at = now(),
            status_changed_by = (SELECT user_id FROM app_user WHERE user_id = $3),
            status_reason = $4
      WHERE tax_calendar_id = $1
      RETURNING *`,
    [taxCalendarId, status, actorUserId || null, reason || null],
  );
  return rows[0] || null;
}

/**
 * Write the assignee onto one obligation and hand back the row.
 *
 * The sub-select means a `responsibleUserId` that does not resolve stores NULL
 * rather than raising — there is no FK to raise (see `insertObligation`). The
 * caller compares what it asked for with what came back, so a mistyped
 * assignee becomes a 404 instead of a silently un-assigned filing.
 */
async function setObligationResponsible(client, taxCalendarId, { responsibleUserId = null }) {
  const { rows } = await client.query(
    `UPDATE tax_calendar
        SET responsible_user_id = (SELECT user_id FROM app_user WHERE user_id = $2)
      WHERE tax_calendar_id = $1
      RETURNING *`,
    [taxCalendarId, responsibleUserId || null],
  );
  return rows[0] || null;
}

/** Record which reminder rung an obligation has already been told about. */
async function markReminded(client, taxCalendarId, step) {
  await client.query(
    "UPDATE tax_calendar SET last_reminder_step = $2, last_reminder_at = now() WHERE tax_calendar_id = $1",
    [taxCalendarId, step],
  );
}

/** Every entity the generator should visit: those with at least one registration. */
async function entitiesWithRegistrations(client) {
  const { rows } = await client.query(
    `SELECT DISTINCT tr.entity_id, e.code, e.legal_name
       FROM entity_tax_registration tr
       JOIN corporate_entity e ON e.entity_id = tr.entity_id
      ORDER BY e.code`,
  );
  return rows;
}

/** `YYYY-MM-DD` plus N days. */
function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * The open obligations across the tenant due within `days` — what the reminder
 * sweep considers. In the repo with the rest of the SQL because `src/jobs`
 * must not grow a query of its own.
 */
async function obligationsDueWithin(client, { today, days }) {
  const { rows } = await client.query(
    `SELECT c.tax_calendar_id, c.entity_id, c.obligation, c.period_code, c.due_on,
            c.responsible_user_id, c.last_reminder_step,
            e.code AS entity_code, e.legal_name AS entity_name,
            tr.tax_kind, tr.country_code, tr.filing_portal_url,
            u.full_name AS responsible_name
       FROM tax_calendar c
       JOIN corporate_entity e              ON e.entity_id = c.entity_id
       LEFT JOIN entity_tax_registration tr ON tr.tax_registration_id = c.tax_registration_id
       LEFT JOIN app_user u                 ON u.user_id = c.responsible_user_id
      WHERE c.status = 'PENDING'
        AND c.due_on >= $1
        AND c.due_on <= $2
      ORDER BY c.due_on`,
    [today, addDaysIso(today, days)],
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
  // 12760. `layout` is the block arrangement the editor drags; `logo_height_mm`
  // is the mark's printed height, which the fit model needs as a FIXED number
  // because the mark does not scale with --k.
  "layout", "logo_height_mm",
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
 * rather than duplicating the form.
 *
 * PR-10 / A2 — THE HOLDER NAME. `treasury_account` has carried TWO spellings of
 * "whose account is this": `beneficiary_name` (0516, the letterhead's own
 * addition) and `holder_name` (0520, the Treasury module's, which is what
 * every write path since then has populated). Selecting only the 0516 column —
 * as this query did — meant the letterhead/360 paths could never read the
 * holder Treasury actually owns. ONE source of truth now: `holder_name`,
 * with `beneficiary_name` as a legacy fallback for rows written before 0520
 * and never re-saved, coalesced HERE so no consumer has to know the history.
 */
async function treasuryAccounts(client, id) {
  // The bank-detail columns are selected because the letterhead's payment
  // block and the Banking & treasury tab are assembled from them — without
  // them `paymentBlock` finds nothing on every row and silently falls back to
  // the frozen `bank_block` forever, which defeats the whole point of making
  // treasury_account the source of truth.
  //
  // PR-10 / A0: these columns are NOT masked on the corporate-entity 360 and
  // letterhead surfaces (both MOD-01 `view` routes) — the owner's decision is
  // that a MOD-01 viewer sees the details their own invoices print. Other
  // surfaces (the Treasury module's own dossier, party banks) keep gate 14.
  const { rows } = await client.query(
    `SELECT treasury_account_id, kind, label, coa_code, currency, momo_network,
            is_active, is_primary, show_on_documents,
            bank_name, branch, account_number, iban, swift_bic,
            COALESCE(NULLIF(btrim(holder_name), ''), beneficiary_name) AS holder_name,
            created_at
       FROM treasury_account WHERE entity_id = $1 ORDER BY is_active DESC, kind, label`,
    [id],
  );
  return rows;
}

/* ── letterhead custom lines (12760) ────────────────────────────────────────
 * The lines derivation cannot reach — a strapline, a customs licence, a
 * trade-body membership. Per language, ordered, and placed on the sheet by
 * `entity_letterhead.layout` like any catalogued block.
 */

const LINE_WRITABLE = ["zone", "text_fr", "text_en", "sort_order", "is_active"];

const letterheadLines = async (client, id) => (await client.query(
  `SELECT * FROM entity_letterhead_line
     WHERE entity_id = $1
     ORDER BY zone, sort_order, created_at`,
  [id],
)).rows;

/**
 * Insert one line. The table's CHECK rejects a row with no text in either
 * language, so a blank line cannot be stored and then puzzle somebody in the
 * editor six months later.
 */
async function addLetterheadLine(client, id, fields, actorUserId = null) {
  const { rows } = await client.query(
    `INSERT INTO entity_letterhead_line (entity_id, zone, text_fr, text_en, sort_order, updated_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, 0), $6) RETURNING *`,
    [id, fields.zone || "footer", fields.text_fr ?? null, fields.text_en ?? null,
      fields.sort_order ?? null, actorUserId],
  );
  return rows[0];
}

/**
 * Update one line, scoped to its entity.
 *
 * `entity_id` is in the WHERE and not merely in the path: without it a line id
 * from one tenant's entity would edit another's, and the id is the only thing
 * the caller supplies.
 */
async function updateLetterheadLine(client, id, lineId, fields, actorUserId = null) {
  const patch = {};
  for (const k of LINE_WRITABLE) if (fields[k] !== undefined) patch[k] = fields[k];
  if (!Object.keys(patch).length) return null;
  if (actorUserId) patch.updated_by = actorUserId;
  const owned = await client.query(
    "SELECT 1 FROM entity_letterhead_line WHERE line_id = $1 AND entity_id = $2",
    [lineId, id],
  );
  if (!owned.rowCount) return null;
  return updateOne(
    client, "entity_letterhead_line", "line_id", lineId, patch, "*",
    [...LINE_WRITABLE, "updated_by"], { touch: "updated_at" },
  );
}

const deleteLetterheadLine = async (client, id, lineId) => (await client.query(
  "DELETE FROM entity_letterhead_line WHERE line_id = $1 AND entity_id = $2 RETURNING line_id",
  [lineId, id],
)).rowCount > 0;

module.exports = {
  letterheadLines, addLetterheadLine, updateLetterheadLine, deleteLetterheadLine,
  WRITABLE, LETTERHEAD_WRITABLE,
  insert, get, getByCode, first, update, updateInternal, list, listPaged,
  parentMap, children, ancestors, collections, usage, treasuryAccounts,
  documentsAndTax, taxObligations, obligations, obligationsDueWithin,
  // Tax obligation generator (PR-05)
  taxRegistrationsForGeneration, insertObligation, supersedeOpenForRegistration,
  supersedeUnexpectedForRegistration, markOverdue, obligationById,
  setObligationStatus, setObligationResponsible, markReminded, entitiesWithRegistrations,
  getLetterhead, upsertLetterhead,
};
