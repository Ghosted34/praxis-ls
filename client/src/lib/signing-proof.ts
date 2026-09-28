/**
 * The signer's confirmation — fingerprint / face, or an emailed code — for one
 * document. Server: src/modules/vault/document_signature/signing-proof.service.
 * The UI that asks for it is `useSigningProof()` (components/signing).
 */
import { tenant } from "@/lib/api-client";

/** What a signing route takes as `proof`. */
export type SigningProof =
  | { passkey: { assertion: Record<string, unknown>; challenge_token: string } }
  | { otp_code: string };

export type SigningTarget = { entityRef: string; docType: string };

export const proofOptions = (t: SigningTarget) =>
  tenant<{ has_passkey: boolean; options: Record<string, unknown> | null }>(
    "/signatures/proof/options",
    {
      method: "POST",
      body: { entity_ref: t.entityRef, doc_type: t.docType },
    },
  );

export const sendSigningCode = (t: SigningTarget) =>
  tenant<{ sent_to?: string | null; expires_at?: string | null }>(
    "/signatures/proof/otp",
    {
      method: "POST",
      body: { entity_ref: t.entityRef, doc_type: t.docType },
    },
  );
