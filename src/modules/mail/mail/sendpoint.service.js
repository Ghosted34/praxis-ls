/**
 * The send-point registry: which address each part of the product mails from,
 * and — just as importantly — WHY.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 *
 * "Why did that go out from the wrong address?" is the most common question
 * anyone asks about email configuration, and until now it could only be answered
 * by reading `email.service.resolveMail` and three tables. So `resolve()` returns
 * not just the sender but the tier it came from and a sentence saying so, and the
 * admin screen renders that sentence next to every row.
 *
 * ── THE RESOLUTION ORDER ────────────────────────────────────────────────────
 *
 *   1. a binding for this send point AND this corporate entity
 *   2. a binding for this send point, tenant-wide
 *   3. the legacy section binding for the send point's purpose  (email_section_binding)
 *   4. the identity whose own `purpose` equals that purpose      (email_identity)
 *   5. nothing here — email.service falls back to the tenant's shared SMTP,
 *      then the Praxis platform sender, then env
 *
 * Tiers 3 and 4 are exactly what `email.service` already did, unchanged. This
 * adds two MORE SPECIFIC tiers above them and removes nothing, which is why
 * turning it on cannot re-route a tenant's existing mail.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 *
 * It does not touch transport selection. `email.service` has a deliberate rule
 * that when a tenant has no SMTP host of its own, the SENDER falls back along
 * with the transport — because a tenant-domain From sent through the Praxis
 * relay fails SPF and bounces. That rule is about deliverability, not routing,
 * and this layer must not be allowed to defeat it: a send-point binding chooses
 * WHICH of the tenant's own senders is used, never that one is used when the
 * tenant has none.
 */
"use strict";

const repo = require("./sendpoint.repo");
const { AppError } = require("../../../utils/errors");
const { audit, emitEvent, resolveActorId } = require("../../../shared/events/emit");

const MODULE = "MOD-72";

/** The tiers, as machine values plus the sentence the UI shows. */
const SOURCE = {
  ENTITY_BINDING: "ENTITY_BINDING",
  TENANT_BINDING: "TENANT_BINDING",
  LEGACY_SECTION: "LEGACY_SECTION",
  LEGACY_PURPOSE: "LEGACY_PURPOSE",
  FALLBACK: "FALLBACK",
};

function explain(source, detail = {}) {
  switch (source) {
    case SOURCE.ENTITY_BINDING:
      return `Bound to ${detail.address} for ${detail.entity_name || "this company"}.`;
    case SOURCE.TENANT_BINDING:
      return `Bound to ${detail.address}.`;
    case SOURCE.LEGACY_SECTION:
      return `Not bound directly — using the "${detail.purpose}" section sender, ${detail.address}.`;
    case SOURCE.LEGACY_PURPOSE:
      return `Not bound directly — using the sender whose purpose is "${detail.purpose}", ${detail.address}.`;
    default:
      return "No sender configured — this falls back to the tenant's shared SMTP, then to the Praxis system sender.";
  }
}

/**
 * Resolve one send point to a sender.
 *
 * Returns `{ identity, connection, source, why }`. `identity` is an
 * `email_identity` row shaped exactly as `email.service.resolveMail` expects, so
 * that function can use it without translating anything. Both may be null, which
 * means "fall through" and is a legitimate answer, not an error.
 */
async function resolve(client, { sendPointKey, entityId = null } = {}) {
  const sp = await repo.getSendPoint(client, sendPointKey);
  if (!sp) {
    // An unknown key is a caller bug, but it must not stop mail going out — the
    // fallback chain below still produces a working sender.
    return { send_point: null, identity: null, connection: null, source: SOURCE.FALLBACK, why: explain(SOURCE.FALLBACK) };
  }

  const binding = await repo.bindingFor(client, sendPointKey, entityId);
  if (binding) {
    const isEntity = Boolean(binding.entity_id);
    const source = isEntity ? SOURCE.ENTITY_BINDING : SOURCE.TENANT_BINDING;
    const address = binding.from_address || binding.connection_address;
    const identity = binding.email_identity_id
      ? {
          email_identity_id: binding.email_identity_id,
          from_address: binding.from_address, from_name: binding.from_name,
          reply_to: binding.reply_to, smtp_host: binding.smtp_host, smtp_port: binding.smtp_port,
        }
      : null;
    return {
      send_point: sp, identity,
      connection: binding.email_connection_id
        ? { email_connection_id: binding.email_connection_id, email_address: binding.connection_address, status: binding.connection_status }
        : null,
      source, why: explain(source, { address, entity_name: binding.entity_name }),
    };
  }

  if (sp.legacy_purpose) {
    const legacy = await repo.legacyIdentityFor(client, sp.legacy_purpose);
    if (legacy) {
      return {
        send_point: sp, identity: legacy, connection: null,
        source: SOURCE.LEGACY_SECTION,
        why: explain(SOURCE.LEGACY_SECTION, { purpose: sp.legacy_purpose, address: legacy.from_address }),
      };
    }
  }

  return { send_point: sp, identity: null, connection: null, source: SOURCE.FALLBACK, why: explain(SOURCE.FALLBACK) };
}

