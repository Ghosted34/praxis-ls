/**
 * Q tickets (MOD-31) — a client's query against a milestone, kept in the system.
 *
 * THE FLOW the kickoff asked for: a client watching their chain on the portal
 * sees something wrong, raises a query against that stage, ops answers in the
 * same thread, and it resolves. The alternative — an email — lives in one
 * person's inbox, is invisible to everyone else on the file, and disappears when
 * they are on leave.
 *
 * RAISING IS SCOPED BY THE SESSION, not by what the caller sends. The portal
 * passes its own `clientId` from the authenticated session and the dossier is
 * checked to belong to it, so no client can attach a ticket to another's file.
 */
"use strict";
const repo = require("./q_ticket.repo");
const events = require("./q_ticket.events");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

/** Raise a ticket. `clientId` is present when it comes from the portal. */
async function raise(client, { dossierId, milestoneInstanceId = null, subject, body = null, raisedBy = null, raisedByEmail = null, clientId = null, actor = {} }) {
  if (clientId && !(await repo.dossierBelongsTo(client, { dossierId, clientId }))) {
    // Deliberately the same error a missing file gives: confirming that a
    // dossier exists but belongs to someone else is itself a disclosure.
    throw new AppError("NOT_FOUND", "No such file for this client", 404);
  }

  let milestoneCode = null;
  if (milestoneInstanceId) {
    const { rows } = await client.query(
      "SELECT code, dossier_id FROM milestone_instance WHERE milestone_instance_id = $1",
      [milestoneInstanceId],
    );
    const ms = rows[0];
    if (!ms || ms.dossier_id !== dossierId) {
      throw new AppError("MILESTONE_MISMATCH", "That milestone is not on this file", 422);
    }
    milestoneCode = ms.code;
  }

  const row = await repo.insert(client, {
    dossier_id: dossierId,
    milestone_instance_id: milestoneInstanceId,
    milestone_code: milestoneCode,
    raised_by: raisedBy,
    raised_by_email: raisedByEmail,
    subject,
    body,
    status: "OPEN",
  });

  await emitEvent(client, {
    eventTypeKey: events.RAISED,
    moduleKey: events.MODULE,
    entityRef: "dossier:" + dossierId,
    actorUserId: actor.user_id || null,
    payload: { q_ticket_id: row.q_ticket_id, milestone_code: milestoneCode, subject },
  });
  await audit(client, {
    actorUserId: await resolveActorId(client, actor.user_id),
    action: events.RAISED,
    moduleKey: events.MODULE,
    entityRef: "q_ticket:" + row.q_ticket_id,
    after: row,
  });
  return row;
}

/** Add to the thread. A client reply reopens a ticket somebody closed too early. */
async function reply(client, { ticketId, body, fromClient = false, internal = false, authorLabel = null, evidenceVaultId = null, clientId = null, actor = {} }) {
  const ticket = await repo.get(client, ticketId);
  if (!ticket) throw new AppError("NOT_FOUND", "Ticket not found", 404);
  if (clientId && !(await repo.dossierBelongsTo(client, { dossierId: ticket.dossier_id, clientId }))) {
    throw new AppError("NOT_FOUND", "Ticket not found", 404);
  }
  // A client cannot post an internal note, whatever the payload says.
  const isInternal = fromClient ? false : !!internal;

  const row = await repo.insertReply(client, {
    q_ticket_id: ticketId,
    body,
    is_from_client: !!fromClient,
    is_internal: isInternal,
    author_user_id: fromClient ? null : await resolveActorId(client, actor.user_id),
    author_label: authorLabel,
    evidence_vault_id: evidenceVaultId,
  });

  // A resolved ticket that the client replies to is not resolved.
  const next = fromClient && ticket.status === "RESOLVED" ? "OPEN" : ticket.status === "OPEN" && !fromClient ? "IN_PROGRESS" : ticket.status;
  if (next !== ticket.status) await repo.setStatus(client, ticketId, next);

  await emitEvent(client, {
    eventTypeKey: events.REPLIED,
    moduleKey: events.MODULE,
    entityRef: "dossier:" + ticket.dossier_id,
    actorUserId: actor.user_id || null,
    payload: { q_ticket_id: ticketId, from_client: !!fromClient, internal: isInternal },
  });
  return row;
}

async function resolve(client, { ticketId, actor = {} }) {
  const ticket = await repo.get(client, ticketId);
  if (!ticket) throw new AppError("NOT_FOUND", "Ticket not found", 404);
  const { rows } = await client.query(
    "UPDATE q_ticket SET status = 'RESOLVED', resolved_at = now(), resolved_by = $2, updated_at = now() " +
      " WHERE q_ticket_id = $1 RETURNING *",
    [ticketId, await resolveActorId(client, actor.user_id)],
  );
  const row = rows[0];
  await emitEvent(client, {
    eventTypeKey: events.RESOLVED,
    moduleKey: events.MODULE,
    entityRef: "dossier:" + ticket.dossier_id,
    actorUserId: actor.user_id || null,
    payload: { q_ticket_id: ticketId },
  });
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: events.RESOLVED,
    moduleKey: events.MODULE,
    entityRef: "q_ticket:" + ticketId,
    before: ticket,
    after: row,
  });
  return row;
}

/** One ticket with its thread. `forClient` strips internal notes. */
async function detail(client, { ticketId, clientId = null, forClient = false }) {
  const ticket = await repo.get(client, ticketId);
  if (!ticket) throw new AppError("NOT_FOUND", "Ticket not found", 404);
  if (clientId && !(await repo.dossierBelongsTo(client, { dossierId: ticket.dossier_id, clientId }))) {
    throw new AppError("NOT_FOUND", "Ticket not found", 404);
  }
  const thread = await repo.replies(client, ticketId);
  return { ticket, replies: forClient ? thread.filter((r) => !r.is_internal) : thread };
}

const list = (client, q) => repo.list(client, q);
const listForClient = (client, clientId) => repo.listForClient(client, clientId);

module.exports = { raise, reply, resolve, detail, list, listForClient };
