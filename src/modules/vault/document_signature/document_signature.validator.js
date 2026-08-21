"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * Sign a document as the session user.
 *
 * `.strict()` is the load-bearing part, not decoration. The rule is that a
 * signer's identity is resolved from the session and NEVER from the request
 * body — and a body carrying `signer_name` must be REJECTED rather than
 * stripped. A permissive schema that quietly dropped the field would let a
 * caller believe it had been honoured, which is exactly the confusion
 * "sign as the Managing Director by typing it into a form" relies on.
 */
const signInternal = z
  .object({
    entity_ref: z.string().min(1).max(200),
    doc_type: z.string().min(1).max(64),
    preset_code: z.string().min(1).max(32),
    sign_reason: z.string().max(64).optional(),
    // DRAWN only. Capped well under the 2 MB body limit: a signature pad
    // producing more than this is a pad that needs downscaling, not a bigger cap.
    mark_image_b64: z.string().max(300_000).regex(/^data:image\/(png|jpeg);base64,/).optional(),
  })
  .strict();

const revoke = z.object({ reason: z.string().min(3).max(500) }).strict();

const listQuery = z.object({
  entity_ref: z.string().min(1).max(200),
  lang: z.enum(["fr", "en"]).optional(),
});

const menuQuery = z.object({
  doc_type: z.string().min(1).max(64),
  lang: z.enum(["fr", "en"]).optional(),
});

const schemas = { signInternal, revoke, listQuery, menuQuery };

const body = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) {
    const fields = p.error.flatten().fieldErrors;
    // A rejected unknown key is the identity rule firing. Say so plainly rather
    // than leaving the caller to read a Zod dump.
    const unknown = p.error.issues.find((i) => i.code === "unrecognized_keys");
    if (unknown) {
      return next(new AppError(
        "SIGNER_IDENTITY_NOT_ACCEPTED",
        `Unexpected field(s): ${(unknown.keys || []).join(", ")}. A signer's identity is resolved from the session and cannot be supplied by the caller.`,
        422,
        { unexpected: unknown.keys || [] },
      ));
    }
    return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, fields));
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
  signInternal: body("signInternal"),
  revoke: body("revoke"),
  listQuery: query("listQuery"),
  menuQuery: query("menuQuery"),
  schemas,
};
