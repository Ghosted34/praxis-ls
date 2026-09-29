/**
 * The client chat (client portal redesign PR 2, migration 14170).
 *
 * WHAT THE OWNER ASKED FOR: "chat like WhatsApp, with images" — a General
 * thread with the company, and one per shipment, so a question about container
 * MSKU 123 does not scroll past the one about last month's invoice. Photos,
 * PDFs, voice notes and a location pin travel in it; a message can name the
 * stage of the shipment it is about ("Arrival in Douala"); and the team sees
 * what arrived, the client sees what was read.
 *
 * WHAT A THREAD IS: `client_message.dossier_id` — a shipment, or NULL for
 * General. The client's side is scoped twice: in SQL to their company, and by
 * their team role — a colleague given Billing only has the General thread and
 * never a shipment's, the same rule every shipment route applies.
 *
 * FILES ARE VAULT DOCUMENTS. A photo of a damaged container is evidence, so it
 * is stored the way every file a client sends is: hashed, PENDING until
 * someone looks, and never shown in the portal's Documents list (that list is
 * the registry's client-visible types; a chat photo has no type). What the
 * chat stores is the link and the shape: kind, size, dimensions, duration.
 */
"use strict";

const repo = require("./portal_chat.repo");
const vault = require("../vault/document_vault/document_vault.service");
const notifications = require("../notification/notification.service");
const notificationRepo = require("../notification/notification.repo");
const storage = require("../../services/storage.service");
const imagePipeline = require("../../services/image-pipeline.service");
const { emitEvent, resolveActorId } = require("../../shared/events/emit");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

const MODULE = "MOD-67"; // client support — where the chat's events are filed
/**
 * The Client inbox (PR 3, seeds 90997/9136): the permission of the people who
 * answer clients — operations, sales, management. A message nobody owns goes
 * to them. It replaced MOD-67 (IAM) here, whose holders are administrators.
 */
const INBOX_MODULE = "MOD-64C";
const PAGE = 40;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const FILE_TYPES = ["application/pdf"];
/** What MediaRecorder produces: Chrome and Android webm/opus, Firefox ogg, Safari mp4/aac. */
const VOICE_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac"];
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Five minutes of 32 kbit/s opus is 1.2 MB; 8 MB leaves room for Safari's AAC. */
const MAX_VOICE_BYTES = 8 * 1024 * 1024;
const MAX_VOICE_MS = 5 * 60 * 1000;

/** The bare media type: MediaRecorder's blobs say `audio/webm;codecs=opus`. */
const bareType = (t) => String(t || "").split(";")[0].trim().toLowerCase();

/**
 * What the bytes of a voice note ARE. The vault sniffs the formats an
 * operations file accepts, and audio is not one of them, so the chat checks
 * its own — the same rule: the declared type names the file, the bytes decide
 * whether it is stored at all.
 */
