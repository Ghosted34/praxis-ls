/**
 * Lead (MOD-20) — top of the sales funnel. Lifecycle NEW→CONTACTED→QUALIFIED→
 * CONVERTED/LOST. `convert` promotes a qualified lead into a real client
 * (client_master) and links it back. All SQL is in the repo.
 *
 * F6 changes (doc/SALES_CRM_FEATURES.md#F6):
 *   - new fields on `lead`: country, address, niu, rccm, intake_channel,
 *     client_type_hint, payment_terms_days. These are what makes a converted
 *     lead yield a client Finance does not have to complete by hand.
 *   - convert payload is now a structured `client` block; the service reads
 *     `client.client_type` and `client.payment_terms_days` from the request
 *     (with the lead's hint as a fallback). The legacy hard-coded
 *     `client_type='BOTH'` and `payment_terms_days=30` regardless of input;
 *     we no longer do that. If neither is provided, we 422.
 */
"use strict";
const repo = require("./lead.repo");
const events = require("./lead.events");
const { assertTransition } = require("./lead.rules");
const clientMaster = require("../../master/client_master/client_master.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const { atomically } = require("../../../shared/db/tx");
const ref = (id) => "lead:" + id;

const LEAD_FIELDS = [
  "entity_id", "company_name", "contact_name", "email", "phone", "country", "address",
  "niu", "rccm", "source", "intake_channel", "service_interest",
  "client_type_hint", "payment_terms_days", "owner_user_id",
];

async function create(client, { data, actor = {} }) {
  return atomically(client, async () => {
    const row = await repo.insert(client, {
      entity_id: data.entity_id || null,
      company_name: data.company_name,
      contact_name: data.contact_name || null,
      email: data.email || null,
      phone: data.phone || null,
      country: data.country || null,
      address: data.address || null,
      niu: data.niu || null,
      rccm: data.rccm || null,
      source: data.source || "MANUAL",
      intake_channel: data.intake_channel || data.source || "MANUAL",
      service_interest: data.service_interest || null,
      client_type_hint: data.client_type_hint || null,
      payment_terms_days: data.payment_terms_days ?? null,
      status: "NEW",
      owner_user_id: data.owner_user_id || actor.user_id || null,
      details_json: JSON.stringify(data.details || {}),
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), after: row });
    return row;
  });
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Lead not found", 404);
  if (["CONVERTED", "LOST"].includes(before.status)) throw new AppError("LOCKED", "A " + before.status + " lead cannot be edited", 422);
  const fields = {};
  for (const k of LEAD_FIELDS) if (patch[k] !== undefined) fields[k] = patch[k];
  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function transition(client, { id, to, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Lead not found", 404);
  assertTransition(before.status, to);
  const row = await repo.update(client, id, { status: to });
  await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Convert a QUALIFIED lead into client_master.
 *
 * The payload is the staff member's `client` block from the convert drawer.
 * Resolution order for client_type / payment_terms_days:
 *   1. request body (explicit choice in the UI)
 *   2. the lead's hint columns (set when the lead was captured)
 *   3. hard error — the legacy's silent fallback is exactly the bug F6 fixes.
 *
 * NIU and RCCM go into the new `registrations` array (the source of truth) and
 * are also mirrored onto the master row by `party_write` for invoice compatibility.
 */
async function convert(client, { id, clientData = {}, actor = {} }) {
  const lead = await repo.get(client, id);
  if (!lead) throw new AppError("NOT_FOUND", "Lead not found", 404);
  if (lead.status !== "QUALIFIED") throw new AppError("NOT_QUALIFIED", "Only a QUALIFIED lead can be converted", 422);

  const clientType = clientData.client_type || lead.client_type_hint;
  const paymentTerms = clientData.payment_terms_days ?? lead.payment_terms_days;
  if (!clientType) {
    throw new AppError(
      "VALIDATION_ERROR",
      "client_type is required on convert (or set client_type_hint on the lead)",
      422,
    );
  }
  if (paymentTerms === null || paymentTerms === undefined) {
    throw new AppError(
      "VALIDATION_ERROR",
      "payment_terms_days is required on convert (or set it on the lead)",
      422,
    );
  }

  // Build the registrations array for the OHADA country block. The lead's NIU/
  // RCCM (or the staff's override in the convert drawer) become a
  // `party_registration` row in the same transaction. `party_write` mirrors
  // the values back onto client_master.niu/rccm for invoice compatibility.
  const country = clientData.country_code || lead.country || "CM";
  const registrations = [];
  const niu = clientData.niu ?? lead.niu;
  const rccm = clientData.rccm ?? lead.rccm;
  if (niu) registrations.push({ country_code: country, kind: "NIU", number: niu });
  if (rccm) registrations.push({ country_code: country, kind: "RCCM", number: rccm });

  return atomically(client, async () => {
    // The code the drawer collects is not a column. `client_master` carries a
    // `client_type_id` FK and no `client_type`; `insertOne` is called with a
    // null allow-list, so an unknown key goes straight into the INSERT column
    // list and Postgres answers 42703. Resolve it, and refuse a code the tenant
    // has not configured rather than silently writing a client with no type —
    // an untyped client is one Finance has to complete, which is the exact
    // outcome this feature exists to prevent.
    const clientTypeId = await repo.clientTypeIdByCode(client, clientType);
    if (!clientTypeId) {
      throw new AppError(
        "UNKNOWN_CLIENT_TYPE",
        `client_type "${clientType}" is not configured for this tenant`,
        422,
        { client_type: ["not a configured client type"] },
      );
    }

    // Likewise `phone`: there is no phone column on client_master. The number
    // belongs on the party's primary contact, which party-write.writeChildren
    // creates in the same transaction — so it is kept rather than dropped, and
    // it lands where the 360 and the portal already look for it.
    const contactName = clientData.contact_name || lead.contact_name || null;
    const contactPhone = clientData.phone || lead.phone || null;
    const contactEmail = clientData.email || lead.email || null;
    const primary_contact = contactName
      ? { name: contactName, phone: contactPhone || undefined, email: contactEmail || undefined }
      : undefined;

    // The entity decides which counter allocates the client's `CL-` reference.
    // Without it client_master.create skips the allocation entirely and the
    // client arrives with a null ref.
    const entityId = clientData.entity_id || lead.entity_id || (await repo.defaultEntityId(client));
    if (!entityId) {
      throw new AppError(
        "ENTITY_REQUIRED",
        "This tenant has more than one corporate entity — say which one the client belongs to",
        422,
        { entity_id: ["required when the tenant has several corporate entities"] },
      );
    }

    const created = await clientMaster.create(client, {
      data: {
        entity_id: entityId,
        name: clientData.name || lead.company_name,
        legal_name: clientData.legal_name || lead.company_name,
        country_code: country,
        email: contactEmail || undefined,
        address: clientData.address || lead.address || undefined,
        client_type_id: clientTypeId,
        payment_terms_days: paymentTerms,
        registrations,
        primary_contact,
      },
      actor,
    });
    const clientId = created.client_id || created.id;
    const row = await repo.update(client, id, { status: "CONVERTED", client_id: clientId });
    await emitEvent(client, { eventTypeKey: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), after: { client_id: clientId, client_type: clientType, client_type_id: clientTypeId, payment_terms_days: paymentTerms } });
    return { lead: row, client_id: clientId, entity_id: entityId, client_type: clientType, client_type_id: clientTypeId, payment_terms_days: paymentTerms };
  });
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, transition, convert, get, list, LEAD_FIELDS };
