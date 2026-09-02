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
const paletteMod = require("./signature.palette");
const gapsMod = require("./signature.gaps");
const zipMod = require("./signature.zip");
const htmlMod = require("./signature.html");
const pngMod = require("./signature.png");
const { resolveLanguage } = require("./language");
const events = require("./signature.events");
const { AppError } = require("../../../utils/errors");
const { emitEvent, audit } = require("../../../shared/events/emit");
const brandLogo = require("../../../services/brand-logo.service");
const storage = require("../../../services/storage.service");
const { config } = require("../../../config/env");
const { logger } = require("../../../config/logger");
const metrics = require("../../../shared/observability/metrics");

/**
 * The employee fields the renderer reads, projected out of `loadPerson`'s row.
 *
 * Shared by `inputsFor` and `modelFrom` because they must agree: a field the
 * model renders but the hash does not cover is a field whose change never
 * invalidates the cache, so the signature keeps showing the old value until
 * something unrelated happens to move. They were two separate object literals
 * and the phone columns would have been added to one of them.
 */
function employeeOf(person) {
  if (!person) return null;
  return {
    // Not rendered on any card — carried so `signature.gaps` can link a missing
    // job title to THIS person's dossier instead of to a list of everyone. It
    // joins the hash rather than being added to the model alone, because this
    // shape is deliberately the single definition both sides read (above).
    employee_id: person.employee_id || null,
    full_name: person.employee_full_name || person.user_full_name,
    job_title: person.job_title,
    department: person.department,
    email: person.employee_email || person.user_email || null,
    phone_desk: person.employee_phone_desk || null,
    phone_mobile: person.employee_phone_mobile || null,
  };
}

/**
 * Bump this when the RENDERER changes what it produces from unchanged data.
 *
 * `source_hash` covers the inputs — employee, entity, template, branding — and
 * nothing about the code. That is correct for data staleness and silently wrong
 * for everything else: a signature rendered while the card PNG was failing was
 * cached as HTML with no <img>, and because none of its inputs changed, every
 * subsequent send returned that same broken HTML from the cache. Shipping a fix
 * did nothing. Two rounds of "why is it still not working" were this.
 *
 * So the renderer's own version is an input. Changing it invalidates every
 * cached render at once, which is exactly what a render-behaviour fix needs and
 * costs one re-render per person on their next send.
 *
 *   1 — card + text fallback (#288)
 *   2 — servable storage key, branded fallback (#289)
 *   3 — chromium resolved by probe, screenshot coerced to Buffer
 */
const RENDERER_VERSION = 3;

function inputsFor(person, entity, profile, template, mailbox, language, identity, system, branding) {
  return {
    renderer: RENDERER_VERSION,
    employee_updated: person && (person.employee_id || person.job_title || person.department),
    employee: employeeOf(person),
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
    // The card's colours and fonts come from tenant branding, so branding IS an
    // input to the render. Leaving it out would mean a tenant changing their
    // brand colour saw the old palette on every cached signature until something
    // else happened to change — the exact staleness `source_hash` exists to stop.
    branding: branding || null,
  };
}