function sniffAudio(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "audio/webm";
  if (buffer.slice(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (buffer.slice(4, 8).toString("ascii") === "ftyp") return "audio/mp4";
  if (buffer.slice(0, 3).toString("ascii") === "ID3") return "audio/mpeg";
  // An MPEG audio frame sync — MP3, or AAC in ADTS framing.
  if (buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0) return "audio/aac";
  return null;
}

/** IMAGE, FILE or VOICE — decided by the declared type, confirmed by the bytes. */
function kindOf(file) {
  const type = bareType(file.mimetype);
  if (IMAGE_TYPES.includes(type)) return "IMAGE";
  if (FILE_TYPES.includes(type)) return "FILE";
  if (VOICE_TYPES.includes(type) || type === "audio/x-m4a") return "VOICE";
  throw new AppError("BAD_FILE", "Send a photo, a PDF or a voice note", 422);
}

const clean = (s) => String(s || "").trim();

/** One line for a thread list or a notification: the text, else what was sent. */
function previewOf(row) {
  const body = clean(row.body);
  if (body) return body.length > 140 ? `${body.slice(0, 139)}…` : body;
  return null;
}

/** What a sent thing IS when it has no words: "IMAGE", "VOICE", "LOCATION"… */
function contentKind(row) {
  if (row.attachment_kind) return row.attachment_kind;
  if (row.has_location) return "LOCATION";
  return "TEXT";
}

/* ── views ──────────────────────────────────────────────────────────────── */

function messageView(row, { me = null, lang = "en" } = {}) {
  const mine = row.direction === "CLIENT" && !!me &&
    (row.portal_user_id === me.portal_user_id ||
      String(row.author_email || "").toLowerCase() === String(me.email || "").toLowerCase());
  const attachments = (row.attachments || []).map((a) => ({
    attachment_id: a.attachment_id,
    kind: a.kind,
    name: a.file_name || null,
    mime_type: a.mime_type || null,
    size: a.byte_size || null,
    width: a.width || null,
    height: a.height || null,
    duration_ms: a.duration_ms || null,
  }));
  return {
    message_id: row.message_id,
    dossier_id: row.dossier_id || null,
    dossier_ref: row.dossier_ref || null,
    direction: row.direction,
    body: row.body || "",
    created_at: row.created_at,
    // A client's message names the colleague who wrote it: its login id and
    // email are here, and the controller reads the name from the identity
    // schema (the login lives there, the message in the business schema).
    author: {
      name: row.direction === "STAFF" ? row.author_name || null : row.author_portal_name || null,
      email: row.direction === "CLIENT" ? row.author_email || null : null,
      portal_user_id: row.direction === "CLIENT" ? row.portal_user_id || null : null,
    },
    mine,
    // The team has read it — the client's "seen" tick. Only meaningful on the
    // client's own messages; staff messages are the team's own.
    seen: row.direction === "CLIENT" ? !!row.staff_read_at : null,
    milestone: row.milestone_instance_id
      ? {
          milestone_instance_id: row.milestone_instance_id,
          label: (lang === "en" && row.milestone_label_en) || row.milestone_label || null,
        }
      : null,
    location:
      row.location_lat !== null && row.location_lat !== undefined
        ? { lat: Number(row.location_lat), lng: Number(row.location_lng), label: row.location_label || null }
        : null,
    attachments,
  };
}

/* ── client ─────────────────────────────────────────────────────────────── */

const canShipments = (scope) => scope !== "BILLING";

/** The thread a client is asking for, checked: General, or a shipment of theirs they may see. */
async function clientThread(c, { clientId, scope, thread }) {
  if (!thread || thread === "general") return null;
  if (!canShipments(scope)) {
    throw new AppError("PORTAL_SCOPE", "Your access does not include shipments", 403);
  }
  const dossier = await repo.clientDossier(c, { clientId, dossierId: thread });
  if (!dossier) throw new AppError("NOT_FOUND", "No such shipment", 404);
  return dossier;
}

/** General first — it is always there — then the shipments, newest activity first. */
async function threads(c, { clientId, me, scope, since }) {
  const rows = await repo.threads(c, { clientId, portalUserId: me.portal_user_id, email: me.email, since });
  const visible = rows.filter((r) => !r.dossier_id || canShipments(scope));
  const view = (r) => ({
    thread: repo.threadKey(r.dossier_id),
    dossier_id: r.dossier_id || null,
    dossier_ref: r.dossier_ref || null,
    dossier_status: r.dossier_status || null,
    unread: Number(r.unread || 0),
    last: r.message_id
      ? {
          direction: r.direction,
          mine: r.direction === "CLIENT" &&
            (r.portal_user_id === me.portal_user_id || String(r.author_email || "").toLowerCase() === String(me.email || "").toLowerCase()),
          preview: previewOf(r),
          kind: contentKind(r),
          at: r.created_at,
        }
      : null,
  });
  const general = visible.find((r) => !r.dossier_id);
  return [
    general ? view(general) : { thread: "general", dossier_id: null, dossier_ref: null, dossier_status: null, unread: 0, last: null },
    ...visible.filter((r) => r.dossier_id).map(view),
  ];
}

async function unread(c, { clientId, me, scope, since }) {
  return repo.unreadTotal(c, {
    clientId, portalUserId: me.portal_user_id, email: me.email, since, shipments: canShipments(scope),
  });
}

async function messages(c, { clientId, me, scope, thread, before = null, lang = "en" }) {
  const dossier = await clientThread(c, { clientId, scope, thread });
  const rows = await repo.messages(c, { clientId, dossierId: dossier ? dossier.dossier_id : null, before, limit: PAGE });
  return {
    thread: repo.threadKey(dossier && dossier.dossier_id),
    dossier_ref: dossier ? dossier.ref : null,
    has_more: rows.length === PAGE,
    messages: rows.map((r) => messageView(r, { me, lang })),
  };
}

async function read(c, { clientId, me, scope, thread, at = null }) {
  const dossier = await clientThread(c, { clientId, scope, thread });
  await repo.markRead(c, { clientId, portalUserId: me.portal_user_id, dossierId: dossier && dossier.dossier_id, at });
  return { thread: repo.threadKey(dossier && dossier.dossier_id) };
}

/**
 * Store one attachment in the vault. Images and PDFs go through the vault's
 * own sniff; a voice note is checked here (see sniffAudio) and passes the
 * image pipeline untouched.
 */
async function storeAttachment(c, { clientId, file, meta = {}, status, slug, actor = {} }) {
  const kind = kindOf(file);
  const declared = bareType(file.mimetype) === "audio/x-m4a" ? "audio/mp4" : bareType(file.mimetype);
  if (kind === "VOICE") {
    const actual = sniffAudio(file.buffer);
    if (!actual) throw new AppError("BAD_FILE", "This recording could not be read", 422);
    if (file.buffer.length > MAX_VOICE_BYTES) throw new AppError("FILE_TOO_LARGE", "This voice note is too long", 413);
    if (meta.durationMs && meta.durationMs > MAX_VOICE_MS) throw new AppError("VOICE_TOO_LONG", "Voice notes can be up to five minutes", 422);
  }
  const doc = await vault.createDocument(c, {
    entityRef: `client_chat:${clientId}`,
    file: { ...file, mimetype: declared },
    clientId,
    originalName: file.originalname || null,
    maxBytes: kind === "VOICE" ? MAX_VOICE_BYTES : MAX_FILE_BYTES,
    allowedTypes: kind === "IMAGE" ? IMAGE_TYPES : kind === "FILE" ? FILE_TYPES : VOICE_TYPES,
    sniff: kind !== "VOICE",
    status,
    slug,
    actor,
  });
  return {
    docId: doc.doc_id,
    kind,
    fileName: file.originalname || null,
    mimeType: declared,
    byteSize: file.buffer.length,
    width: kind === "IMAGE" ? meta.width || null : null,
    height: kind === "IMAGE" ? meta.height || null : null,
    durationMs: kind === "VOICE" ? meta.durationMs || null : null,
  };
}

/** A message needs SOMETHING: words, a file, or a place. */
function assertNotEmpty({ body, file, location }) {
  if (!clean(body) && !file && !location) {
    throw new AppError("EMPTY_MESSAGE", "Write something, or attach a photo, a file or a location", 422);
  }
}

async function namedStage(c, { dossier, milestoneId }) {
  if (!milestoneId) return null;
  if (!dossier) throw new AppError("MILESTONE_MISMATCH", "A stage belongs to a shipment's conversation", 422);
  const stage = await repo.clientMilestone(c, { dossierId: dossier.dossier_id, milestoneId });
  if (!stage) throw new AppError("MILESTONE_MISMATCH", "That step is not on this shipment", 422);
  return stage;
}

/** A client writes — text, a file, a pin, or a mix — and the team is told. */
async function send(c, { clientId, me, scope, thread, body = "", milestoneId = null, location = null, file = null, meta = {}, slug, lang = "en" }) {
  assertNotEmpty({ body, file, location });
  const dossier = await clientThread(c, { clientId, scope, thread });
  const stage = await namedStage(c, { dossier, milestoneId });
  const stored = file ? await storeAttachment(c, { clientId, file, meta, status: "PENDING", slug }) : null;

  // The message and its attachment land together: a message whose photo
  // failed to link would be an empty bubble.
  const row = await atomically(c, async () => {
    const m = await repo.insertMessage(c, {
      clientId, dossierId: dossier && dossier.dossier_id, direction: "CLIENT", body: clean(body),
      authorEmail: me.email, portalUserId: me.portal_user_id, milestoneId: stage && stage.milestone_instance_id, location,
    });
    if (stored) await repo.insertAttachment(c, { messageId: m.message_id, ...stored });
    // Writing in a thread is reading it.
    await repo.markRead(c, { clientId, portalUserId: me.portal_user_id, dossierId: dossier && dossier.dossier_id, at: m.created_at });
    return m;
  });

  await emitEvent(c, {
    eventTypeKey: "portal.client_message", moduleKey: MODULE, entityRef: `client_message:${row.message_id}`, actorUserId: null,
    payload: { client_id: clientId, dossier_id: dossier ? dossier.dossier_id : null, kind: stored ? stored.kind : location ? "LOCATION" : "TEXT" },
  });
  await alertTeam(c, { clientId, dossier, row, kind: stored ? stored.kind : location ? "LOCATION" : "TEXT", who: me.full_name || me.email || null });

  const [saved] = await repo.messages(c, { clientId, dossierId: dossier && dossier.dossier_id, limit: 1 });
  return messageView(saved && saved.message_id === row.message_id ? saved : { ...row, dossier_ref: dossier && dossier.ref }, { me, lang });
}

/** Bytes of one attachment the client may see. `preview` serves the 1024px copy of a photo. */
async function clientAttachment(c, { clientId, scope, attachmentId, size = null }) {
  const a = await repo.attachment(c, { attachmentId, clientId });
  if (!a || (a.dossier_id && !canShipments(scope))) throw new AppError("NOT_FOUND", "Attachment not found", 404);
  return attachmentBytes(a, size);
}

/* ── staff ──────────────────────────────────────────────────────────────── */

const staffThreads = (c, { clientId }) => repo.staffThreads(c, { clientId });

async function staffDossier(c, { clientId, thread }) {
  if (!thread || thread === "general") return null;
  const dossier = await repo.clientDossier(c, { clientId, dossierId: thread });
  if (!dossier) throw new AppError("NOT_FOUND", "No such file for this client", 404);
  return dossier;
}

async function staffMessages(c, { clientId, thread, before = null }) {
  const dossier = await staffDossier(c, { clientId, thread });
  const rows = await repo.messages(c, { clientId, dossierId: dossier && dossier.dossier_id, before, limit: PAGE, clientView: false });
  return {
    thread: repo.threadKey(dossier && dossier.dossier_id),
    dossier_ref: dossier ? dossier.ref : null,
    has_more: rows.length === PAGE,
    messages: rows.map((r) => messageView(r)),
  };
}

/** The team has read a thread — the client's messages in it show "seen". */
async function staffRead(c, { clientId, thread }) {
  const dossier = await staffDossier(c, { clientId, thread });
  return { marked: await repo.markStaffRead(c, { clientId, dossierId: dossier && dossier.dossier_id }) };
}

/** A reply from the team, with a file or not. */
async function staffSend(c, { clientId, thread, body = "", milestoneId = null, file = null, meta = {}, location = null, actor = {}, slug }) {
  assertNotEmpty({ body, file, location });
  const dossier = await staffDossier(c, { clientId, thread });
  const stage = await namedStage(c, { dossier, milestoneId });
  const stored = file ? await storeAttachment(c, { clientId, file, meta, status: "VERIFIED", slug, actor }) : null;
  const row = await atomically(c, async () => {
    const m = await repo.insertMessage(c, {
      clientId, dossierId: dossier && dossier.dossier_id, direction: "STAFF", body: clean(body),
      authorUserId: await resolveActorId(c, actor.user_id), milestoneId: stage && stage.milestone_instance_id, location,
    });
    if (stored) await repo.insertAttachment(c, { messageId: m.message_id, ...stored });
    // Answering a thread is reading it.
    await repo.markStaffRead(c, { clientId, dossierId: dossier && dossier.dossier_id });
    return m;
  });
  await emitEvent(c, {
    eventTypeKey: "portal.client_message", moduleKey: MODULE, entityRef: `client_message:${row.message_id}`, actorUserId: actor.user_id || null,
    payload: { client_id: clientId, dossier_id: dossier ? dossier.dossier_id : null, direction: "STAFF", kind: stored ? stored.kind : location ? "LOCATION" : "TEXT" },
  });
  const [saved] = await repo.messages(c, { clientId, dossierId: dossier && dossier.dossier_id, limit: 1, clientView: false });
  return messageView(saved && saved.message_id === row.message_id ? saved : { ...row, dossier_ref: dossier && dossier.ref });
}

async function staffAttachment(c, { attachmentId, size = null }) {
  const a = await repo.attachment(c, { attachmentId });
  if (!a) throw new AppError("NOT_FOUND", "Attachment not found", 404);
  return attachmentBytes(a, size);
}

/* ── shared ─────────────────────────────────────────────────────────────── */

/**
 * The bytes, and whether a browser may show them inline. A photo in a bubble
 * is the 1024px WebP the vault made at upload (regenerated if missing), not
 * the 2600px master: a thread of twenty photos on a phone is 2 MB, not 20.
 */
async function attachmentBytes(a, size) {
  const name = a.file_name || a.original_name || "attachment";
  if (a.kind === "IMAGE" && size === "preview") {
    try {
      const key = imagePipeline.derivativeKey(a.storage_path, "preview", "webp");
      const buffer = await storage.get(key).catch(() => null);
      if (buffer && buffer.length) return { buffer, name, type: "image/webp", inline: true };
      const made = await imagePipeline.ensureDerivative(key, { profile: "document" });
      if (made) return { buffer: made.buffer, name, type: made.contentType, inline: true };
    } catch (err) {
      // A missing preview is a slower bubble, not a missing photo.
      logger.warn({ err, attachmentId: a.attachment_id }, "chat preview fell back to the master");
    }
  }
  const buffer = await storage.get(a.storage_path);
  return {
    buffer,
    name,
    type: a.mime_type || "application/octet-stream",
    // Photos and voice notes play in the conversation; a PDF downloads.
    inline: a.kind === "IMAGE" || a.kind === "VOICE",
  };
}

/**
 * Tell the team a client wrote (owner decision 2/12):
 *
 *   · the client's account manager and — for a shipment's conversation — the
 *     file's operations and sales owners;
 *   · when none of those can be reached (General with no account manager, a
 *     file nobody owns, or owners who have left), the people who answer the
 *     Client inbox, operations among them (MOD-64C);
 *   · the MD, always.
 *
 * One alert per person per thread per minute: a client typing five short
 * lines is one ping, not five. The link opens the conversation in the inbox.
 */
async function alertTeam(c, { clientId, dossier, row, kind, who = null }) {
  try {
    const audience = await repo.staffAudience(c, { clientId, dossier });
    let ids = [...audience.manager, ...audience.owners, ...audience.md];
    if (!audience.manager.length && !audience.owners.length) {
      ids = ids.concat(await notificationRepo.recipientsWithPermission(c, INBOX_MODULE, "edit"));
    }
    ids = [...new Set(ids.filter(Boolean))];
    if (!ids.length) return;
    const { rows } = await c.query("SELECT COALESCE(name, legal_name) AS name FROM client_master WHERE client_id = $1", [clientId]);
    const company = (rows[0] && rows[0].name) || "A client";
    const thread = repo.threadKey(dossier && dossier.dossier_id);
    // "Paul Atiock: Is the container out?" — which colleague at the client
    // wrote, not only which company.
    const line = previewOf(row) || KIND_LINE[kind] || KIND_LINE.TEXT;
    const body = who ? `${who}: ${line}` : line;
    for (const userId of ids) {
      // One notify per person: each carries its own one-a-minute claim.
      await notifications.notify(c, {
        userId,
        eventTypeKey: "client_message.received",
        category: "comms",
        title: dossier ? `${company} · ${dossier.ref}` : company,
        body,
        entityRef: `client_message:${row.message_id}`,
        url: `/comms/clients?client=${clientId}&thread=${thread}`,
        dedupeKey: `chat:${clientId}:${thread}:${userId}`,
        pushTag: `chat:${clientId}:${thread}`,
        renotify: true,
      });
    }
  } catch (err) {
    // The message is saved and visible in the ERP; a failed ping must not
    // turn the client's send into an error they retry.
    logger.warn({ err, clientId }, "client chat: team alert failed");
  }
}

/* ── the Client inbox (PR 3) ───────────────────────────────────────────── */

const INBOX_FILTERS = ["all", "waiting", "mine"];
/** How many conversations the inbox reads — waiting ones first, so they are the last to be cut. */
const INBOX_LIMIT = 300;

/**
 * Every client conversation the team has, those waiting for an answer first;
 * or only those waiting, or only mine — clients I look after and files I own.
 * The counts for all three come with any of them, for the filter chips.
 * `truncated` says the read hit its limit, so the screen can say the list and
 * its counts stop there rather than present them as everything.
 */
async function staffInbox(c, { filter = "all", actor = {} }) {
  const f = INBOX_FILTERS.includes(filter) ? filter : "all";
  const me = actor.user_id || null;
  const rows = await repo.inbox(c, { limit: INBOX_LIMIT });
  const all = rows.map((r) => ({
    client_id: r.client_id,
    client_name: r.client_name,
    thread: repo.threadKey(r.dossier_id),
    dossier_id: r.dossier_id || null,
    dossier_ref: r.dossier_ref || null,
    unread: Number(r.unread || 0),
    waiting_since: r.waiting_since || null,
    last: {
      direction: r.direction,
      preview: previewOf(r),
      kind: contentKind(r),
      at: r.created_at,
      // The colleague at the client who wrote it; the controller adds the name.
      author:
        r.direction === "CLIENT"
          ? { name: null, email: r.author_email || null, portal_user_id: r.portal_user_id || null }
          : null,
    },
    manager: r.manager_user_id ? { user_id: r.manager_user_id, name: r.manager_name || null } : null,
    mine: !!me && (r.manager_user_id === me || r.owner_ops_id === me || r.owner_sales_id === me),
  }));
  const keep = { all: () => true, waiting: (i) => i.unread > 0, mine: (i) => i.mine };
  return {
    filter: f,
    counts: { all: all.length, waiting: all.filter(keep.waiting).length, mine: all.filter(keep.mine).length },
    items: all.filter(keep[f]),
    truncated: rows.length >= INBOX_LIMIT,
  };
}

/** A notification's line when the message has no words. */
const KIND_LINE = {
  TEXT: "New message",
  IMAGE: "Sent a photo",
  FILE: "Sent a file",
  VOICE: "Sent a voice note",
  LOCATION: "Shared a location",
};

module.exports = {
  threads, unread, messages, read, send, clientAttachment,
  staffThreads, staffMessages, staffRead, staffSend, staffAttachment, staffInbox,
  sniffAudio, PAGE, INBOX_MODULE,
};
