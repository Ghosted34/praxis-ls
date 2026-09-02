/**
 * Corporate entities (MOD-01) — the legal companies a tenant operates. Every
 * dossier, invoice and ledger entry hangs off an entity_id. Code is unique; NIU/
 * RCCM, doc_prefix and fiscal-year-start drive numbering and statutory outputs.
 * All SQL is in the repo; the pure rules are in rules.js.
 *
 * Since 0515 an entity is a dossier rather than a form: statutory identity, group
 * structure, people and shareholding, contacts, addresses and registrations, plus
 * the downstream defaults (currency, payroll country, accounting framework) that
 * HR, payroll and invoicing inherit when a user picks this entity.
 */
"use strict";

const crypto = require("crypto");
const repo = require("./corporate_entity.repo");
const events = require("./corporate_entity.events");
const rules = require("./corporate_entity.rules");
const renewalRules = require("./corporate_entity.renewals");
const letterheadService = require("../entity-letterhead.service");
const letterheadBlocks = require("../../../services/documents/templates/letterhead-blocks");
const dossierService = require("../entity-360.service");
const { maskBank } = require("../_shared/confidential");
const storage = require("../../../services/storage.service");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const opsRef = require("../../../services/documents/operation-reference");

const ref = (id) => "corporate_entity:" + id;

// Per-entity document logo upload — mirrors branding.uploadLogo, but keyed per
// entity and gated MOD-01 (branding's own upload is MOD-70, which would force
// settings-admin rights just to set an entity's letterhead logo).
const LOGO_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };
const MAX_LOGO_BYTES = 512 * 1024;

/**
 * Old camelCase argument names -> the column they meant. The pre-fix create()
 * took a hand-picked camelCase object, which is exactly how DATA 2.7 happened:
 * the shared schema validated ~40 snake_case fields, the controller re-mapped
 * 18 of them by hand, and the other twenty were silently dropped on POST while
 * PATCH (driven by repo.WRITABLE) persisted them all — so the edit modal opened
 * half-empty on an entity the user had just filled in completely. The map keeps
 * any straggler caller on the old shape working while the column names are now
 * the one canonical spelling.
 */
const CREATE_CAMEL_ALIASES = {
  legalName: "legal_name", tradingName: "trading_name", countryCode: "country_code",
  bankBlock: "bank_block", docPrefix: "doc_prefix", defaultLanguage: "default_language",
  fiscalYearStartMonth: "fiscal_year_start_month", legalForm: "legal_form",
  incorporationDate: "incorporation_date", accountingFramework: "accounting_framework",
  registrationStatus: "registration_status", parentEntityId: "parent_entity_id",
  relationshipType: "relationship_type",
};

/**
 * Register a corporate entity.
 *
 * `input` is the schema-validated body (entityCommon.masterCreate) in COLUMN
 * NAMES, plus `actor`. Every writable column is accepted through the SAME
 * allow-list the PATCH path uses (repo.WRITABLE), so a field the shared schema
 * accepts can never again be silently dropped between validation and INSERT —
 * create and update agree by construction instead of by two hand-kept lists.
 *
 * `actorArg` exists for the AI write adapter, which calls
 * `service(client, payload, actor)` with the actor as a third positional
 * argument rather than folded into the body.
 */
