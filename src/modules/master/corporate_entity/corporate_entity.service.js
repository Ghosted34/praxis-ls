/**
 * Corporate entities (MOD-01) — the legal companies a tenant operates. Every
 * dossier, invoice and ledger entry hangs off an entity_id. Code is unique; NIU/
 * RCCM, doc_prefix and fiscal-year-start drive numbering and statutory outputs.
 * All SQL is in the repo.
 */
"use strict";

const crypto = require("crypto");
const repo = require("./corporate_entity.repo");
const events = require("./corporate_entity.events");
const storage = require("../../../services/storage.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const ref = (id) => "corporate_entity:" + id;

// Per-entity document logo upload — mirrors branding.uploadLogo, but keyed per
// entity and gated MOD-01 (branding's own upload is MOD-70, which would force
// settings-admin rights just to set an entity's letterhead logo).
const LOGO_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };
const MAX_LOGO_BYTES = 512 * 1024;

async function create(client, { code, legalName, niu = null, rccm = null, countryCode = "CM", address = null, bankBlock = {}, docPrefix = "SLS", defaultLanguage = "fr", fiscalYearStartMonth = 1, actor = {} }) {
  const existing = await repo.getByCode(client, code);
  if (existing) throw new AppError("DUPLICATE_CODE", "An entity with code " + code + " already exists", 409);
  if (fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12) throw new AppError("BAD_MONTH", "fiscal_year_start_month must be 1-12", 422);
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, {
      code, legal_name: legalName, niu, rccm, country_code: countryCode, address,
      bank_block: JSON.stringify(bankBlock || {}), doc_prefix: docPrefix, default_language: defaultLanguage, fiscal_year_start_month: fiscalYearStartMonth,
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.entity_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.entity_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);
  const fields = {};
  for (const k of ["legal_name", "niu", "rccm", "country_code", "address", "doc_prefix", "default_language", "fiscal_year_start_month", "logo_light_ref", "logo_dark_ref"]) if (patch[k] !== undefined) fields[k] = patch[k];
  if (patch.bank_block !== undefined) fields.bank_block = JSON.stringify(patch.bank_block || {});
  if (fields.fiscal_year_start_month !== undefined && (fields.fiscal_year_start_month < 1 || fields.fiscal_year_start_month > 12)) throw new AppError("BAD_MONTH", "fiscal_year_start_month must be 1-12", 422);
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function setActive(client, { id, active, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Entity not found", 404);
  const row = await repo.update(client, id, { is_active: active === true });
  await audit(client, { actorUserId: actor.user_id || null, action: active ? "entity.activated" : "entity.deactivated", moduleKey: events.MODULE, entityRef: ref(id), after: row });
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
  const row = await repo.update(client, id, { [column]: stored.public_url });
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, setActive, uploadLogo, get, list };
