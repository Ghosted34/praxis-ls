"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * ⚠ THE EMAIL FIELD IS THE POINT OF THIS FILE.
 *
 * `parties[].email` is accepted HERE, on the authenticated sender's request,
 * and NOWHERE on the public signing side. Q7 = C is forbidden outright
 * (guide §6.3): there is no path in this programme where a signer supplies the
 * address their own OTP is sent to. A signer states their NAME and ROLE; the
 * address was put on file by the tenant, or typed by a tenant user who is
 * named in the record and has to say why.
 *
 * `.strict()` on every schema, for the same reason document_signature's
 * validator carries it: a permissive schema that quietly drops an unexpected
 * field lets a caller believe it was honoured.
 */

const party = z
  .object({
    party_kind: z.enum(["ISSUER", "COUNTERPARTY", "WITNESS"]),
    source: z.enum(["ON_FILE", "OVERRIDE"]),
    /** `client_contact:<uuid>` | `app_user:<uuid>` — which row this came from. */
    source_ref: z.string().max(200).optional(),
    full_name: z.string().min(1).max(200),
    party_role: z.string().max(120).optional(),
    email: z.string().email().max(320),
    language: z.enum(["fr", "en"]).optional(),
    /** Required for an OVERRIDE, refused for an ON_FILE. See the refine below. */
    override_reason: z.string().min(3).max(500).optional(),
  })
  .strict()
  .refine((p) => p.source !== "OVERRIDE" || Boolean(p.override_reason), {
    message: "An override needs a reason: it is what the certificate prints so a reader can weigh the address",
    path: ["override_reason"],
  })
  .refine((p) => p.source !== "ON_FILE" || !p.override_reason, {
    message: "An on-file party has no override reason",
    path: ["override_reason"],
  });

const create = z
  .object({
    entity_ref: z.string().min(1).max(200),
    doc_type: z.string().min(1).max(64),
    // Ordered. Position in this array IS sequence_no, so the sender's ordering
    // is the signing order with no second field to disagree with it.
    parties: z.array(party).min(1).max(10),
    message: z.string().max(2000).optional(),
    /*
     * Funnel level 3 — TWO BOOLEANS, not a menu (§1.5(a)).
     *
     * Every digital card is AES_OTP, so STAMP and DRAWN differ in appearance
     * and never in legal weight: a sender choosing between them is picking a
     * LOOK on the signer's behalf, which is the one choice the signer was
     * meant to make. The only sender decisions that change the EVIDENCE are
     * these two.
     */
    require_certified: z.boolean().optional(),
    allow_paper: z.boolean().optional(),
    expires_in_days: z.number().int().min(1).max(365).optional(),
    lang: z.enum(["fr", "en"]).optional(),
  })
  .strict()
  .refine((b) => b.parties.filter((p) => p.source === "OVERRIDE").length <= 1, {
    // The friendly half of the Q7 cap. `uq_sigparty_one_override` is the half
    // that stays true when a future import path forgets to call this.
    message: "Only one signatory may be entered by hand — everyone else must come from your records",
    path: ["parties"],
  });

const voidRequest = z.object({ reason: z.string().max(500).optional() }).strict();

const listQuery = z.object({
  entity_ref: z.string().min(1).max(200).optional(),
  status: z.enum(["DRAFT", "SENT", "PARTIALLY_SIGNED", "COMPLETED", "DECLINED", "EXPIRED", "AMENDED", "VOIDED"]).optional(),
  lang: z.enum(["fr", "en"]).optional(),
});

const dispatchBody = z.object({ lang: z.enum(["fr", "en"]).optional() }).strict();

/**
 * Who may be asked to sign this document. Both fields required: the resolver
 * needs the doc type to know WHICH counterparty a ref points at, and answering
 * for the wrong one would put a stranger's address in front of the sender.
 */
const candidatesQuery = z.object({
  entity_ref: z.string().min(1).max(200),
  doc_type: z.string().min(1).max(64),
});

const schemas = { create, voidRequest, listQuery, dispatchBody, candidatesQuery };

const body = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) {
    const unknown = p.error.issues.find((i) => i.code === "unrecognized_keys");
    if (unknown) {
      return next(new AppError(
        "UNEXPECTED_FIELD",
        `Unexpected field(s): ${(unknown.keys || []).join(", ")}.`,
        422,
        { unexpected: unknown.keys || [] },
      ));
    }
    return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  }
  req.body = p.data;
  return next();
};

const query = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.query);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, p.error.flatten().fieldErrors));
  req.validatedQuery = p.data;
  return next();
};

module.exports = {
  create: body("create"),
  voidRequest: body("voidRequest"),
  dispatchBody: body("dispatchBody"),
  listQuery: query("listQuery"),
  candidatesQuery: query("candidatesQuery"),
  schemas,
};
