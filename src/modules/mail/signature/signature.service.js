/**
 * Signature resolution, rendering and cache.
 *
 * Send-time: compute source_hash over the live inputs; cache hit when it
 * matches; otherwise render and store. Invalidation is event-driven
 * (employee.updated, entity.updated) — never a manual flush, never a rewrite
 * of an already-sent email_message.body_html.
 */
"use strict";

const repo = require("./signature.repo");
const resolveMod = require("./signature.resolve");
const htmlMod = require("./signature.html");
const pngMod = require("./signature.png");
const { resolveLanguage } = require("./language");
const events = require("./signature.events");
const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");

function inputsFor(person, entity, profile, template, mailbox, language, identity, system) {
  return {
    employee_updated: person && (person.employee_id || person.job_title || person.department),
    employee: person && {
      full_name: person.employee_full_name || person.user_full_name,
      job_title: person.job_title,
      department: person.department,
    },
    entity_id: entity && entity.entity_id,
    entity_updated: entity && entity.updated_at,
    profile_updated: profile && profile.updated_at,
    template_id: template && template.signature_template_id,
    template_updated: template && template.updated_at,
    logo: entity && (entity.logo_url || entity.logo_light_ref),
    language,
    mailbox: mailbox && mailbox.email_address,
    identity: identity && identity.purpose,
    system: Boolean(system),
  };
}

function modelFrom(person, entity, profile, template, mailbox, language, identity, system) {
  return resolveMod.resolve({
    employee: person && {
      full_name: person.employee_full_name || person.user_full_name,
      job_title: person.job_title,
      department: person.department,
    },
    user: person && { full_name: person.user_full_name },
    entity,
    profile,
    template,
    mailbox,
    identity,
    system,
  }, language);
}

async function pickTemplate(client, { profile, person, templateId }) {
  if (templateId) {
    const t = await repo.getTemplate(client, templateId);
    if (t && t.is_active) return t;
  }
  if (profile && profile.signature_template_id) {
    const t = await repo.getTemplate(client, profile.signature_template_id);
    if (t && t.is_active) return t;
  }
  return repo.defaultTemplate(client, {
    department: person && person.department,
    entityId: person && person.entity_id,
  });
}

/**
 * Resolve the signature that should go on a message being sent NOW.
 *
 * @returns {{ html, text, model, language, cached }}
 */
async function resolveFor(client, {
  userId = null,
  connectionId = null,
  language: langHint = null,
  partyLanguage = null,
  repliedMessageLanguage = null,
  senderUiLanguage = null,
  tenantDefault = null,
  identity = null,
  system = false,
  format = "HTML",
  scale = 1,
} = {}) {
  const language = resolveLanguage({
    explicit: langHint,
    partyLanguage,
    repliedMessageLanguage,
    senderUiLanguage,
    tenantDefault,
  });

  const person = userId && !system ? await repo.loadPerson(client, userId) : null;
  const profile = userId && !system ? await repo.getProfile(client, userId) : null;
  if (profile && profile.is_enabled === false && !system) {
    return { html: "", text: "", model: null, language, cached: false, disabled: true };
  }

  const entity = await repo.loadEntity(client, (person && person.entity_id) || (identity && identity.entity_id) || null);
  const template = await pickTemplate(client, {
    profile,
    person,
    templateId: profile && profile.signature_template_id,
  });
  if (!template) {
    return { html: "", text: "", model: null, language, cached: false };
  }

  let mailbox = null;
  if (connectionId) {
    const { rows } = await client.query(
      `SELECT email_address, display_name FROM email_connection WHERE email_connection_id = $1`,
      [connectionId],
    );
    mailbox = rows[0] || null;
  }

  const hash = resolveMod.sourceHash(inputsFor(person, entity, profile, template, mailbox, language, identity, system));
  const identityKey = system ? `system:${(identity && identity.purpose) || "NOTIFICATIONS"}` : null;
  const cached = await repo.getCached(client, {
    userId: system ? null : userId,
    identityKey,
    language,
    format,
    scale,
  });
  if (cached && cached.source_hash === hash) {
    const model = modelFrom(person, entity, profile, template, mailbox, language, identity, system);
    return {
      html: format === "HTML" ? cached.content : htmlMod.render(model),
      text: resolveMod.textContent(model),
      model,
      language,
      cached: true,
      source_hash: hash,
    };
  }

  const model = modelFrom(person, entity, profile, template, mailbox, language, identity, system);
  const html = htmlMod.render(model);
  const text = resolveMod.textContent(model);

  if (format === "HTML") {
    await repo.putCached(client, {
      user_id: system ? null : userId,
      identity_key: identityKey,
      language, format, scale, content: html, source_hash: hash,
    });
  }

  return { html, text, model, language, cached: false, source_hash: hash };
}

