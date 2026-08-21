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
  // The old inline `send` schema is gone: POST /mail/send now queues rather than
  // talking to SMTP, and its schema lives with the other PR-1B ones below. Two
  // `send` keys in this object would have silently kept the last one, which is
  // the kind of thing that passes review and then rejects a real request.
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

  /* ── PR-1B: composing ─────────────────────────────────────────────────── */

  /**
   * A TipTap document, checked only for its SHAPE.
   *
   * Validating the node tree strictly here would be a second, competing
   * definition of what the editor may produce, and it would start rejecting real
   * documents the first time TipTap adds a node type. The serializer is the
   * authority: it renders what it recognises, escapes everything, and passes
   * unknown nodes' children through. So what this enforces is that the thing is
   * a document at all, plus a size ceiling — a 20 MB JSON body is a
   * request-size problem before it is a mail problem.
   */
  bodyJson: z.object({
    type: z.literal("doc").optional(),
    content: z.array(z.object({}).passthrough()).max(5000),
  }).passthrough(),

  draft: z.object({
    email_draft_id: z.string().uuid().optional(),
    email_connection_id: z.string().uuid().nullable().optional(),
    email_thread_id: z.string().uuid().nullable().optional(),
    reply_to_message_id: z.string().uuid().nullable().optional(),
    kind: z.enum(["NEW", "REPLY", "REPLY_ALL", "FORWARD"]).optional(),
    to_address: z.array(z.string().trim().max(320)).max(100).optional(),
    cc_address: z.array(z.string().trim().max(320)).max(100).optional(),
    bcc_address: z.array(z.string().trim().max(320)).max(100).optional(),
    subject: z.string().max(998).nullable().optional(),   // RFC 5322 line limit
    body_json: z.object({}).passthrough().nullable().optional(),
    send_point_key: z.string().trim().max(64).nullable().optional(),
  }).strict(),

  /**
   * Recipients are validated as ADDRESSES here, unlike on a draft.
   *
   * A draft is a work in progress and half-typed addresses in it are normal; a
   * send is a commitment. Catching `client@acme` at the API boundary gives the
   * user an error next to the field, rather than a bounce twenty minutes later
   * from a mail server, phrased by the mail server.
   */
  send: z.object({
    connectionId: z.string().uuid(),
    email_draft_id: z.string().uuid().nullable().optional(),
    email_thread_id: z.string().uuid().nullable().optional(),
    reply_to_message_id: z.string().uuid().nullable().optional(),
    to: z.union([z.string().email(), z.array(z.string().email()).min(1).max(100)]),
    cc: z.array(z.string().email()).max(100).optional(),
    bcc: z.array(z.string().email()).max(100).optional(),
    subject: z.string().max(998).nullable().optional(),
    body_json: z.object({}).passthrough().nullable().optional(),
    html: z.string().max(2_000_000).nullable().optional(),
    text: z.string().max(2_000_000).nullable().optional(),
    quoted_html: z.string().max(2_000_000).nullable().optional(),
    quoted_text: z.string().max(2_000_000).nullable().optional(),
    in_reply_to: z.string().max(998).nullable().optional(),
    references: z.array(z.string().max(998)).max(200).optional(),
    sendPoint: z.string().trim().max(64).nullable().optional(),
    // Only the four offered values. A typo that produced a 200-second hold would
    // look exactly like sending being broken.
    undo_seconds: z.coerce.number().refine((n) => [0, 10, 20, 30].includes(n), {
      message: "undo_seconds must be 0, 10, 20 or 30",
    }).optional(),
    idempotency_key: z.string().trim().max(200).nullable().optional(),

    // Scheduled send (§9.3). Two shapes, and deliberately no third:
    //   send_at                   — an instant the operator chose
    //   send_in_recipient_morning — 09:00 on the recipient's clock
    // §9.3 MUST NOT offer "best time to send"; Q32 removed the open data that
    // would need, so there is no third option to accept here and no amount of
    // client-side wishing that can invent one.
    send_at: z.string().datetime({ offset: true }).nullable().optional(),
    send_in_recipient_morning: z.boolean().optional(),

    // §8.8's override. The reason is written to the immutable ledger, so the
    // MAXIMUM matters as much as the minimum: this is a sentence explaining a
    // decision, not somewhere to paste a thread. The 10-character floor lives
    // in `presend.js` next to the block it releases, not here — a validation
    // error on a field the user has not been shown yet reads as a bug, and the
    // block is what puts the field on screen.
    guardrail_override_reason: z.string().trim().max(2000).nullable().optional(),

    // The two language axes the LANGUAGE_MISMATCH warning compares. Named
    // separately (§3.9): the recipient's preference and the language this draft
    // was written in are different facts, and conflating them is how a French
    // client starts receiving English invoices.
    recipient_language: z.enum(["en", "fr"]).nullable().optional(),
    draft_language: z.enum(["en", "fr"]).nullable().optional(),
  }).strict()
    .refine((v) => !(v.send_at && v.send_in_recipient_morning), {
      message: "Choose either an exact time or the recipient's morning, not both.",
      path: ["send_at"],
    }),

  attachmentUpload: z.object({
    email_draft_id: z.string().uuid(),
    filename: z.string().trim().min(1).max(255),
    // A base64 data URL. The 34 MB ceiling is base64's ~33% inflation over the
    // 25 MB limit plus headroom; the real limit is enforced on decoded bytes.
    data_url: z.string().min(8).max(34_000_000),
    disposition: z.enum(["attachment", "inline"]).optional(),
    content_id: z.string().trim().max(128).nullable().optional(),
  }).strict(),

  runCommand: z.object({
    // The parameters a command declares. Loose on purpose — each command reads
    // the one or two keys it named in its manifest, and a strict schema here
    // would be a second definition of every command's signature, kept in a
    // different file from the command.
    params: z.record(z.union([z.string().max(200), z.number()])).optional(),
    lang: z.enum(["en", "fr"]).optional(),
    entity_ref: z.string().trim().max(128).regex(/^[a-z_]+:[A-Za-z0-9-]+$/).nullable().optional(),
    email_thread_id: z.string().uuid().nullable().optional(),
  }).strict(),

  attachmentFromVault: z.object({
    email_draft_id: z.string().uuid(),
    vault_id: z.string().uuid(),
    filename: z.string().trim().max(255).nullable().optional(),
    disposition: z.enum(["attachment", "inline"]).optional(),
  }).strict(),

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
  connect: mw("connect"), connectPatch: mw("connectPatch"), reply: mw("reply"),
  sender: mw("sender"), senderPatch: mw("senderPatch"), threadLink: mw("threadLink"),
  msWebhook: mw("msWebhook"), ggWebhook: mw("ggWebhook"),
  sharedMailbox: mw("sharedMailbox"), catalogueEntry: mw("catalogueEntry"),
  catalogueToggle: mw("catalogueToggle"), memberGrant: mw("memberGrant"),
  handover: mw("handover"), mailboxLimits: mw("mailboxLimits"),
  tenantMailSettings: mw("tenantMailSettings"), sendPointBinding: mw("sendPointBinding"),
  threadBulk: mw("threadBulk"), threadMove: mw("threadMove"), threadFlag: mw("threadFlag"),
  threadStream: mw("threadStream"), label: mw("label"), labelApply: mw("labelApply"),
  draft: mw("draft"), send: mw("send"),
  attachmentUpload: mw("attachmentUpload"), attachmentFromVault: mw("attachmentFromVault"),
  runCommand: mw("runCommand"),
  schemas,
};
