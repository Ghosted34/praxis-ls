/**
 * The QES provider contract (doc/SIGNATURE_ENGINEERING_GUIDE.md §7.2).
 *
 * Every adapter in services/qes/ implements EXACTLY this shape. Adding a
 * provider is a new file here plus one platform settings row — never a change
 * to a call site. The call sites are three: the signing handoff
 * (modules/vault/qes/qes.service.js), the webhook module
 * (modules/vault/qes_public/) and the poll worker
 * (jobs/handlers/qes-poll.js). A method added to one adapter and forgotten in
 * another is a class of bug `assertAdapter` exists to make impossible: the
 * resolver refuses to hand out an adapter that does not carry the full
 * surface, at resolution time, where the operator can act on it.
 *
 * ── What this file is NOT ───────────────────────────────────────────────────
 * An implementation. The SignWell specifics — endpoint paths, the webhook
 * signature scheme, the exact envelope payload shape — live in
 * signwell.adapter.js, and per the guide they were verified against the
 * provider's current documentation at implementation time rather than
 * restated here from memory. A guide (or an interface) that hardcodes a third
 * party's request shape is a guide that sends someone to debug a 400 against
 * the wrong contract.
 *
 * ── The lifecycle every adapter must respect (§7.4) ────────────────────────
 *   createEnvelope  → { envelopeId, partyLinks[] }
 *   cancelEnvelope  → { cancelled: true }
 *   getStatus       → { status, parties: [{ email, status, signedAt }] }
 *   fetchSignedDocument     → Buffer   (the provider's signed PDF)
 *   fetchAuditCertificate   → Buffer   (mirrored into our vault, §7.4)
 *   verifyWebhook   → boolean          (signature-verified BEFORE the body is
 *                                       trusted; a false must be the whole
 *                                       answer, with nothing from the body
 *                                       logged)
 *
 * `status` is the provider's state normalised to the envelope vocabulary
 * (CREATING / SENT / COMPLETED / DECLINED / CANCELLED / FAILED) — the
 * adapter, not the caller, owns the translation, because the mapping is
 * provider-specific and a caller that normalises per provider is a caller
 * that will forget one.
 */
"use strict";

/**
 * @typedef {Object} QesAdapter
 * @property {string} key  The provider_key stored on qes_envelope rows.
 *
 * @property {function({ apiKey: string, document: { name: string, fileName: string, dataBase64: string },
 *   parties: Array<{ email: string, name: string, role?: string|null, signingOrder: number }>,
 *   callbackUrl: string, webhookId: string, language: string, metadata: Object }):
 *   Promise<{ envelopeId: string, partyLinks: string[] }>} createEnvelope
 *
 * @property {function({ apiKey: string, envelopeId: string, reason?: string|null }):
 *   Promise<{ cancelled: boolean }>} cancelEnvelope
 *
 * @property {function({ apiKey: string, envelopeId: string }):
 *   Promise<{ status: string, parties: Array<{ email: string, status: string, signedAt: string|null }> }>} getStatus
 *
 * @property {function({ apiKey: string, envelopeId: string }): Promise<Buffer>} fetchSignedDocument
 * @property {function({ apiKey: string, envelopeId: string }): Promise<Buffer>} fetchAuditCertificate
 *
 * @property {function({ headers: Object, rawBody: string, secret: string }): boolean} verifyWebhook
 */

/**
 * The methods the resolver checks for, in no particular order. A provider
 * that cannot fetch the signed document cannot complete an envelope in this
 * system — the mirrored bytes ARE the evidentiary record (§7.4) — so the
 * whole surface is required, not a subset of it.
 */
const REQUIRED_METHODS = [
  "createEnvelope",
  "cancelEnvelope",
  "getStatus",
  "fetchSignedDocument",
  "fetchAuditCertificate",
  "verifyWebhook",
];

/**
 * Verify an object is a usable adapter. Throws a plain Error (not an
 * AppError) — this is a boot/resolution-time assertion about our own code,
 * not a caller error, and a caller error would let an operator "fix" a bug
 * by retrying.
 */
function assertAdapter(adapter) {
  if (!adapter || typeof adapter.key !== "string" || !adapter.key) {
    throw new Error("QES adapter is missing its key");
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof adapter[m] !== "function") {
      throw new Error(`QES adapter '${adapter.key}' does not implement ${m}()`);
    }
  }
  return adapter;
}

module.exports = { REQUIRED_METHODS, assertAdapter };