async function renderPng(client, { userId, language = "en", scale = 1, shot = undefined }) {
  const r = await resolveFor(client, { userId, language, format: "PNG", scale });
  if (!r.model) throw new AppError("NOT_FOUND", "No signature to render", 404);
  const png = await pngMod.render(r.model, scale, shot);
  await repo.putCached(client, {
    user_id: userId,
    identity_key: null,
    language: r.language,
    format: "PNG",
    scale: png.scale,
    content: null,
    storage_path: null,
    source_hash: r.source_hash,
  });
  return png;
}

async function getOwnProfile(client, userId) {
  const person = await repo.loadPerson(client, userId);
  const profile = await repo.getProfile(client, userId);
  const preview = await resolveFor(client, { userId, language: (profile && profile.language) || "en" });
  return { person, profile, preview };
}

async function saveOwnProfile(client, userId, fields, actor = {}) {
  const row = await repo.upsertProfile(client, userId, fields);
  await repo.deleteCachedForUser(client, userId);
  await emitEvent(client, {
    eventTypeKey: events.PROFILE_CHANGED, moduleKey: events.MODULE,
    entityRef: events.profileRef(userId), actorUserId: actor.user_id || userId,
    payload: { fields: Object.keys(fields || {}) },
  }).catch(() => { /* @silent:storage the profile row is the outcome */ });
  return row;
}

async function listTemplates(client, q) {
  return repo.listTemplates(client, q);
}

async function updateTemplate(client, id, fields, actor = {}) {
  const before = await repo.getTemplate(client, id);
  if (!before) throw new AppError("NOT_FOUND", "template not found", 404);
  if (fields.is_active === false && before.is_system) {
    throw new AppError("SYSTEM_TEMPLATE", "A seeded template can be edited but not deactivated or deleted.", 422);
  }
  const row = await repo.updateTemplate(client, id, fields);
  await repo.deleteAllCached(client);
  await emitEvent(client, {
    eventTypeKey: events.TEMPLATE_CHANGED, moduleKey: events.ADMIN_MODULE,
    entityRef: events.ref(id), actorUserId: actor.user_id || null,
    payload: { key: row.key },
  }).catch(() => { /* @silent:storage the template row is the outcome */ });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "signature.template.changed",
    moduleKey: events.ADMIN_MODULE, entityRef: events.ref(id),
    before, after: row,
  }).catch(() => { /* @silent:storage */ });
  return row;
}

async function invalidateForUser(client, userId) {
  await repo.deleteCachedForUser(client, userId);
  await emitEvent(client, {
    eventTypeKey: events.CACHE_INVALIDATED, moduleKey: events.MODULE,
    entityRef: events.profileRef(userId), payload: { reason: "employee.updated" },
  }).catch(() => { /* @silent:storage invalidation is the delete */ });
  return { user_id: userId, invalidated: true };
}

/**
 * Everything derived from the company: staff renders AND the system blocks.
 *
 * The staff half was here. The SYSTEM half was not, and on an entity change it
 * is the half that matters most: the corporate block on an OTP, a notification
 * or an invoice mail is derived entirely from `corporate_entity` — legal name,
 * address, P.O. Box, RCCM, NIU, share capital. Those renders are keyed by
 * `identity_key` rather than by a user, so `deleteCachedForUser` never reached
 * them; `signature_render` has no TTL; and a company that changed office would
 * have gone on printing its old address on system mail indefinitely.
 * `deleteCachedForIdentity` existed for exactly this and had no caller.
 *
 * Every identity is dropped rather than a computed subset: they all render the
 * same corporate block from the same entity, so there is no identity that an
 * entity change leaves correct, and the cost is one re-render on next send.
 */
async function invalidateForEntity(client, entityId) {
  const users = await repo.usersForEntity(client, entityId);
  for (const id of users) await repo.deleteCachedForUser(client, id);
  const identities = await repo.deleteAllIdentityCached(client);
  await emitEvent(client, {
    eventTypeKey: events.CACHE_INVALIDATED, moduleKey: events.MODULE,
    entityRef: `corporate_entity:${entityId}`,
    payload: { reason: "entity.updated", users: users.length, identities },
  }).catch(() => { /* @silent:storage */ });
  return { entity_id: entityId, users: users.length, identities };
}

/**
 * Attach a resolved signature to already-serialized body parts.
 * Never rewrites a stored email_message — callers pass the HTML they are
 * about to queue.
 */
function bake(html, text, resolved) {
  if (!resolved || resolved.disabled || !resolved.html) return { html, text };
  return {
    html: htmlMod.appendToHtml(html, resolved.html),
    text: htmlMod.appendToText(text, resolved.text),
  };
}

module.exports = {
  resolveFor, renderPng, getOwnProfile, saveOwnProfile,
  listTemplates, updateTemplate, invalidateForUser, invalidateForEntity, bake,
};
