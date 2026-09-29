/**
 * A client's portal, managed from the client's own record (Client 360 → Portal)
 * rather than from Settings — who at the client can sign in, what each of them
 * sees, their onboarding checklist — plus the portal settings that apply to
 * every client (the Clients screen's ⚙ Settings).
 *
 * Gated on MOD-29 (the client portal) in the routes, not MOD-67: the account
 * team that runs a client's portal is the team that decides who at that client
 * gets in. Investor and auditor grants stay on MOD-67 in portal.service — they
 * expose the tenant's own books, not one client's shipments.
 *
 * Only the TENANT half lives here. A person's login and their set-password
 * email are identity data (portal_user), which the controller handles next
 * through the same `inviteUser` every other portal invite uses.
 */
"use strict";

const repo = require("./portal.repo");
const events = require("./portal.events");
const { SCOPES, INVITE_DEFAULTS_KEY, normalizeInviteDefaults, resolveClientAdmin } = require("./portal.rules");
const { emitEvent, audit, resolveActorId } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");

const normEmail = (e) => String(e || "").trim().toLowerCase();

/* ── the tenant's defaults for a new invite ─────────────────────────────── */

async function inviteDefaults(client) {
  return normalizeInviteDefaults(await repo.portalSetting(client, INVITE_DEFAULTS_KEY));
}

async function saveInviteDefaults(client, { accessScope, firstIsAdmin, actor = {} }) {
  const next = normalizeInviteDefaults({ access_scope: accessScope, first_is_admin: firstIsAdmin });
  const before = await inviteDefaults(client);
  const actorId = await resolveActorId(client, actor.user_id);
  await repo.savePortalSetting(client, INVITE_DEFAULTS_KEY, next, actorId);
  await audit(client, {
    actorUserId: actorId, action: "portal.invite_defaults_changed", moduleKey: events.MODULE,
    entityRef: "setting:portal." + INVITE_DEFAULTS_KEY, before, after: next,
  });
  return next;
}

/* ── the onboarding checklist every client starts from (14240) ──────────── */

const onboardingTemplate = (client) => repo.onboardingTemplate(client);

