"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");
const { schemas: qTicket } = require("../operations/q_ticket/q_ticket.validator");

/*
 * WebAuthn envelopes — the same shapes the staff validator declares
 * (security/app_user/app_user.validator.js), for the same reason: SimpleWebAuthn
 * is the security boundary, and these only make sure the members it reads are
 * there and bounded.
 */
const b64url = z.string().min(1).max(16384).regex(/^[A-Za-z0-9_-]+={0,2}$/);
const credentialId = z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/);
const challengeToken = z.string().min(20).max(4096);
const credentialEnvelope = {
  id: credentialId,
  rawId: credentialId,
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.unknown()).optional(),
  authenticatorAttachment: z.string().max(40).optional().nullable(),
};
/** "Keep me signed in" — optional everywhere a sign-in can happen, off by default. */
const trust = z.boolean().optional();

/*
 * Client-portal uploads arrive as MULTIPART (a file and its fields), so every
 * field is a string by the time this sees it: numbers, the allocation list and
 * blanks are coerced here rather than trusted as typed.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const blankToUndefined = (v) => (v === "" || v === "null" || v === null ? undefined : v);
const optText = (max) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const optUuid = z.preprocess(blankToUndefined, z.string().uuid().optional());
const money = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v.replace(/\s/g, "").replace(",", ".")) : v),
  z.number().finite().positive().max(1e12),
);
const jsonField = (schema) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }, schema);
const flag = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());
const SCOPES = ["ALL", "OPERATIONS", "BILLING"];

const schemas = {
  login: z.object({ email: z.string().email(), password: z.string().min(1), trust_device: trust }),
  refresh: z.object({ refresh_token: z.string().min(20).max(200) }),
  logout: z.object({ refresh_token: z.string().min(20).max(200).optional() }),
  codeRequest: z.object({ email: z.string().trim().email() }),
  codeVerify: z.object({ email: z.string().trim().email(), code: z.string().trim().regex(/^\d{6}$/), trust_device: trust }),
  passkeyLoginOptions: z.object({
    email: z.string().trim().email().optional().nullable(),
    credential_ids: z.array(credentialId).max(10).optional(),
  }),
  passkeyLoginVerify: z.object({
    assertion: z.object({
      ...credentialEnvelope,
      response: z.object({
        clientDataJSON: b64url,
        authenticatorData: b64url,
        signature: b64url,
        userHandle: z.string().max(1024).optional().nullable(),
      }).passthrough(),
    }).passthrough(),
    challengeToken,
    trust_device: trust,
  }),
  passkeyRegisterVerify: z.object({
    attestation: z.object({
      ...credentialEnvelope,
      response: z.object({
        clientDataJSON: b64url,
        attestationObject: b64url,
        transports: z.array(z.string().max(40)).max(10).optional(),
      }).passthrough(),
    }).passthrough(),
    challengeToken,
    label: z.string().max(80).optional().nullable(),
  }),
  create: z.object({ email: z.string().email(), password: z.string().min(8), full_name: z.string().optional() }),
  password: z.object({ password: z.string().min(8) }),
  status: z.object({ status: z.enum(["ACTIVE", "DISABLED"]) }),
  // Invite takes no password: staff must not choose an external party's
  // credentials. `full_name` is optional because a grant is issued against an
  // email address and the name may not be known yet.
  invite: z.object({ email: z.string().email(), full_name: z.string().optional() }),
  forgot: z.object({ email: z.string().email() }),
  accept: z.object({ token: z.string().min(1), password: z.string().min(8), trust_device: trust }),
  // Q tickets raised from the portal. Reuses the module's own shapes so the
  // internal and external surfaces validate identically — with one exception
  // enforced in the service, not here: a client can never post an internal note,
  // whatever the body says.
  raiseTicket: qTicket.raise,
  replyTicket: qTicket.reply,
  // Self-service quoting from the portal (PRD §11.1). client_id is never
  // accepted from the body — the grant decides the client.
  portalQuote: z.object({
    service_category: z.string().min(1).max(80),
    service_type: z.string().optional(),
    origin_location: z.string().min(1).max(120),
    destination_location: z.string().min(1).max(120),
    estimated_weight: z.number().nonnegative().optional(),
    cargo_description: z.string().max(2000).optional(),
    incoterm: z.string().max(40).optional(),
  }),
  // ── Client portal redesign (14150) ──
  // A file for a request: the file is the whole body.
  requestUpload: z.object({}),
  // A bodyless action (remove a colleague): nothing the caller sends is read.
  empty: z.object({}),
  requestAnswer: z.object({ text: z.string().trim().min(1).max(4000) }),
  shareDocument: z.object({ doc_type_code: optText(60), dossier_id: optUuid, note: optText(1000) }),
  paymentProof: z.object({
    amount: money,
    currency: z.preprocess(blankToUndefined, z.string().trim().regex(/^[A-Za-z]{3}$/).optional()),
    method: z.enum(["BANK", "MOBILE_MONEY", "CASH", "CHEQUE"]),
    provider: optText(60),
    paid_on: isoDate,
    reference: optText(120),
    note: optText(1000),
    dossier_id: optUuid,
    allocations: jsonField(z.array(z.object({ invoice_id: z.string().uuid(), amount: money })).max(50)).optional(),
  }),
  teamInvite: z.object({
    email: z.string().trim().email(),
    full_name: optText(120),
    access_scope: z.enum(SCOPES).optional(),
    is_client_admin: flag.optional(),
  }),
  teamUpdate: z.object({ access_scope: z.enum(SCOPES).optional(), is_client_admin: flag.optional() }),
  // Staff side of the same (MOD-29 requests, MOD-52 payment claims).
  staffCreateRequest: z.object({
    client_id: z.string().uuid(),
    dossier_id: z.string().uuid().optional().nullable(),
    kind: z.enum(["DOCUMENT", "INFO"]),
    doc_type_code: z.string().trim().max(60).optional().nullable(),
    title: z.string().trim().max(200).optional().nullable(),
    note: z.string().trim().max(2000).optional().nullable(),
    due_on: isoDate.optional().nullable(),
  }),
  staffReviewRequest: z.object({
    decision: z.enum(["ACCEPT", "REJECT", "CANCEL"]),
    note: z.string().trim().max(1000).optional().nullable(),
  }),
  staffConfirmProof: z.object({ treasury_account_id: z.string().uuid().optional().nullable() }),
  staffRejectProof: z.object({ note: z.string().trim().min(1).max(1000) }),
  // A portal message — the body is the only thing the caller supplies.
  message: z.object({ body: z.string().trim().min(1).max(4000), dossier_id: z.string().uuid().optional() }),
  // Staff reply — client_id comes from the caller (staff route).
  staffMessage: z.object({ client_id: z.string().uuid(), body: z.string().trim().min(1).max(4000), dossier_id: z.string().uuid().optional() }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  login: mw("login"), create: mw("create"), password: mw("password"), status: mw("status"),
  invite: mw("invite"), forgot: mw("forgot"), accept: mw("accept"),
  refresh: mw("refresh"), logout: mw("logout"), codeRequest: mw("codeRequest"), codeVerify: mw("codeVerify"),
  passkeyLoginOptions: mw("passkeyLoginOptions"), passkeyLoginVerify: mw("passkeyLoginVerify"),
  passkeyRegisterVerify: mw("passkeyRegisterVerify"),
  raiseTicket: mw("raiseTicket"), replyTicket: mw("replyTicket"),
  portalQuote: mw("portalQuote"), message: mw("message"), staffMessage: mw("staffMessage"),
  requestUpload: mw("requestUpload"), empty: mw("empty"), requestAnswer: mw("requestAnswer"), shareDocument: mw("shareDocument"),
  paymentProof: mw("paymentProof"), teamInvite: mw("teamInvite"), teamUpdate: mw("teamUpdate"),
  staffCreateRequest: mw("staffCreateRequest"), staffReviewRequest: mw("staffReviewRequest"),
  staffConfirmProof: mw("staffConfirmProof"), staffRejectProof: mw("staffRejectProof"),
  schemas,
};
