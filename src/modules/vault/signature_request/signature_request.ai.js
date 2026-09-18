/**
 * AI action manifest (AI_ARCHITECTURE §2) for signature requests (MOD-64).
 *
 * "Send this contract out for signature", "who still hasn't signed", "cancel
 * that request" — three of the most natural things to ask about a document,
 * and none of them was reachable: the module had no manifest.
 *
 * Every permission below is the SAME one its HTTP route carries, so the
 * assistant's reach is exactly the caller's reach and no wider. `advance` and
 * `decline` are absent on purpose: they are a PARTY's act, taken on the public
 * signing page against their own token, and an assistant signing on somebody
 * else's behalf is the one thing a signature product must never do.
 */
"use strict";

const service = require("./signature_request.service");
const validator = require("./signature_request.validator");

const MOD = "MOD-64";

module.exports = {
  entity: "signature_request",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_signature_requests", service: (c, p) => service.list(c, p || {}), permission: { module: MOD, action: "view" }, describe: "List signature requests (filter by entity_ref or status) — who was asked to sign what, and where each one has got to." },
    { key: "get_signature_request", service: (c, p) => service.get(c, p.signature_request_id || p.id || p), permission: { module: MOD, action: "view" }, describe: "One signature request by id, with each party's state (sent, viewed, signed, declined)." },
  ],

  writes: [
    {
      key: "create_signature_request",
      service: (c, p, actor) => service.create(c, { entityRef: p.entity_ref, docType: p.doc_type, parties: p.parties, message: p.message, requireCertified: p.require_certified, allowPaper: p.allow_paper, expiresInDays: p.expires_in_days, language: p.lang, actor }),
      schema: validator.schemas.create,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Raise a signature request over a document (entity_ref + doc_type) for one or more parties. It is not sent until it is dispatched.",
    },
    {
      key: "dispatch_signature_request",
      service: (c, p, actor) => service.dispatch(c, { id: p.signature_request_id, language: p.lang, actor }),
      schema: validator.schemas.aiDispatch,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Send a signature request by id to its next party — this is the step that emails the signing link.",
    },
    {
      key: "void_signature_request",
      service: (c, p, actor) => service.voidRequest(c, { id: p.signature_request_id, reason: p.reason, actor }),
      schema: validator.schemas.aiVoid,
      permission: { module: MOD, action: "delete" },
      confirm: true,
      describe: "Cancel a signature request by id, with a reason. Signatures already given stay on the record.",
    },
  ],
};
