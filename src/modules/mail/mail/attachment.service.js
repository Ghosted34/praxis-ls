/**
 * Attaching files to a draft — uploaded, or referenced from the vault.
 *
 * ── BYTES GO TO THE VAULT, NOT INTO THE DRAFT ROW ───────────────────────────
 *
 * `email_attachment` holds a REFERENCE. The file itself lives in the document
 * vault, under the same storage, retention and access machinery as every other
 * document in the tenant. Three things follow that are worth having:
 *
 *   · A 20 MB draft does not sit in a Postgres row being copied by every backup.
 *   · A file attached from the vault is not duplicated — it is the same bytes,
 *     referenced twice, so a bill of lading emailed to four people is stored once.
 *   · When the message sends, the attachment's owner moves from the draft to the
 *     message and the vault entry's ref moves with it, so the file remains
 *     findable from the correspondence for as long as the message exists.
 *
 * ── THE CAP IS ON THE SUM, AND IT IS CHECKED BEFORE THE BYTES ARE STORED ────
 *
 * 25 MB for the whole message (Q9), not per file: the recipient's mail host
 * rejects on the total, and five 6 MB files each pass a per-file check. Checked
 * before the vault write, so a file that would breach it is refused rather than
 * stored and then deleted — a failed upload should leave nothing behind.
 */
"use strict";

const repo = require("./outbox.repo");
const outbox = require("./outbox.service");
const documentVault = require("../../vault/document_vault/document_vault.service");
const { AppError } = require("../../../utils/errors");
const { emitEvent, resolveActorId } = require("../../../shared/events/emit");
const { parseDataUrl } = require("../../../utils/data-url");

const MODULE = "MOD-72";

/** The draft must exist AND be the caller's. Both, in one lookup. */
async function assertOwnDraft(client, actor, draftId) {
  const draft = await repo.getDraft(client, actor.user_id, draftId);
  if (!draft) throw new AppError("NOT_FOUND", "draft not found", 404);
  return draft;
}

/**
 * `created_by` REFERENCES app_user, and identity lives in the LIVE schema
 * (DATA 2.4). Mail is pinned to live by `req.identityDb`, so in practice the id
 * always resolves — but the guard is a blanket rule for a good reason, and a
 * caller that ever reached this from a sandbox connection would otherwise get a
 * 23503 that fails the whole upload rather than a null column.
 */
const creator = (client, actor) => resolveActorId(client, actor && actor.user_id);

/**
 * A Content-ID for an inline image.
 *
 * Domain-shaped because some clients validate it as an addr-spec, and random
 * because a predictable cid collides the moment someone forwards one message
 * into another.
 */
