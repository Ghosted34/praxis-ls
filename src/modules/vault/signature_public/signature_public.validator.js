"use strict";

const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

/**
 * ⚠ THERE IS NO `email` FIELD IN THIS FILE, AND THERE NEVER WILL BE.
 *
 * Q7 = C is forbidden (guide §6.3): no code path in this programme lets a
 * signer supply the address their own OTP is sent to. Every schema below is
 * `.strict()`, so a body carrying `email` is REJECTED rather than ignored —
 * the same reasoning document_signature's validator applies to `signer_name`.
 * A permissive schema that silently dropped it would let a caller believe it
 * had been honoured, which is exactly the confusion the attack relies on.
 *
 * What a signer MAY state is their own name and role. That is the DECLARED
 * identity (§1.3(d)): the name is CLAIMED, the email is PROVED, and the portal
 * and the certificate say so in those terms.
 */

const token = z.object({ token: z.string().min(20).max(200) });

const query = z.object({ lang: z.enum(["fr", "en"]).optional() });

const otpBody = z.object({ lang: z.enum(["fr", "en"]).optional() }).strict();

const verifyBody = z
  .object({
    // Six digits, and nothing else is worth a database round-trip.
    code: z.string().regex(/^[0-9]{6}$/, "A signing code is six digits"),
  })
  .strict();

const completeBody = z
  .object({
    preset_code: z.string().min(1).max(32),
    sign_reason: z.string().max(64).optional(),
    /** The signer's own name and role — claimed, and labelled as claimed. */
    full_name: z.string().min(1).max(200).optional(),
    party_role: z.string().max(120).optional(),
    /*
     * DRAWN only. Capped at 200 KB per §6.6: a signature pad producing more
     * than that is a pad that needs downscaling, not a bigger cap — and the
     * mark is stored on the row, so an uncapped one would put megabytes of
     * canvas into every read of the signature.
     */
    mark_image_b64: z.string().max(200_000).regex(/^data:image\/(png|jpeg);base64,/).optional(),
    lang: z.enum(["fr", "en"]).optional(),
  })
  .strict();

const declineBody = z
  .object({
    reason_code: z.string().min(1).max(64),
    /** Optional free text APPENDED to a chosen reason, never instead of one. */
    note: z.string().max(400).optional(),
    lang: z.enum(["fr", "en"]).optional(),
  })
  .strict();

const schemas = { token, query, otpBody, verifyBody, completeBody, declineBody };

/** A malformed token leaves by the same door as an unknown one — one 404. */
const params = (req, _res, next) => {
  const p = token.safeParse(req.params);
  if (!p.success) return next(new AppError("NOT_FOUND", "This signing link is not valid.", 404));
  const q = query.safeParse(req.query);
  if (!q.success) return next(new AppError("VALIDATION_ERROR", "Invalid query", 422, q.error.flatten().fieldErrors));
  req.validatedParams = p.data;
  req.validatedQuery = q.data;
  return next();
};

const body = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) {
    const unknown = p.error.issues.find((i) => i.code === "unrecognized_keys");
    if (unknown) {
      const keys = unknown.keys || [];
      // Name the rule rather than leaving the caller to read a Zod dump — and
      // say so especially loudly for the field this whole file exists to
      // refuse.
      const message = keys.includes("email")
        ? "A signer cannot change the address their code is sent to. If it is wrong, ask the sender to reissue the request."
        : `Unexpected field(s): ${keys.join(", ")}.`;
      return next(new AppError("UNEXPECTED_FIELD", message, 422, { unexpected: keys }));
    }
    return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  }
  req.body = p.data;
  return next();
};

module.exports = {
  params,
  otpBody: body("otpBody"),
  verifyBody: body("verifyBody"),
  completeBody: body("completeBody"),
  declineBody: body("declineBody"),
  schemas,
};
