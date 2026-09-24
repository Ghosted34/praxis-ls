"use strict";
const { isDeepStrictEqual } = require("node:util");
const repo = require("./smartcomm.schedule.repo");
const comms = require("./smartcomm.repo");
const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

function validateTime(data) {
  const time = Date.parse(data.send_at);
  if (!Number.isFinite(time) || time <= Date.now() || time > Date.now() + 366 * 86400000) throw new AppError("VALIDATION_ERROR", "Choose a future time within one year", 422);
  try { new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone }).format(); }
  catch { throw new AppError("VALIDATION_ERROR", "Choose a valid timezone", 422); }
}
async function member(c, groupId, userId) {
  if (!await comms.findMember(c, groupId, userId)) throw new AppError("NOT_A_MEMBER", "You are not a member of this channel", 403);
}
async function validateAttachments(c, groupId, attachments, replyTo) {
  for (const a of attachments || []) {
    // Only sendSummary writes a call card (audit C4); a schedule stored before
    // the route refused them must not post one either.
    if (a.attachment_kind === "CALL") throw new AppError("VALIDATION_ERROR", "Call summaries are shared from the call, not attached", 422);
    if (a.attachment_kind === "MEDIA") {
      if (!a.media_id || !await repo.mediaAllowed(c, a.media_id, groupId)) throw new AppError("VALIDATION_ERROR", "Media must belong to this conversation", 422);
    } else if (a.attachment_kind === "ERP") {
      if (!a.erp_id || !a.erp_kind) throw new AppError("VALIDATION_ERROR", "Record reference is incomplete", 422);
    } else if (!a.vault_id || !await repo.vaultAllowed(c, a.vault_id, groupId)) throw new AppError("VALIDATION_ERROR", "File must belong to this conversation", 422);
  }
  if (replyTo) {
    const message = await comms.getMessage(c, replyTo);
    if (!message || message.group_id !== groupId) throw new AppError("VALIDATION_ERROR", "Reply must belong to this conversation", 422);
  }
}
async function create(c, { groupId, actor, data, env }) {
  // Scheduled delivery runs in LIVE and in the sandbox Test environment. Test is
  // where tenants rehearse, so a training session that cannot schedule a message
  // cannot rehearse the one thing scheduling is for. The row is written to
  // whichever schema `withTenantConnection(meta, env)` selected, and the flush
  // scheduler fans a job out per environment (comms-send-scheduler), so a
  // sandbox schedule is delivered by a sandbox worker against sandbox data and
  // never leaks into LIVE. Any env other than these two is still refused.
  if (env !== "live" && env !== "sandbox") {
    throw new AppError("VALIDATION_ERROR", "Scheduled delivery is not available in this environment", 422);
  }
  await member(c, groupId, actor.user_id);
  // A retry after a lost response may arrive AFTER send_at. Recover its
  // original result before applying future-time validation to a new schedule.
  const existing = await repo.findRequest(c, actor.user_id, data.request_id);
  if (existing) {
    const same = existing.group_id === groupId && existing.body === (data.body || "")
      && isDeepStrictEqual(existing.attachments, data.attachments || [])
      && (existing.reply_to || null) === (data.reply_to || null)
      && Date.parse(existing.send_at) === Date.parse(data.send_at) && existing.timezone === data.timezone;
    if (!same) throw new AppError("VALIDATION_ERROR", "This request key was already used for another schedule", 422);
    return existing;
  }
  validateTime(data);
  if (!await repo.sender(c, actor.user_id, groupId)) throw new AppError("NOT_A_MEMBER", "This conversation is not available for sending", 403);
  if (!data.body?.trim() && !data.attachments?.length) throw new AppError("EMPTY_MESSAGE", "A message needs text or attachments", 422);
  await validateAttachments(c, groupId, data.attachments, data.reply_to);
  const row = await repo.insert(c, groupId, actor.user_id, data);
  if (!row) throw new AppError("VALIDATION_ERROR", "This request key was already used for another schedule", 422);
  return row;
}
async function list(c, { groupId, actor }) { await member(c, groupId, actor.user_id); return repo.list(c, groupId, actor.user_id); }
async function change(c, { id, actor, data }) {
  if (!data.cancel) validateTime(data);
  const row = await repo.change(c, id, actor.user_id, data);
  if (!row) throw new AppError("NOT_FOUND", "Pending scheduled message not found", 404);
  return row;
}
async function flush(c) {
  const rows = await repo.due(c);
  for (const row of rows) {
    try { await require("./smartcomm.service").postMessage(c, { scheduleId: row.schedule_id }); }
    catch (error) {
      const permanent = [400, 403, 404, 422].includes(error.statusCode || error.status);
      logger.warn({ err: error, scheduleId: row.schedule_id }, "[comms] scheduled send failed");
      await repo.fail(c, row.schedule_id, permanent, permanent ? "Delivery blocked: check membership, permissions and attachments." : "Delivery failed; automatic retries are limited to five attempts. Reschedule to retry a failed message.", row.update_version);
    }
  }
  return { processed: rows.length };
}
module.exports = { create, list, change, flush, validateTime, validateAttachments };
