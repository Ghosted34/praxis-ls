/**
 * Auditor data room (PRD §5.2) — the auditor asks, staff answers with vault
 * documents, the auditor downloads.
 *
 * Two audiences, one room table:
 *   · AUDITOR (portal token + AUDITOR grant): list/create their own rooms and
 *     download attached documents. Every query is scoped by subject_email —
 *     the same identity the grant is keyed on — so one auditor can never see
 *     another's room, and an expired/revoked grant (enforced by portalAuth)
 *     cuts the room off too.
 *   · STAFF (MOD-67): list every room, attach vault documents, mark answered.
 *
 * Documents are shared by vault doc_id and streamed through vault.fetchBytes
 * after the room ownership check — the vault's content-hash/QR guarantees
 * apply to shared evidence exactly as they do to any other stored file.
 */
"use strict";

const repo = require("./audit_room.repo");
const vault = require("../vault/document_vault/document_vault.service");
const { audit } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");

const MODULE = "MOD-67";
const ref = (id) => "auditor_data_room:" + id;

// ── Auditor side ─────────────────────────────────────────────────────────────

const listForAuditor = (client, { email }) => repo.listForEmail(client, email);

async function createRequest(client, { email, note }) {
  const row = await repo.insert(client, { subjectEmail: email, requestNote: note });
  await audit(client, {
    actorUserId: null, action: "audit_room.requested", moduleKey: MODULE,
    entityRef: ref(row.room_id), after: { note },
  });
  return row;
}

/** A room, but only when it belongs to this auditor. */
async function detailForAuditor(client, { email, roomId }) {
  const room = await repo.get(client, roomId);
  if (!room || room.subject_email !== email) {
    throw new AppError("NOT_FOUND", "No such data room request", 404);
  }
  return { room, docs: await repo.docs(client, roomId) };
}

/** Download an attached document — ownership of the room re-checked in SQL. */
async function downloadDoc(client, { email, roomId, docId }) {
  const { docs } = await detailForAuditor(client, { email, roomId });
  if (!docs.some((d) => d.doc_id === docId)) {
    throw new AppError("NOT_FOUND", "No such document in this data room", 404);
  }
  const out = await vault.fetchBytes(client, docId);
  return { doc: out.doc, buffer: out.buffer };
}

// ── Staff side ───────────────────────────────────────────────────────────────

const listForStaff = (client) => repo.listForStaff(client);

async function detailForStaff(client, { roomId }) {
  const room = await repo.get(client, roomId);
  if (!room) throw new AppError("NOT_FOUND", "No such data room request", 404);
  return { room, docs: await repo.docs(client, roomId) };
}

async function attach(client, { roomId, docId, actor }) {
  const room = await repo.get(client, roomId);
  if (!room) throw new AppError("NOT_FOUND", "No such data room request", 404);
  const vaultDoc = await vault.get(client, docId);
  if (!vaultDoc) throw new AppError("NOT_FOUND", "No such vault document", 404);
  if (String(vaultDoc.status).toUpperCase() !== "VERIFIED") {
    throw new AppError("DOC_NOT_VERIFIED", "Only VERIFIED documents can be shared to the data room", 422);
  }
  const linked = await repo.attachDoc(client, { roomId, docId, addedBy: actor.user_id || null });
  await audit(client, {
    actorUserId: actor.user_id || null, action: "audit_room.document_attached", moduleKey: MODULE,
    entityRef: ref(roomId), after: { doc_id: docId },
  });
  return { attached: true, already_attached: !linked, room };
}

async function answer(client, { roomId, actor }) {
  const room = await repo.get(client, roomId);
  if (!room) throw new AppError("NOT_FOUND", "No such data room request", 404);
  const row = await repo.markAnswered(client, { roomId, answeredBy: actor.user_id || null });
  if (!row) throw new AppError("ALREADY_ANSWERED", "That request is already answered", 409);
  await audit(client, {
    actorUserId: actor.user_id || null, action: "audit_room.answered", moduleKey: MODULE,
    entityRef: ref(roomId), before: { status: room.status }, after: { status: row.status },
  });
  return row;
}

module.exports = {
  listForAuditor, createRequest, detailForAuditor, downloadDoc,
  listForStaff, detailForStaff, attach, answer,
};
