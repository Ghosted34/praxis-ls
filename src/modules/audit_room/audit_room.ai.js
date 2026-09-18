/**
 * AI action manifest (AI_ARCHITECTURE §2) for the auditor data room
 * (PRD §5.2), on the STAFF side (MOD-67).
 *
 * An audit is a queue of "send me X" with a deadline attached, and the thing
 * staff need to know is which requests are still unanswered. That is a question,
 * and it had no tool.
 *
 * The AUDITOR-facing half of this module (`listForAuditor`, `createRequest`,
 * `detailForAuditor`, `downloadDoc`) is deliberately absent: those run under
 * `portalAuth("AUDITOR")` on a portal grant, not on a staff caller's RBAC, so
 * they have no place in a catalogue whose whole premise is "never exceed the
 * calling user". Staff answer the requests; they do not raise them.
 */
"use strict";

const service = require("./audit_room.service");
const validator = require("./audit_room.validator");

const MOD = "MOD-67";

module.exports = {
  entity: "audit_room_request",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_audit_room_requests", service: (c) => service.listForStaff(c), permission: { module: MOD, action: "view" }, describe: "Every auditor data-room request and its state — what was asked for, and what is still unanswered." },
    { key: "get_audit_room_request", service: (c, p) => service.detailForStaff(c, { roomId: p.id || p }), permission: { module: MOD, action: "view" }, describe: "One data-room request by id, with the documents staff have attached to it." },
  ],

  writes: [
    {
      key: "attach_audit_room_document",
      service: (c, p, actor) => service.attach(c, { roomId: p.id, docId: p.doc_id, actor }),
      schema: validator.schemas.attach,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Attach a vaulted document to an auditor's data-room request, answering it.",
    },
    {
      key: "answer_audit_room_request",
      service: (c, p, actor) => service.answer(c, { roomId: p.id, actor }),
      schema: validator.schemas.id,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Mark a data-room request answered once its documents are attached.",
    },
  ],
};
