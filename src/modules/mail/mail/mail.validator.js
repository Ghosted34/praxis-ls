"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");

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
    sections: z.array(z.string().trim().max(64)).optional(),
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
  // Edit an existing IMAP/SMTP connection — everything optional (blank password
  // keeps the current one). email_address stays optional so a rename is allowed.
  connectPatch: z.object({
    email_address: z.string().email().optional(),
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

  /* ── PR-0 foundation ──────────────────────────────────────────────────── */

  // Creating a shared mailbox is the same transport form as a personal one plus
  // the two things that make it a TEAM address: which catalogue slot it fills and
  // which operating company it belongs to.
  sharedMailbox: z.object({
    catalogue_key: z.string().trim().min(1).max(64).nullable().optional(),
    email_address: z.string().email(),
    display_name: z.string().trim().max(200).optional(),
    department: z.string().trim().max(120).nullable().optional(),
    entity_id: z.string().uuid().nullable().optional(),
    imap_host: z.string().trim().max(255).optional(),
    imap_port: z.coerce.number().int().min(1).max(65535).optional(),
    imap_secure: z.coerce.boolean().optional(),
    smtp_host: z.string().trim().max(255).optional(),
    smtp_port: z.coerce.number().int().min(1).max(65535).optional(),
    smtp_secure: z.coerce.boolean().optional(),
    auth_user: z.string().trim().max(320).optional(),
    password: z.string().max(1024).optional(),
  }),

  catalogueEntry: z.object({
    catalogue_key: z.string().trim().min(1).max(64),
    label_en: z.string().trim().min(1).max(200),
    label_fr: z.string().trim().min(1).max(200).optional(),
    suggested_local_part: z.string().trim().max(64).optional(),
    description_en: z.string().trim().max(1000).nullable().optional(),
    description_fr: z.string().trim().max(1000).nullable().optional(),
    department: z.string().trim().max(120).nullable().optional(),
    sort_order: z.coerce.number().int().min(0).max(9999).optional(),
  }),

  catalogueToggle: z.object({ is_enabled: z.coerce.boolean() }),

  // A grant names a person and a level. `role` is a closed set because a typo
  // that silently produced a weaker or stronger grant than intended is exactly
  // the kind of access bug nobody notices until an audit.
  memberGrant: z.object({
    user_id: z.string().uuid(),
    member_role: z.enum(["VIEWER", "AGENT", "MANAGER"]).default("AGENT"),
  }),

  handover: z.object({
    catalogue_key: z.string().trim().min(1).max(64).nullable().optional(),
    department: z.string().trim().max(120).nullable().optional(),
  }),

  // NULL is meaningful: it clears the per-mailbox override so the tenant default
  // applies again. `.nullable()` rather than `.optional()` is the whole point.
  mailboxLimits: z.object({
    send_limit_hourly: z.coerce.number().int().min(1).max(100000).nullable().optional(),
    send_limit_daily: z.coerce.number().int().min(1).max(1000000).nullable().optional(),
    sync_depth_days: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  }),

  tenantMailSettings: z.object({
    send_limit_hourly: z.coerce.number().int().min(1).max(100000).optional(),
    send_limit_daily: z.coerce.number().int().min(1).max(1000000).optional(),
    sync_depth_days: z.coerce.number().int().min(0).max(3650).optional(),
    attachment_max_bytes: z.coerce.number().int().min(1024).max(104857600).optional(),
    folder_sync_limit: z.coerce.number().int().min(1).max(500).optional(),
  }),

  /* ── PR-1A: conversations ─────────────────────────────────────────────── */

  // Bulk is one verb over many conversations. The cap is here rather than only in
  // the service because an unbounded id list is a request-size problem before it
  // is a business one.
  threadBulk: z.object({
    ids: z.array(z.string().uuid()).min(1).max(500),
    op: z.enum(["read", "unread", "star", "unstar", "move", "label", "unlabel"]),
    folder: z.enum(["INBOX", "SENT", "DRAFTS", "SPAM", "ARCHIVE", "TRASH"]).optional(),
    label_id: z.string().uuid().optional(),
  }).refine((v) => v.op !== "move" || Boolean(v.folder), { message: "move needs a folder" })
    .refine((v) => !["label", "unlabel"].includes(v.op) || Boolean(v.label_id), { message: "label needs a label_id" }),

  threadMove: z.object({
    folder: z.enum(["INBOX", "SENT", "DRAFTS", "SPAM", "ARCHIVE", "TRASH"]),
  }),

  threadFlag: z.object({ on: z.coerce.boolean().default(true) }),

  threadStream: z.object({ stream: z.enum(["HUMAN", "SYSTEM"]) }),

  label: z.object({
    name: z.string().trim().min(1).max(64),
    colour: z.string().trim().max(32).nullable().optional(),
  }),

  labelApply: z.object({
    label_id: z.string().uuid(),
    on: z.coerce.boolean().default(true),
  }),

  // Exactly one target. Enforced here as well as in the service so the API says
  // no before a half-formed binding reaches the database.
  sendPointBinding: z.object({
    entity_id: z.string().uuid().nullable().optional(),
    email_identity_id: z.string().uuid().nullable().optional(),
    email_connection_id: z.string().uuid().nullable().optional(),
  }).refine(
    (v) => Boolean(v.email_identity_id) !== Boolean(v.email_connection_id),
    { message: "Choose either a sender identity or a mailbox to send from — one, not both." },
  ),
};

const mw = (k) => (req, _res, next) => {
  const p = schemas[k].safeParse(req.body);
  if (!p.success) return next(new AppError("VALIDATION_ERROR", "Invalid body", 422, p.error.flatten().fieldErrors));
  req.body = p.data;
  return next();
};

module.exports = {
  connect: mw("connect"), connectPatch: mw("connectPatch"), send: mw("send"), reply: mw("reply"),
  sender: mw("sender"), senderPatch: mw("senderPatch"), threadLink: mw("threadLink"),
  msWebhook: mw("msWebhook"), ggWebhook: mw("ggWebhook"),
  sharedMailbox: mw("sharedMailbox"), catalogueEntry: mw("catalogueEntry"),
  catalogueToggle: mw("catalogueToggle"), memberGrant: mw("memberGrant"),
  handover: mw("handover"), mailboxLimits: mw("mailboxLimits"),
  tenantMailSettings: mw("tenantMailSettings"), sendPointBinding: mw("sendPointBinding"),
  threadBulk: mw("threadBulk"), threadMove: mw("threadMove"), threadFlag: mw("threadFlag"),
  threadStream: mw("threadStream"), label: mw("label"), labelApply: mw("labelApply"),
  schemas,
};
