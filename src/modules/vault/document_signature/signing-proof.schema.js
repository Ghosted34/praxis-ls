/**
 * The `proof` a signing request carries (signing-proof.service). One shape,
 * required by every route that signs, so a passkey or a code is accepted in
 * exactly one form everywhere.
 *
 *   { passkey: { assertion, challenge_token } }   fingerprint / face
 *   { otp_code: "123456" }                        emailed code (fallback)
 */
"use strict";
const { z } = require("zod");

const signingProofSchema = z.union([
  z.object({
    passkey: z.object({
      // The browser's PublicKeyCredential, serialised (lib/webauthn.ts
      // fromCredential). Verified field by field by SimpleWebAuthn.
      assertion: z.record(z.unknown()),
      challenge_token: z.string().min(10).max(4000),
    }).strict(),
  }).strict(),
  z.object({ otp_code: z.string().regex(/^\d{6}$/) }).strict(),
]);

module.exports = { signingProofSchema };
