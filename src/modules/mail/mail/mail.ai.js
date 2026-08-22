/**
 * Mail AI action catalogue (MOD-64). Declares which mail operations the copilot
 * may invoke; synced into ai_action_catalogue (scripts/ai/sync-actions.js) and
 * surfaced only when AI is enabled for the tenant (EMV gate). Drafting and
 * summarizing are the copilot composing over these reads/writes: it reads a
 * thread or client timeline, drafts, then calls reply_mail/send_mail (confirmed).
 */
"use strict";
const service = require("./mail.service");
const validator = require("./mail.validator");

module.exports = {
  entity: "email_message",
  module_key: "MOD-64",
  screens: [],
  reads: [
    { key: "list_mail_connections", service: service.listConnections, permission: { module: "MOD-72", action: "view" }, describe: "List connected mailboxes and their sync status." },
    { key: "list_mail_thread", service: service.listThread, permission: { module: "MOD-72", action: "view" }, describe: "List recent email (optionally filtered by connection_id) for reading or summarizing a thread." },
    { key: "client_mail_timeline", service: service.clientTimeline, permission: { module: "MOD-72", action: "view" }, describe: "All email to/from a client (client_id) — the CRM mail timeline." },
  ],
  writes: [
    {
      key: "send_mail", service: service.send, schema: validator.schemas.send,
      // H-4. This declared MOD-64 create while the HTTP send path requires
      // MOD-72 create, and the orchestrator enforces exactly what is declared —
      // so the two send paths checked DIFFERENT MODULES. A chat-permitted user
      // who was not a mail user could send mail through the copilot, and a mail
      // user without chat create could not. §3.4 is explicit: "Mail is MOD-72 …
      // They are separate rights and must stay separate." The reads below were
      // already MOD-72; only the writes had drifted.
      permission: { module: "MOD-72", action: "create" }, confirm: true,
      describe: "Send an email from a connected mailbox (connectionId, to, subject, html/text).",
    },
    {
      key: "reply_mail", service: service.reply, schema: validator.schemas.aiReply,
      permission: { module: "MOD-72", action: "create" }, confirm: true,
      describe: "Reply in-thread to a received message (connectionId, inboundId, html/text) — keeps provider threading.",
    },
  ],
};