function modelFrom(person, entity, profile, template, mailbox, language, identity, system, extras = {}) {
  const model = resolveMod.resolve({
    employee: employeeOf(person),
    user: person && { full_name: person.user_full_name },
    entity,
    profile,
    template,
    mailbox,
    identity,
    system,
    logo: extras.logo || null,
  }, language);

  // The card renderer reads its palette and families off the model, so both are
  // resolved once here rather than at each of the three call sites (preview,
  // PNG, send) that would otherwise each have to remember to do it.
  const layout = (template && template.layout) || {};
  model.palette = paletteMod.resolve(extras.branding || {}, layout);
  model.fonts = paletteMod.fonts(layout);
  return model;
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
  tenantSlug = null,
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

  /*
   * WHICH COMPANY IS THIS SIGNATURE FROM?
   *
   * In a group with several legal entities the answer is NOT "the primary one"
   * — there is no such column on `corporate_entity`, and there should not be.
   * A signature carries the address of the entity that EMPLOYS the sender: if
   * you work for the Douala subsidiary, your mail must show Douala's
   * registered address, not the group flagship's.
   *
   * So, in order:
   *   employee — the entity on the sender's own staff record. The right answer.
   *   mailbox  — the entity bound to the identity being sent from. Correct for
   *              a shared box like ops@ that belongs to one entity.
   *   fallback — `loadEntity(null)` takes the OLDEST ACTIVE entity. That is a
   *              guess, and it is silent, and on a one-entity tenant it happens
   *              to be right every time, which is exactly why it went unnoticed.
   *
   * The provenance is carried rather than discarded because the third case is a
   * data gap worth telling someone about: the card prints a company the sender
   * is not recorded as working for. `signature.gaps` turns it into a link to
   * the staff record that would settle it.
   */
  const entitySource = (person && person.entity_id)
    ? "employee"
    : ((identity && identity.entity_id) ? "mailbox" : "fallback");
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

  const branding = await repo.loadBranding(client);
  // Bytes, not a reference: the card renders in headless Chromium, which cannot
  // resolve a relative /media URL. See services/brand-logo.service.js.
  const logo = await brandLogo.entityLogo(client, entity);

  const hash = resolveMod.sourceHash(
    inputsFor(person, entity, profile, template, mailbox, language, identity, system, branding),
  );
  const identityKey = system ? `system:${(identity && identity.purpose) || "NOTIFICATIONS"}` : null;
  const extras = { branding, logo };
  const cached = await repo.getCached(client, {
    userId: system ? null : userId,
    identityKey,
    language,
    format,
    scale,
  });
  if (cached && cached.source_hash === hash) {
    const model = modelFrom(person, entity, profile, template, mailbox, language, identity, system, extras);
    model.entity_source = entitySource;
    // The template that produced this render — the motto is authored on it, so
    // a missing-motto gap needs its id to link anywhere at all.
    model.template_id = template.signature_template_id || null;
    model.card_png_url = cached.storage_path ? mediaUrl(cached.storage_path) : null;
    return {
      html: format === "HTML" ? cached.content : htmlMod.render(model),
      text: resolveMod.textContent(model),
      model,
      language,
      cached: true,
      source_hash: hash,
    };
  }

  const model = modelFrom(person, entity, profile, template, mailbox, language, identity, system, extras);
  model.entity_source = entitySource;
  // The template that produced this render — the motto is authored on it, so
  // a missing-motto gap needs its id to link anywhere at all.
  model.template_id = template.signature_template_id || null;
  const text = resolveMod.textContent(model);

  if (format === "HTML") {
    // A card's email body is an <img> plus the text fallback, so the PNG has to
    // EXIST before the HTML that points at it is cached. Rendering it here — on
    // the miss, not on every send — is what makes that ordering hold without a
    // second pass. A failure to screenshot degrades to the text half rather than
    // failing the send: an email that goes out with a plain signature is a far
    // better outcome than one that does not go out.
    if (model.kind === "card") {
      model.card_png_url = await ensureCardPng(client, {
        model, userId, identityKey, language, hash, tenantSlug,
      });
    }
    const html = htmlMod.render(model);
    await repo.putCached(client, {
      user_id: system ? null : userId,
      identity_key: identityKey,
      language, format, scale, content: html, source_hash: hash,
      storage_path: model.card_png_url ? storagePathOf(model.card_png_url) : null,
    });
    return { html, text, model, language, cached: false, source_hash: hash };
  }

  return { html: htmlMod.render(model), text, model, language, cached: false, source_hash: hash };
}

/**
 * The absolute URL an email client can fetch the card from.
 *
 * `storage.publicUrl` returns `/media/<key>` — correct for the app's own pages
 * and useless in an email, where there is no page origin to resolve against. The
 * tenant's own host is the right base: a signature on mail from
 * smartls.praxisls.com should load from smartls.praxisls.com.
 */
