/**
 * Lead (MOD-20) — top of the sales funnel. Lifecycle NEW→CONTACTED→QUALIFIED→
 * CONVERTED/LOST. `convert` promotes a qualified lead into a real client
 * (client_master) and links it back. All SQL is in the repo.
 */
"use strict";
const repo = require("./lead.repo");
const events = require("./lead.events");
const { assertTransition } = require("./lead.rules");
const clientMaster = require("../../master/client_master/client_master.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const ref = (id) => "lead:" + id;

async function create(client, { data, actor = {} }) {
  await client.query("BEGIN");
  try {
    const row = await repo.insert(client, {
      company_name: data.company_name, contact_name: data.contact_name || null, email: data.email || null, phone: data.phone || null,
      source: data.source || "MANUAL", service_interest: data.service_interest || null, status: "NEW",
      owner_user_id: data.owner_user_id || actor.user_id || null, details_json: JSON.stringify(data.details || {}),
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.lead_id), after: row });
    await client.query("COMMIT");
    return row;
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Lead not found", 404);
  if (["CONVERTED", "LOST"].includes(before.status)) throw new AppError("LOCKED", "A " + before.status + " lead cannot be edited", 422);
  const fields = {};
  for (const k of ["company_name", "contact_name", "email", "phone", "source", "service_interest", "owner_user_id"]) if (patch[k] !== undefined) fields[k] = patch[k];
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

/** Convert a QUALIFIED lead → client_master, link + mark CONVERTED. */
async function convert(client, { id, clientData = {}, actor = {} }) {
  const lead = await repo.get(client, id);
  if (!lead) throw new AppError("NOT_FOUND", "Lead not found", 404);
  if (lead.status !== "QUALIFIED") throw new AppError("NOT_QUALIFIED", "Only a QUALIFIED lead can be converted", 422);
  await client.query("BEGIN");
  try {
    const created = await clientMaster.create(client, {
      data: { legal_name: clientData.legal_name || lead.company_name, email: clientData.email || lead.email, phone: clientData.phone || lead.phone, ...clientData },
      actor,
    });
    const clientId = created.client_id || created.id;
    const row = await repo.update(client, id, { status: "CONVERTED", client_id: clientId });
    await emitEvent(client, { eventTypeKey: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CONVERTED, moduleKey: events.MODULE, entityRef: ref(id), after: { client_id: clientId } });
    await client.query("COMMIT");
    return { lead: row, client_id: clientId };
  } catch (err) { await client.query("ROLLBACK"); throw err; }
}

const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
module.exports = { create, update, transition, convert, get, list };