async function create(client, input = {}, actorArg = null) {
  const { actor = actorArg || {}, ...body } = input;
  for (const [camel, col] of Object.entries(CREATE_CAMEL_ALIASES)) {
    if (body[camel] !== undefined && body[col] === undefined) body[col] = body[camel];
    delete body[camel];
  }

  const code = body.code;
  const existing = await repo.getByCode(client, code);
  if (existing) throw new AppError("DUPLICATE_CODE", "An entity with code " + code + " already exists", 409);
  rules.assertFiscalMonth(body.fiscal_year_start_month);

  if (body.parent_entity_id) {
    const parent = await repo.get(client, body.parent_entity_id);
    if (!parent) throw new AppError("NOT_FOUND", "The parent entity does not exist", 404);
  }

  // Column values for the INSERT. Nulls are dropped ON CREATE only: there is no
  // previous value to clear, and omitting the column is what lets the DEFAULTs
  // and the 0515 triggers derive `accounting_framework`, `default_currency`,
  // `payroll_country`, `incorporation_country`, `numbering_reset`, `doc_prefix`,
  // `default_language` and `country_code` — the trigger is the one place that
  // knows how to read country_profile. (PATCH keeps sending explicit nulls,
  // because there a null means "clear this".)
  const fields = { code };
  for (const k of repo.WRITABLE) {
    if (body[k] !== undefined && body[k] !== null) fields[k] = body[k];
  }
  if (fields.bank_block !== undefined) fields.bank_block = JSON.stringify(fields.bank_block || {});
  // Service-owned column, so not in WRITABLE — but the create schema allows
  // starting life as a DRAFT, and the 0515 trigger defaults it to ACTIVE.
  if (body.registration_status) fields.registration_status = body.registration_status;

  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, fields);
    // The two-character marker that leads this entity's OPERATION-file
    // references (`SL` in `SL7Z3K9QW2M4XBSM`) — derived from the name, walked
    // past anything already taken, and persisted once. Assigned here, in the
    // same transaction, rather than lazily on the entity's first dossier: it
    // shows on the entity's own page, and an administrator who wants a
    // different one should see what they are changing before any file has been
    // opened against it.
    const opsPrefix = await opsRef.entityPrefix(client, row.entity_id);
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.entity_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.entity_id), after: row });
    await client.query("COMMIT");
    return { ...row, ops_reference_prefix: opsPrefix };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Set the entity's operation-reference prefix.
 *
 * ONCE A FILE HAS USED IT, IT IS FROZEN. A reference is a string stored on the
 * dossier row and printed on documents that have left the building; changing
 * the prefix afterwards cannot rewrite them and must not try. It would only
 * mean two prefixes meaning "this entity", with nothing recording when the
 * meaning changed. Before the first file, an administrator is free to pick the
 * initials the business actually uses.
 *
 * The uniqueness itself is `ux_corporate_entity_ops_reference_prefix`; this
 * turns its 23505 into a field error, because a bare 409 from the generic
 * handler does not say which of the entity's forty columns is at fault.
 */
async function setOpsReferencePrefix(client, { id, prefix, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);
  if (before.ops_reference_prefix === prefix) return before;

  if (before.ops_reference_prefix) {
    // `dossier_visible`, so a half-finished wizard draft — which holds a
    // `DRAFT-` placeholder, not a reference built from this prefix — does not
    // freeze the prefix of an entity nobody has actually opened a file against.
    const used = await client.query(
      "SELECT 1 FROM dossier_visible WHERE entity_id = $1 LIMIT 1",
      [id],
    );
    if (used.rowCount) {
      throw new AppError(
        "PREFIX_IN_USE",
        `Operation files already carry the prefix "${before.ops_reference_prefix}". It cannot be changed without renaming references that have been issued.`,
        422,
        { ops_reference_prefix: ["already used by existing operation files"] },
      );
    }
  }

  let row;
  try {
    row = await repo.updateInternal(client, id, { ops_reference_prefix: prefix });
  } catch (err) {
    if (err && err.code === "23505" && /ops_reference_prefix/.test(String(err.constraint || ""))) {
      throw new AppError("PREFIX_TAKEN", `Another entity already uses the prefix "${prefix}"`, 422, {
        ops_reference_prefix: ["already in use"],
      });
    }
    throw err;
  }
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: events.OPS_PREFIX_CHANGED,
    moduleKey: events.MODULE,
    entityRef: ref(id),
    before: { ops_reference_prefix: before.ops_reference_prefix },
    after: { ops_reference_prefix: row.ops_reference_prefix },
  });
  return row;
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);

  const fields = {};
  for (const k of repo.WRITABLE) if (patch[k] !== undefined) fields[k] = patch[k];
  if (patch.bank_block !== undefined) fields.bank_block = JSON.stringify(patch.bank_block || {});
  rules.assertFiscalMonth(fields.fiscal_year_start_month);

  // Re-parenting through the generic PATCH goes through the same cycle guard as
  // the dedicated structure endpoint — otherwise the guard is one request away
  // from being bypassed.
  if (fields.parent_entity_id !== undefined && fields.parent_entity_id) {
    const parent = await repo.get(client, fields.parent_entity_id);
    if (!parent) throw new AppError("NOT_FOUND", "The parent entity does not exist", 404);
    rules.assertNoCycle(id, fields.parent_entity_id, await repo.parentMap(client));
  }

  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Move an entity along the lifecycle ladder.
 *
 * The 0515 trigger keeps `is_active` in step, so nothing else in the codebase
 * needs to learn about the ladder to keep working. Archiving is refused while
 * subsidiaries still point here — orphaning them would leave a group tree with a
 * dangling parent and no way to notice.
 */