function mediaUrl(key) {
  const k = String(key || "").replace(/^\/media\//, "").replace(/^\/+/, "");
  if (!k) return null;
  if (/^https?:/i.test(k)) return k;
  return `https://${config.APP_BASE_DOMAIN}/media/${k}`;
}

const storagePathOf = (url) => String(url || "").replace(/^https?:\/\/[^/]+\/media\//i, "") || null;

/**
 * Render the card at 2× and put it in storage, returning its absolute URL.
 *
 * 2× because the image is displayed at 650 CSS px and a 1× copy is visibly soft
 * on the retina and HiDPI screens most people now read mail on; 3× would triple
 * the bytes on every message for no visible gain at this size.
 *
 * PUBLIC key prefix, deliberately: this image is embedded in outbound email and
 * has to be fetchable by a recipient who has no session here. It carries a
 * person's name, title and work contact details — the same things the signature
 * itself publishes to that recipient — and nothing else.
 */
/**
 * The tenant namespace for a storage key.
 *
 * Every other storage caller takes the slug from `req.tenant.slug`, because
 * every other one is reached from a request. This is not: it runs on the SEND
 * path, three frames below `email.service.send`, and the two functions in
 * between (`attachSystemSignature`, `outbox.attachSignature`) do not carry a
 * slug. Threading one through both — and through every future send path — to
 * name a file is a lot of surface for a small job, and a path that forgets it
 * produces a key that does not serve, which is the bug this whole function
 * exists to stop happening twice.
 *
 * So it is derived instead: the caller may pass a slug, and otherwise the
 * database names itself. Tenants are separate databases, so that is stable,
 * always available, and unique per tenant — which is all a namespace has to be.
 * Memoised per connection-pool lifetime because it cannot change under us.
 */
let namespaceCache = null;
async function tenantNamespace(client, tenantSlug) {
  const clean = (v) => String(v || "").toLowerCase().replace(/[^\w-]/g, "");
  if (tenantSlug) return clean(tenantSlug) || "unknown";
  if (namespaceCache) return namespaceCache;
  try {
    const { rows } = await client.query("SELECT current_database() AS db");
    namespaceCache = clean(rows[0] && rows[0].db) || "unknown";
  } catch {
    /* @silent:storage a namespace we cannot read is not a reason to skip the
       render — "unknown" still produces a servable, correctly-shaped key. */
    namespaceCache = "unknown";
  }
  return namespaceCache;
}

async function ensureCardPng(client, { model, userId, identityKey, language, hash, tenantSlug }) {
  const who = String(userId || identityKey || "system").replace(/[^\w-]/g, "");
  // `tenant_<slug>/signatures/...` — the shape every other storage caller uses,
  // and the ONLY shape /media will serve. The first version of this wrote
  // `public/signatures/...`, which reads as though it says "public" and does the
  // opposite: media-guard takes the SECOND segment as the visibility class, so
  // that key resolved to the segment "signatures" under a tenant called
  // "public", failed `isPublicStorageKey`, and produced a URL the mount refuses.
  // Every card rendered under it was a 403 in the recipient's mail client.
  const slug = await tenantNamespace(client, tenantSlug);
  const key = `tenant_${slug}/signatures/${who}-${language}-${hash.slice(0, 12)}.png`;

  try {
    const png = await pngMod.render(model, 2);
    const stored = await storage.put(png.buffer, { key, contentType: "image/png" });
    const url = mediaUrl(stored.key || key);
    logger.debug({ user_id: userId, key: stored.key || key, bytes: png.buffer.length }, "signature card rendered");
    return url;
  } catch (err) {
    // NOT a silent catch. The first version swallowed this entirely, and the
    // failure mode it hid is the whole feature quietly not working: the send
    // still succeeds, the text fallback still renders, and the recipient gets a
    // plain block where the card should be — with nothing anywhere saying why.
    // That is exactly the class doc/ERROR_HANDLING.md exists to stop being
    // invisible. Degrading is still right; degrading in silence was not.
    logger.error(
      { err: err.message, user_id: userId, identity_key: identityKey, key },
      "signature card render failed — the email will carry the text fallback only",
    );
    metrics.inc(
      "praxis_signature_card_render_failures_total", {}, 1,
      "Signature card PNG renders that failed and fell back to text-only.",
    );
    return null;
  }
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

/**
 * Render one PNG per selected member of staff and return them as one ZIP.
 *
 * WHY SEQUENTIALLY. `signature.png.js` keeps ONE Chromium and opens a page per
 * shot. Rendering a 40-person team in parallel would open 40 pages against that
 * single browser and spike memory on a box that is also serving requests; the
 * screenshots are ~200 ms each, so a team completes in seconds either way. This
 * is a manager clicking a button, not a hot path.
 *
 * WHY A PARTIAL RESULT IS RETURNED RATHER THAN AN ERROR. One person with no
 * employee row, or a logo the storage backend cannot hand back, must not cost
 * the other thirty-nine their signatures. Failures come back in `skipped` so the
 * caller can say which, rather than being swallowed.
 */
async function renderBatch(client, { userIds = [], language = "en", scale = 2, shot = undefined } = {}) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) throw new AppError("VALIDATION_ERROR", "Select at least one member of staff", 422);
  if (ids.length > 200) throw new AppError("VALIDATION_ERROR", "Batch is limited to 200 people at a time", 422);

  const files = [];
  const skipped = [];

  for (const userId of ids) {
    try {
      const r = await resolveFor(client, { userId, language, format: "PNG", scale });
      if (!r.model) { skipped.push({ user_id: userId, reason: "no_signature" }); continue; }
      const png = await pngMod.render(r.model, scale, shot);
      const who = (r.model.person && r.model.person.full_name) || userId;
      files.push({ name: `Signature_${String(who).trim().replace(/\s+/g, "_")}.png`, data: png.buffer });
    } catch (err) {
      skipped.push({ user_id: userId, reason: err && err.code ? err.code : "render_failed" });
    }
  }

  if (!files.length) throw new AppError("NOT_FOUND", "No signature could be rendered for the selected staff", 404);
  return { buffer: zipMod.build(files), count: files.length, skipped };
}

/**
 * The card document, for the on-screen preview.
 *
 * Returns the SAME document `signature.png.js` screenshots, fonts and all, so
 * the preview is not a reimplementation of the card in React that can drift
 * from it — it is the card. The client renders it in a sandboxed iframe, which
 * is also what keeps the card's own CSS (bare `.card`, `.person-name`) from
 * leaking into the app's stylesheet.
 *
 * The embedded fonts make this ~270 kB. That is a real cost, paid on a preview
 * the user explicitly opened, and it buys the one guarantee the screen exists
 * to give: what you approve is what is sent.
 */
async function cardPreview(client, { userId, language = "en", can = {} } = {}) {
  const r = await resolveFor(client, { userId, language, format: "PREVIEW" });
  if (!r.model) throw new AppError("NOT_FOUND", "No signature to preview", 404);
  if (r.model.kind !== "card") {
    return {
      kind: r.model.kind, document: null, html: r.html,
      width: r.model.width_px, height: r.model.height_px,
      gaps: gapsMod.gaps(r.model, can),
    };
  }
  const fontsCss = require("./signature.fonts").fontFaceCss();
  const cardMod = require("./signature.card");
  return {
    kind: "card",
    document: cardMod.document(r.model, r.model.palette, r.model.fonts, fontsCss),
    width: cardMod.CARD_W,
    height: cardMod.CARD_H,
    palette: r.model.palette,
    fonts: r.model.fonts,
    language: r.language,
    gaps: gapsMod.gaps(r.model, can),
  };
}

/**
 * THE MOTTO / SLOGAN — the line in the script face across the bottom of the card.
 *
 * WHY IT HAS ITS OWN PAIR OF ENDPOINTS rather than riding on the template PATCH
 * that already accepts `copy_en` / `copy_fr`. Those two columns are opaque JSON
 * blobs holding every piece of authored copy a template carries. Writing the
 * motto through them means the caller must read the blob, merge one key and
 * write the whole thing back — and a client that gets that read-modify-write
 * wrong silently erases the confidentiality notice sitting in the same object.
 * That is not a hypothetical: it is the ordinary outcome of a PATCH that sends
 * `{copy_en: {motto: "..."}}`, which is exactly what the obvious client code
 * does.
 *
 * So the merge lives here, once, on the server, and the wire format is a
 * string per language.
 *
 * PER LANGUAGE, because the card is bilingual and a French motto is not a
 * translation the product can invent.
 */
async function getMotto(client, templateId) {
  const t = await repo.getTemplate(client, templateId);
  if (!t) throw new AppError("NOT_FOUND", "template not found", 404);
  return {
    signature_template_id: t.signature_template_id,
    name: t.name,
    en: (t.copy_en && t.copy_en.motto) || "",
    fr: (t.copy_fr && t.copy_fr.motto) || "",
  };
}

/**
 * Set the motto for one or both languages. Omitting a language leaves it alone;
 * sending an empty string clears it, which is how a motto is removed — there is
 * no separate delete, because "no motto" is a value, not a missing record.
 */
async function saveMotto(client, templateId, { en, fr } = {}, actor = {}) {
  const t = await repo.getTemplate(client, templateId);
  if (!t) throw new AppError("NOT_FOUND", "template not found", 404);

  const fields = {};
  // Spread the EXISTING blob first — the whole point of this endpoint.
  if (en !== undefined) fields.copy_en = { ...(t.copy_en || {}), motto: String(en).trim() };
  if (fr !== undefined) fields.copy_fr = { ...(t.copy_fr || {}), motto: String(fr).trim() };
  if (!Object.keys(fields).length) return getMotto(client, templateId);

  await updateTemplate(client, templateId, fields, actor);
  return getMotto(client, templateId);
}

async function listStaff(client, query) {
  return repo.listSignatureStaff(client, query || {});
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
  RENDERER_VERSION,
  tenantNamespace,
  resolveFor, renderPng, renderBatch, listStaff, cardPreview, getOwnProfile, saveOwnProfile,
  listTemplates, updateTemplate, getMotto, saveMotto,
  invalidateForUser, invalidateForEntity, bake,
};