const newContentId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}@praxis`;

/**
 * Upload a file and stage it on a draft.
 *
 * The vault sniffs the real content type rather than trusting the declared one,
 * which matters more here than for an ordinary upload: an attachment is about to
 * be posted to a third party, and a file whose name says PDF and whose bytes say
 * something else is how a tenant's domain ends up on a blocklist.
 */
async function upload(client, actor, input = {}) {
  const draft = await assertOwnDraft(client, actor, input.email_draft_id);

  const parsed = parseDataUrl(input.data_url);
  if (!parsed) throw new AppError("BAD_FILE", "Expected a base64 data URL", 400);
  if (!parsed.buffer.length) throw new AppError("EMPTY_FILE", "That file is empty", 422);

  // Before the vault write, so a refused upload leaves nothing behind.
  const room = await outbox.assertRoomFor(client, draft.email_draft_id, parsed.buffer.length);

  const doc = await documentVault.createDocument(client, {
    dataUrl: input.data_url,
    slug: input.slug,
    entityRef: `email_draft:${draft.email_draft_id}`,
    docType: null,
    originalName: input.filename,
    maxBytes: outbox.ATTACH_MAX_BYTES,
    sniff: true,
    actor,
  });

  const inline = input.disposition === "inline";
  const row = await repo.addAttachment(client, {
    email_draft_id: draft.email_draft_id,
    vault_id: doc.doc_id,
    filename: input.filename,
    content_type: parsed.mimeType,
    size_bytes: parsed.buffer.length,
    direction: "OUT",
    disposition: inline ? "inline" : "attachment",
    content_id: inline ? (input.content_id || newContentId()) : null,
    created_by: await creator(client, actor),
  });

  await emitEvent(client, {
    eventTypeKey: "email.attachment.added", moduleKey: MODULE,
    entityRef: `email_draft:${draft.email_draft_id}`, actorUserId: actor.user_id || null,
    payload: { filename: input.filename, bytes: parsed.buffer.length, source: "upload" },
  }).catch(() => { /* @silent:storage the attachment row is the outcome */ });

  return { ...row, total_bytes: room.total_bytes, offer_secure_link: room.offer_secure_link };
}

/**
 * Attach a file the tenant already holds. The internal document picker.
 *
 * Nothing is copied: the same `vault_id` is referenced a second time. The
 * caller's right to it is the vault's decision — `getByRef`/`get` apply the
 * module's own confidentiality rules, so a document somebody may not open is
 * one they may not attach either.
 */
async function fromVault(client, actor, input = {}) {
  const draft = await assertOwnDraft(client, actor, input.email_draft_id);

  const doc = await documentVault.get(client, input.vault_id, { actor });
  if (!doc) throw new AppError("NOT_FOUND", "document not found", 404);

  const bytes = Number(doc.size_bytes || doc.bytes || 0);
  const room = await outbox.assertRoomFor(client, draft.email_draft_id, bytes);

  const inline = input.disposition === "inline";
  const row = await repo.addAttachment(client, {
    email_draft_id: draft.email_draft_id,
    vault_id: input.vault_id,
    filename: input.filename || doc.original_name || doc.filename || "document",
    content_type: doc.content_type,
    size_bytes: bytes || null,
    direction: "OUT",
    disposition: inline ? "inline" : "attachment",
    content_id: inline ? (input.content_id || newContentId()) : null,
    created_by: await creator(client, actor),
  });

  await emitEvent(client, {
    eventTypeKey: "email.attachment.added", moduleKey: MODULE,
    entityRef: `email_draft:${draft.email_draft_id}`, actorUserId: actor.user_id || null,
    payload: { filename: row.filename, bytes, source: "vault", vault_id: input.vault_id },
  }).catch(() => { /* @silent:storage the attachment row is the outcome */ });

  return { ...row, total_bytes: room.total_bytes, offer_secure_link: room.offer_secure_link };
}

async function list(client, actor, draftId) {
  await assertOwnDraft(client, actor, draftId);
  const rows = await repo.listDraftAttachments(client, draftId);
  const total = rows.reduce((n, r) => n + Number(r.size_bytes || 0), 0);
  return {
    attachments: rows,
    total_bytes: total,
    limit_bytes: outbox.ATTACH_MAX_BYTES,
    offer_secure_link: total > outbox.SECURE_LINK_HINT_BYTES,
  };
}

/**
 * Detach.
 *
 * The vault entry is deliberately LEFT. The same bytes may be referenced by
 * another draft or by a message already sent — the whole point of referencing
 * rather than copying — so deleting them here would remove a file from
 * correspondence that has already gone out. Vault retention reaps what nothing
 * references; that is its job, not this one's.
 */
async function remove(client, actor, draftId, attachmentId) {
  await assertOwnDraft(client, actor, draftId);
  const gone = await repo.removeDraftAttachment(client, actor.user_id, draftId, attachmentId);
  if (!gone) throw new AppError("NOT_FOUND", "attachment not found on that draft", 404);
  return { email_attachment_id: attachmentId, removed: true };
}

module.exports = { upload, fromVault, list, remove, newContentId, assertOwnDraft };
