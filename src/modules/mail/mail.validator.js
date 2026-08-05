"use strict";
const { z } = require("zod");
const { AppError } = require("../../utils/errors");

const schemas = {
  // SEC H3 guard. The two provider webhooks passed req.body straight into the
  // notification handlers with nothing checking it.
  //
  // These are the ONLY schemas here that are deliberately loose on their inner
  // objects. The payload shape belongs to Microsoft and Google, not to us, and
  // a strict schema would start rejecting real notifications the next time
  // either provider adds a field. What is enforced is the ENVELOPE — the parts
  // the handlers actually destructure — plus a cap on the array so a malformed
  // or hostile POST cannot hand the handler a million items to loop over.
  //
  // Note this is a shape check, not an authenticity check. Whether the caller
  // is really Microsoft is a separate question (clientState / Pub/Sub JWT) and
  // a separate finding.
  msWebhook: z.object({
    value: z.array(z.object({}).passthrough()).max(1000),
  }).passthrough(),
  ggWebhook: z.object({
    message: z.object({
      data: z.string().max(1_000_000).optional(),
      messageId: z.string().max(256).optional(),
    }).passthrough(),
    subscription: z.string().max(512).optional(),
  }).passthrough(),
  // API F-15: POST /mail/senders, PATCH /mail/senders/:id and
  // POST /mail/thread/:id/link all read req.body with no validator. The sender
  // routes write the address the tenant's outbound mail is FROM, so an
  // unchecked value here is a deliverability and spoofing question, not just a
  // typo — and `purpose` selects which identity row gets overwritten.
  sender: z.object({
    purpose: z.string().trim().min(1).max(64),
    from_address: z.string().email().optional(),
    from_name: z.string().trim().max(200).optional(),
    reply_to: z.string().email().nullable().optional(),
    smtp_host: z.string().trim().max(255).nullable().optional(),
    smtp_port: z.coerce.number().int().min(1).max(65535).nullable().optional(),
    is_active: z.boolean().optional(),
  }).strict(),
  // PATCH is the same shape with nothing required; `purpose` selects the row on
  // upsert but must not be repurposed to move an existing one.
  senderPatch: z.object({
    from_address: z.string().email().optional(),
    from_name: z.string().trim().max(200).optional(),
    reply_to: z.string().email().nullable().optional(),
    smtp_host: z.string().trim().max(255).nullable().optional(),
    smtp_port: z.coerce.number().int().min(1).max(65535).nullable().optional(),
    is_active: z.boolean().optional(),
  }).strict(),
  // "invoice:UUID" | "dossier:SLAS-2026-0001" — the entity_ref convention.
  threadLink: z.object({
    entity_ref: z.string().trim().min(3).max(128).regex(/^[a-z_]+:[A-Za-z0-9-]+$/, "expected entity_ref like invoice:UUID"),
  }).strict(),
  connect: z.object({
    email_address: z.string().email(),
    provider: z.enum(["imap_smtp", "microsoft_graph", "google_gmail"]).optional(),
    display_name: z.string().optional(),
    imap_host: z.string().min(1).optional(),
    imap_port: z.coerce.number().int().positive().optional(),
    imap_secure: z.boolean().optional(),
    smtp_host: z.string().min(1).optional(),
    smtp_port: z.coerce.number().int().positive().optional(),
    smtp_secure: z.boolean().optional(),
    auth_user: z.string().optional(),
    password: z.string().min(1).max(4000).optional(),
  }),
  send: z.object({
    connectionId: z.string().uuid(),
    to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
    cc: z.array(z.string().email()).optional(),
    subject: z.string().optional(),
    html: z.string().optional(),
    text: z.string().optional(),
  }),
  reply: z.object({
    connectionId: z.string().uuid(),
    html: z.string().optional(),
    text: z.string().optional(),
  }),
  // AI copilot reply carries the target message id in the body (no route param).
  aiReply: z.object({
    connectionId: z.string().uuid(),
    inboundId: z.string().uuid(),
    html: z.string().optional(),
    text: z.string().optional(),
  }),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  connect: mw("connect"), send: mw("send"), reply: mw("reply"),
  sender: mw("sender"), senderPatch: mw("senderPatch"), threadLink: mw("threadLink"),
  msWebhook: mw("msWebhook"), ggWebhook: mw("ggWebhook"),
  schemas,
};