/**
 * The whole registry with each row's current resolution, for the admin screen.
 *
 * `is_wired` is carried through untouched: a send point nothing calls yet must be
 * labelled as such, or the screen promises a route that never fires and the
 * administrator finds out when a test message does not arrive.
 */
async function listResolved(client, { entityId = null } = {}) {
  const rows = await repo.listWithBindings(client);
  const out = [];
  for (const sp of rows) {
    const r = await resolve(client, { sendPointKey: sp.send_point_key, entityId });
    out.push({
      send_point_key: sp.send_point_key,
      module_key: sp.module_key, group_key: sp.group_key,
      label_en: sp.label_en, label_fr: sp.label_fr,
      description_en: sp.description_en, description_fr: sp.description_fr,
      legacy_purpose: sp.legacy_purpose,
      default_catalogue_key: sp.default_catalogue_key,
      is_wired: sp.is_wired, sort_order: sp.sort_order,
      bindings: sp.bindings || [],
      resolved: {
        source: r.source, why: r.why,
        from_address: (r.identity && r.identity.from_address) || (r.connection && r.connection.email_address) || null,
        from_name: (r.identity && r.identity.from_name) || null,
      },
    });
  }
  return out;
}

/** Point a send point at a sender. One of identity / connection, never neither. */
async function bind(client, { sendPointKey, entityId = null, identityId = null, connectionId = null, actor = {} }) {
  const sp = await repo.getSendPoint(client, sendPointKey);
  if (!sp) throw new AppError("NOT_FOUND", "send point not found", 404);
  if (!identityId && !connectionId) {
    throw new AppError("VALIDATION_ERROR", "Choose a sender identity or a connected mailbox to send from.", 422);
  }
  if (identityId && connectionId) {
    throw new AppError("VALIDATION_ERROR", "A send point sends from one place — choose either a sender identity or a mailbox, not both.", 422);
  }
  const before = await repo.bindingFor(client, sendPointKey, entityId);
  const row = await repo.upsertBinding(client, {
    send_point_key: sendPointKey, entity_id: entityId,
    email_identity_id: identityId, email_connection_id: connectionId,
    // resolveActorId (DATA 2.4): an unresolved live user id written beside
    // sandbox data raises 23503 and loses the binding.
    created_by: await resolveActorId(client, actor.user_id),
  });
  await emitEvent(client, {
    eventTypeKey: "mail.send_point.bound", moduleKey: MODULE,
    entityRef: `mail_send_point:${sendPointKey}`, actorUserId: actor.user_id || null,
    payload: { send_point: sendPointKey, entity_id: entityId, identity_id: identityId, connection_id: connectionId },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.send_point.bound",
    moduleKey: MODULE, entityRef: `mail_send_point:${sendPointKey}`,
    before: before ? { email_identity_id: before.email_identity_id, email_connection_id: before.email_connection_id } : null,
    after: { email_identity_id: identityId, email_connection_id: connectionId, entity_id: entityId },
    isSensitive: true,
  });
  return row;
}

async function unbind(client, { sendPointKey, entityId = null, actor = {} }) {
  const row = await repo.deleteBinding(client, sendPointKey, entityId);
  if (!row) return { removed: false };
  await audit(client, {
    actorUserId: actor.user_id || null, action: "mail.send_point.unbound",
    moduleKey: MODULE, entityRef: `mail_send_point:${sendPointKey}`,
    before: { email_identity_id: row.email_identity_id, email_connection_id: row.email_connection_id, entity_id: row.entity_id },
    isSensitive: true,
  });
  return { removed: true };
}

module.exports = { MODULE, SOURCE, resolve, listResolved, bind, unbind, explain };
