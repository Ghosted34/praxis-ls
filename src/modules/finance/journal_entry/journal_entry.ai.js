/**
 * AI action manifest (the "seventh file", per doc/AI_ARCHITECTURE.md §2 and
 * doc/AI_READINESS.md). Declares this module's AI surface; the action registrar
 * (src/services/ai/action-registry.js) upserts it into ai_action_catalogue and
 * builds the executor map, so AI capability == app capability with zero drift.
 *
 * Permissions use the real RBAC shape { module, action } that middleware/rbac.js
 * enforces — the AI never exceeds the calling user (checked on the caller's
 * tenant connection). Writes are confirmation-gated (reads/writes = free/confirm).
 */
"use strict";

const service = require("./journal_entry.service");
const validator = require("./journal_entry.validator");

module.exports = {
  entity: "journal_entry",
  module_key: "MOD-55",
  // Screens where this module's AI can act (mirrors client screen-registry ids).
  screens: ["dashboard"],

  reads: [
    { key: "list_journal_entries", service: service.list, describe: "List recent journal entries (filter by journal_id/period_id/status)." },
    { key: "get_journal_entry", service: service.get, describe: "Get one journal entry by id, with its lines." },
  ],

  writes: [
    {
      key: "post_journal_entry",
      service: service.post,
      schema: validator.schemas.post, // -> payload_schema (JSON Schema at registration)
      permission: { module: "MOD-55", action: "create" },
      confirm: true,
      describe: "Post a balanced journal entry (draft->validated) per KB §23 invariants.",
    },
    {
      key: "reverse_journal_entry",
      service: service.reverse,
      schema: validator.schemas.reverse,
      permission: { module: "MOD-55", action: "approve" },
      confirm: true,
      describe: "Reverse a validated entry with a linked contra entry (never edit in place, KB §23.16).",
    },
  ],
};