/** "Documents received" → DOCUMENTS_RECEIVED, the key a client's steps carry. */
function keyFrom(label) {
  const k = String(label || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .replace(/^[^A-Z]+/, "");
  return k.slice(0, 60);
}

async function createOnboardingStep(client, { labelEn, labelFr, actor = {} }) {
  const en = String(labelEn || "").trim();
  const fr = String(labelFr || "").trim() || en;
  const base = keyFrom(en);
  if (base.length < 2) throw new AppError("BAD_STEP", "Name the step in a few words", 422);
  const actorId = await resolveActorId(client, actor.user_id);
  const sortOrder = await repo.nextTemplateSort(client);
  // A second "Insurance" becomes INSURANCE_2 rather than a refusal: the key is
  // internal, and the person adding the step never sees it.
  for (let n = 1; n <= 20; n++) {
    const stepKey = n === 1 ? base : `${base.slice(0, 57)}_${n}`;
    const row = await repo.insertTemplateStep(client, { stepKey, labelEn: en, labelFr: fr, sortOrder, actorId });
    if (row) {
      await audit(client, { actorUserId: actorId, action: "portal.onboarding_template_step_added", moduleKey: events.MODULE, entityRef: "client_onboarding_template:" + stepKey, after: row });
      return row;
    }
  }
  throw new AppError("STEP_EXISTS", "A step with this name already exists", 409);
}

async function updateOnboardingStep(client, { stepKey, labelEn, labelFr, sortOrder, isActive, actor = {} }) {
  const actorId = await resolveActorId(client, actor.user_id);
  const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const row = await repo.updateTemplateStep(client, stepKey, {
    labelEn: clean(labelEn), labelFr: clean(labelFr),
    sortOrder: Number.isInteger(sortOrder) ? sortOrder : null,
    isActive, actorId,
  });
  if (!row) throw new AppError("NOT_FOUND", "No such onboarding step", 404);
  await audit(client, { actorUserId: actorId, action: "portal.onboarding_template_step_changed", moduleKey: events.MODULE, entityRef: "client_onboarding_template:" + stepKey, after: row });
  return row;
}

/**
 * Move a step one place up or down. The template's order is what every
 * client's checklist follows, so the two neighbours swap positions rather
 * than taking a number from the person reordering.
 */
async function moveOnboardingStep(client, { stepKey, direction, actor = {} }) {
  const all = (await repo.onboardingTemplate(client)).filter((s) => s.is_active);
  const i = all.findIndex((s) => s.step_key === stepKey);
  if (i < 0) throw new AppError("NOT_FOUND", "No such onboarding step", 404);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return all;
  const actorId = await resolveActorId(client, actor.user_id);
  // Positions are rewritten 10, 20, 30… so two steps that share a number (a
  // tenant's own seed, say) still end up in a definite order.
  const order = all.map((s) => s.step_key);
  [order[i], order[j]] = [order[j], order[i]];
  for (let k = 0; k < order.length; k++) {
    await repo.updateTemplateStep(client, order[k], { sortOrder: (k + 1) * 10, actorId });
  }
  return repo.onboardingTemplate(client);
}

/* ── the people at one client who can sign in ───────────────────────────── */

const people = (client, { clientId }) => repo.clientGrants(client, clientId);

async function mustOwn(client, clientId, grantId) {
  const grant = await repo.clientGrant(client, clientId, grantId);
  if (!grant) throw new AppError("NOT_FOUND", "This person does not have access to this client's portal", 404);
  return grant;
}

/**
 * Staff give someone at a client access to that client's portal. The scope and
 * the admin flag fall back to the tenant's invite defaults.
 *
 * A person already holding CLIENT access for ANOTHER client is refused, and
 * the refusal names that client: the portal resolves one company per login
 * (the newest grant wins), so a second grant would silently move their whole
 * portal to this company.
 */
async function addPerson(client, { clientId, email, accessScope, isClientAdmin, expiresAt = null, actor = {} }) {
  const normalized = normEmail(email);
  if (!normalized) throw new AppError("EMAIL_REQUIRED", "Enter their email address", 422);
  if (accessScope && !SCOPES.includes(accessScope)) throw new AppError("BAD_SCOPE", "Choose what they can see", 422);
  const existing = await repo.liveClientGrantFor(client, normalized);
  if (existing && existing.client_id === clientId) {
    throw new AppError("ALREADY_HAS_ACCESS", "This person already has access to this client's portal", 409);
  }
  if (existing) {
    throw new AppError(
      "OTHER_COMPANY",
      `This person already has portal access for ${existing.client_name || "another client"}. Remove it there first.`,
      409,
    );
  }
  const defaults = await inviteDefaults(client);
  const admin = resolveClientAdmin({
    explicit: typeof isClientAdmin === "boolean" ? isClientAdmin : null,
    existingGrants: (await repo.clientGrants(client, clientId)).length,
    defaults,
  });
  const inserted = await repo.insertAccess(client, {
    portal: "CLIENT", subject_email: normalized, client_id: clientId, expires_at: expiresAt || null,
    access_scope: accessScope || defaults.access_scope, is_client_admin: admin,
  });
  const actorId = await resolveActorId(client, actor.user_id);
  const entityRef = "portal_access:" + inserted.portal_access_id;
  await emitEvent(client, { eventTypeKey: events.ACCESS_GRANTED, moduleKey: events.MODULE, entityRef, actorUserId: actorId, priority: "HIGH" });
  await audit(client, { actorUserId: actorId, action: events.ACCESS_GRANTED, moduleKey: events.MODULE, entityRef, after: inserted });
  return repo.clientGrant(client, clientId, inserted.portal_access_id);
}

async function updatePerson(client, { clientId, grantId, accessScope, isClientAdmin, expiresAt, actor = {} }) {
  if (accessScope && !SCOPES.includes(accessScope)) throw new AppError("BAD_SCOPE", "Choose what they can see", 422);
  const before = await mustOwn(client, clientId, grantId);
  const row = await repo.updateClientGrant(client, {
    clientId, grantId, scope: accessScope, isAdmin: isClientAdmin,
    setExpiry: expiresAt !== undefined, expiresAt,
  });
  if (!row) throw new AppError("NOT_FOUND", "This person does not have access to this client's portal", 404);
  const actorId = await resolveActorId(client, actor.user_id);
  await audit(client, { actorUserId: actorId, action: "portal.team_role_changed", moduleKey: events.MODULE, entityRef: "portal_access:" + grantId, before, after: row });
  return row;
}

async function revokePerson(client, { clientId, grantId, actor = {} }) {
  const row = await repo.revokeClientGrant(client, { clientId, grantId });
  if (!row) throw new AppError("NOT_FOUND", "This person does not have access to this client's portal", 404);
  const actorId = await resolveActorId(client, actor.user_id);
  const entityRef = "portal_access:" + grantId;
  await emitEvent(client, { eventTypeKey: events.ACCESS_REVOKED, moduleKey: events.MODULE, entityRef, actorUserId: actorId });
  await audit(client, { actorUserId: actorId, action: events.ACCESS_REVOKED, moduleKey: events.MODULE, entityRef, after: row });
  return { revoked: true, email: row.email };
}

/** The grant a resend is for — checked against the client before any email goes. */
const personFor = (client, { clientId, grantId }) => mustOwn(client, clientId, grantId);

module.exports = {
  inviteDefaults, saveInviteDefaults,
  onboardingTemplate, createOnboardingStep, updateOnboardingStep, moveOnboardingStep,
  people, addPerson, updatePerson, revokePerson, personFor,
  keyFrom,
};
