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
  entity: "email_inbound",
  module_key: "MOD-64",
  screens: [],
  reads: [
    { key: "list_mail_connections", service: service.listConnections, describe: "List connected mailboxes and their sync status." },
    { key: "list_mail_thread", service: service.listThread, describe: "List recent email (optionally filtered by connection_id) for reading or summarizing a thread." },
    { key: "client_mail_timeline", service: service.clientTimeline, describe: "All email to/from a client (client_id) — the CRM mail timeline." },
  ],
  writes: [
    {
      key: "send_mail", service: service.send, schema: validator.schemas.send,
      permission: { module: "MOD-64", action: "create" }, confirm: true,
      describe: "Send an email from a connected mailbox (connectionId, to, subject, html/text).",
    },
    {
      key: "reply_mail", service: service.reply, schema: validator.schemas.aiReply,
      permission: { module: "MOD-64", action: "create" }, confirm: true,
      describe: "Reply in-thread to a received message (connectionId, inboundId, html/text) — keeps provider threading.",
    },
  ],
};