async function setStatus(client, { id, status, reason = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);

  rules.assertTransition(before.registration_status, status);
  rules.assertReasonFor(status, reason);

  if (["ARCHIVED", "DEACTIVATED"].includes(status)) {
    const { subsidiaries } = await repo.usage(client, id);
    if (subsidiaries > 0) {
      throw new AppError(
        "HAS_SUBSIDIARIES",
        `This entity is still the parent of ${subsidiaries} other ${subsidiaries === 1 ? "entity" : "entities"}. Re-parent or archive them first.`,
        409,
      );
    }
  }

  // DATA 2.4. `status_changed_by` is REFERENCES app_user(user_id), and identity
  // is pinned to the LIVE schema while this write lands in whichever schema the
  // request selected. Storing a perfectly valid live user id beside SANDBOX
  // business data raises 23503 and takes the whole status change with it.
  // `resolveActorId` degrades to NULL rather than losing the operation — the same
  // guard emit.js applies to its own actor columns.
  const actorId = await resolveActorId(client, actor.user_id);

  await client.query("BEGIN");
  try {
    const row = await repo.updateInternal(client, id, {
      registration_status: status,
      status_changed_by: actorId,
      ...(reason !== null ? { deactivation_reason: reason } : {}),
    });
    const action = `entity.status.${status.toLowerCase()}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null, payload: { from: before.registration_status, to: status, reason } });
    await audit(client, { actorUserId: actor.user_id || null, action, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

/**
 * Legacy activate/deactivate. Kept because POST /entities/:id/active is a
 * published route and the AI tool `set_entity_active` calls it; it now routes
 * through the ladder so both surfaces agree on what "inactive" means.
 */
async function setActive(client, { id, active, reason = null, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);
  const target = active === true ? "ACTIVE" : "DEACTIVATED";
  if (before.registration_status === target) return before;
  return setStatus(client, { id, status: target, reason: reason || (active ? null : "Deactivated"), actor });
}

/** Set or clear the group-structure fields. */
async function setStructure(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);

  const fields = {};
  for (const k of ["parent_entity_id", "relationship_type", "ownership_percent", "consolidates", "is_group_parent"]) {
    if (patch[k] !== undefined) fields[k] = patch[k];
  }

  if (fields.parent_entity_id) {
    const parent = await repo.get(client, fields.parent_entity_id);
    if (!parent) throw new AppError("NOT_FOUND", "The parent entity does not exist", 404);
    rules.assertNoCycle(id, fields.parent_entity_id, await repo.parentMap(client));
  }

  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.STRUCTURE_CHANGED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Store a per-entity logo (base64 data URL) and persist its public /media URL on
 * the entity. `variant` picks the light or dark letterhead slot. Keys are
 * namespaced per tenant + entity so nothing collides on shared local disk.
 */
async function uploadLogo(client, { id, dataUrl, variant = "light", slug, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);

  const m = /^data:([^;]+);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) throw new AppError("BAD_IMAGE", "Expected a base64 image data URL", 400);
  const contentType = m[1].toLowerCase();
  const ext = LOGO_EXT[contentType];
  if (!ext) throw new AppError("UNSUPPORTED_IMAGE", "Unsupported image type: " + contentType, 400);
  const buffer = Buffer.from(m[2], "base64");
  if (!buffer.length) throw new AppError("EMPTY_IMAGE", "Image is empty", 422);
  if (buffer.length > MAX_LOGO_BYTES) throw new AppError("IMAGE_TOO_LARGE", "Logo must be 512 KB or smaller", 413);

  const key = `tenant_${slug}/entity/${id}/logo_${variant}_${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const stored = await storage.put(buffer, { key, contentType });
  const column = variant === "dark" ? "logo_dark_ref" : "logo_light_ref";
  const row = await repo.updateInternal(client, id, { [column]: stored.public_url });
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Read or update the letterhead configuration, returning the rendered result so
 * the designer's preview always reflects what was actually stored rather than
 * what the client believes it sent.
 *
 * `remittance_account_id` lives on `corporate_entity`, not on the letterhead
 * row, but it is edited from the same panel — so it is accepted here and routed
 * to the right table, with the account verified to belong to this entity first.
 * Without that check an operator could point one entity's payment block at
 * another entity's bank account.
 */
async function saveLetterhead(client, { id, patch = {}, actor = {} }) {
  const entity = await repo.get(client, id);
  if (!entity) throw new AppError("NOT_FOUND", "Entity not found", 404);

  const before = await repo.getLetterhead(client, id);

  if (patch.remittance_account_id !== undefined) {
    const accountId = patch.remittance_account_id;
    if (accountId) {
      const owned = (await repo.treasuryAccounts(client, id))
        .some((t) => String(t.treasury_account_id) === String(accountId));
      if (!owned) {
        throw new AppError("NOT_FOUND", "That treasury account does not belong to this entity", 404);
      }
    }
    await repo.updateInternal(client, id, { remittance_account_id: accountId || null });
  }

  // DATA 2.4, same hazard as setStatus: `entity_letterhead.updated_by` is
  // REFERENCES app_user(user_id). check-actor-fk-guard.js does not flag this one
  // because it looks for the object-literal idiom and here the id arrives as a
  // positional argument — but the 23503 on a SANDBOX write is identical, so it is
  // guarded anyway rather than left to the gate's reach.
  const row = await repo.upsertLetterhead(client, id, patch, await resolveActorId(client, actor.user_id));
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.LETTERHEAD_UPDATED,
    moduleKey: events.MODULE, entityRef: ref(id), before, after: row,
  });
  return letterhead(client, id);
}

/** The stored configuration plus its rendered preview, in one or both languages. */
async function letterhead(client, id, lang = null, { financials = false } = {}) {
  const entity = await repo.get(client, id);
  if (!entity) throw new AppError("NOT_FOUND", "Entity not found", 404);
  const { addresses, registrations, establishments } = await repo.collections(client, id);
  const { tax_registrations: taxRegistrations, letterhead: config } = await repo.documentsAndTax(client, id);
  const treasuryAccounts = await repo.treasuryAccounts(client, id);
  const input = { entity, config, addresses, registrations, taxRegistrations, treasuryAccounts, establishments };
  // Same confidentiality rule as the dossier: the payment block and the account
  // list both carry the number, and this route is MOD-01 `view`.
  const mask = (p) => dossierService.maskPaymentBlock(p, financials);
  /*
   * The COMPOSED blocks — what the editor drags and what the renderer prints.
   *
   * `preview` below is the older, flatter shape: named header/footer strings
   * the previous designer hand-drew from. It stays because the entity 360
   * summary and the AI entity cards read it, and because a flat shape is the
   * right one for "tell me this entity's address line". `blocks` is the one the
   * editor works in, and the one `template.service` folds into every render, so
   * the sheet on screen and the sheet that prints are the same composition.
   */
  const customLines = await repo.letterheadLines(client, id);
  const composeInput = {
    entity, config, addresses, establishments, treasuryAccounts, customLines,
    layout: (config && config.layout) || null,
    logo_url: entity.logo_light_ref || null,
  };
  const composeFor = (l) => {
    const c = letterheadBlocks.compose(composeInput, l);
    return {
      ...c,
      // The payment block carries an account number and this route is MOD-01
      // `view`, not a financial grant — same rule the dossier applies.
      footer: c.footer.map((b) => (b.id === "payment" && !financials
        ? { ...b, lines: b.lines.map(() => ({ type: "text", text: "••••" })) }
        : b)),
    };
  };

  return {
    config: config || { entity_id: id, ...letterheadService.DEFAULT_CONFIG },
    remittance_account_id: entity.remittance_account_id || null,
    treasury_accounts: treasuryAccounts.map((t) => maskBank(t, financials)),
    // Both languages, always: a French entity that also invoices in English
    // needs to see both, and rendering twice is free (it is a pure function).
    preview: {
      fr: mask(letterheadService.render(input, "fr")),
      en: mask(letterheadService.render(input, "en")),
    },
    blocks: { fr: composeFor("fr"), en: composeFor("en") },
    custom_lines: customLines,
    // What the editor may ADD, where each block's content comes from, and which
    // dossier tab and field fixes it — the deep link is a property of the
    // catalogue, so the editor never hardcodes a route.
    catalogue: letterheadBlocks.catalogue(lang === "fr" ? "fr" : "en"),
    tokens: letterheadBlocks.tokens(lang === "fr" ? "fr" : "en"),
    language: lang || entity.default_language || "en",
  };
}

/**
 * Add, edit or remove one tenant-authored letterhead line.
 *
 * Returns the whole letterhead bundle rather than the row, for the same reason
 * `saveLetterhead` does: the editor's canvas must reflect what was STORED, and
 * a line that changed the composed height has just changed the page.
 */
async function saveLetterheadLine(client, { id, lineId = null, patch = {}, remove = false, actor = {} }) {
  const entity = await repo.get(client, id);
  if (!entity) throw new AppError("NOT_FOUND", "Entity not found", 404);
  const actorId = await resolveActorId(client, actor.user_id);
  const before = await repo.letterheadLines(client, id);

  if (remove) {
    // `LINE_REQUIRED`, not a generic `BAD_REQUEST`: doc/ERROR_CODES.md is
    // generated from these and a code a client already switches on cannot be
    // renamed, so a new one is worth naming for what it means. 422 is the
    // repo's status for every other `*_REQUIRED`.
    if (!lineId) throw new AppError("LINE_REQUIRED", "A line id is required to remove a line", 422);
    const gone = await repo.deleteLetterheadLine(client, id, lineId);
    if (!gone) throw new AppError("NOT_FOUND", "That letterhead line does not belong to this entity", 404);
  } else if (lineId) {
    const row = await repo.updateLetterheadLine(client, id, lineId, patch, actorId);
    if (!row) throw new AppError("NOT_FOUND", "That letterhead line does not belong to this entity", 404);
  } else {
    await repo.addLetterheadLine(client, id, patch, actorId);
  }

  await audit(client, {
    actorUserId: actor.user_id || null, action: events.LETTERHEAD_UPDATED,
    moduleKey: events.MODULE, entityRef: ref(id),
    before, after: await repo.letterheadLines(client, id),
  });
  return letterhead(client, id);
}

/** Renewals due across documents, registrations and tax registrations. */
async function renewals(client, id, asOf = null) {
  const entity = await repo.get(client, id);
  if (!entity) throw new AppError("NOT_FOUND", "Entity not found", 404);
  const { registrations } = await repo.collections(client, id);
  const { documents, tax_registrations: taxRegistrations } = await repo.documentsAndTax(client, id);
  return renewalRules.renewals({ documents, registrations, taxRegistrations }, asOf);
}

/** Cap-table reconciliation for one entity, as of a date. Advisory, never throws. */
async function capTable(client, id, asOf = null) {
  const entity = await repo.get(client, id);
  if (!entity) throw new AppError("NOT_FOUND", "Entity not found", 404);
  const { people } = await repo.collections(client, id);
  return rules.reconcileCapTable(people, entity, asOf);
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);

module.exports = {
  create, update, setStatus, setActive, setStructure, uploadLogo, capTable,
  letterhead, saveLetterhead, saveLetterheadLine, renewals, get, list, setOpsReferencePrefix,
};
