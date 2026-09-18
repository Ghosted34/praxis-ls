/**
 * AI action manifest (AI_ARCHITECTURE §2) for Q tickets (MOD-31).
 *
 * A Q ticket is a client query raised against an operations file, usually
 * against one milestone stage. "What is the client asking about on this file"
 * and "reply to that query" are the two things staff do with them all day, and
 * neither was reachable by the assistant.
 *
 * `reply` is a staff reply by construction: `fromClient` is set by the PORTAL
 * route, never from a body, and this manifest runs on a staff caller's
 * connection — so it is not passed here at all.
 */
"use strict";

const service = require("./q_ticket.service");
const validator = require("./q_ticket.validator");

const MOD = "MOD-31";

module.exports = {
  entity: "q_ticket",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_q_tickets", service: service.list, permission: { module: MOD, action: "view" }, describe: "List client query tickets (filter by dossier, milestone or status)." },
    { key: "get_q_ticket", service: (c, p) => service.detail(c, { ticketId: p.q_ticket_id || p.id || p }), permission: { module: MOD, action: "view" }, describe: "Get one query ticket by id, with its reply thread." },
  ],

  writes: [
    {
      key: "raise_q_ticket",
      service: (c, p, actor) => service.raise(c, { dossierId: p.dossier_id, milestoneInstanceId: p.milestone_instance_id, subject: p.subject, body: p.body, raisedBy: p.raised_by, actor }),
      schema: validator.schemas.raise,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Raise a query ticket on an operations file, optionally against one milestone stage.",
    },
    {
      key: "reply_q_ticket",
      service: (c, p, actor) => service.reply(c, { ticketId: p.q_ticket_id, body: p.body, internal: p.internal, evidenceVaultId: p.evidence_vault_id, actor }),
      schema: validator.schemas.aiReply,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Reply to a query ticket by id. `internal` keeps the note off the client's portal thread.",
    },
    {
      key: "resolve_q_ticket",
      service: (c, p, actor) => service.resolve(c, { ticketId: p.q_ticket_id, actor }),
      schema: validator.schemas.aiResolve,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Close a query ticket by id once it has been answered.",
    },
  ],
};
