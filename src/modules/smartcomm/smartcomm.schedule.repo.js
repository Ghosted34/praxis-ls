"use strict";
const list = async (c, groupId, userId) => (await c.query("SELECT * FROM comms_scheduled_message WHERE group_id = $1 AND sender_user_id = $2 ORDER BY send_at DESC LIMIT 100", [groupId, userId])).rows;
const findRequest = async (c, userId, requestId) => (await c.query("SELECT * FROM comms_scheduled_message WHERE sender_user_id = $1 AND request_id = $2", [userId, requestId])).rows[0];
const insert = async (c, groupId, userId, d) => (await c.query(`INSERT INTO comms_scheduled_message (request_id, group_id, sender_user_id, body, attachments, reply_to, send_at, timezone)
 VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT (sender_user_id, request_id) DO UPDATE SET request_id = EXCLUDED.request_id
 WHERE comms_scheduled_message.group_id = EXCLUDED.group_id AND comms_scheduled_message.body = EXCLUDED.body
 AND comms_scheduled_message.attachments = EXCLUDED.attachments AND COALESCE(comms_scheduled_message.reply_to::text, '') = COALESCE(EXCLUDED.reply_to::text, '')
 AND comms_scheduled_message.send_at = EXCLUDED.send_at AND comms_scheduled_message.timezone = EXCLUDED.timezone RETURNING *`, [d.request_id, groupId, userId, d.body || "", JSON.stringify(d.attachments || []), d.reply_to || null, d.send_at, d.timezone])).rows[0];
const change = async (c, id, userId, data) => (await c.query(`UPDATE comms_scheduled_message SET send_at = COALESCE($3, send_at), timezone = COALESCE($4, timezone), status = $5, attempts = 0, last_error = NULL, next_attempt_at = now(), updated_at = now()
 WHERE schedule_id = $1 AND sender_user_id = $2 AND status IN ('PENDING','FAILED') RETURNING *`, [id, userId, data.send_at || null, data.timezone || null, data.cancel ? "CANCELLED" : "PENDING"])).rows[0];
// Keep the optimistic version as PostgreSQL text: JS Date truncates the
// microseconds in now(), so round-tripping it would make retry guards miss.
const due = async (c) => (await c.query("SELECT schedule_id, updated_at::text AS update_version FROM comms_scheduled_message WHERE status = 'PENDING' AND send_at <= now() AND next_attempt_at <= now() ORDER BY send_at LIMIT 50")).rows;
const claim = async (c, id) => (await c.query("SELECT * FROM comms_scheduled_message WHERE schedule_id = $1 AND status = 'PENDING' AND send_at <= now() AND next_attempt_at <= now() FOR UPDATE SKIP LOCKED", [id])).rows[0];
const sent = (c, id, messageId) => c.query("UPDATE comms_scheduled_message SET status = 'SENT', message_id = $2, updated_at = now() WHERE schedule_id = $1", [id, messageId]);
const fail = (c, id, permanent, error, updatedAt) => c.query(`UPDATE comms_scheduled_message SET attempts = attempts + 1, status = CASE WHEN $2 OR attempts >= 4 THEN 'FAILED' ELSE 'PENDING' END,
 last_error = $3, next_attempt_at = now() + interval '1 minute' * power(2, least(attempts, 4)), updated_at = now() WHERE schedule_id = $1 AND status = 'PENDING' AND updated_at = $4`, [id, permanent, error, updatedAt]);
// Recheck ACTIVE account, current channel membership/status, and current create
// rights at delivery; scheduling never grants permanent send permission.
const sender = async (c, id, groupId) => (await c.query(`SELECT u.user_id, u.full_name FROM app_user u
 JOIN comms_member m ON m.user_id = u.user_id AND m.group_id = $2
 JOIN comms_group g ON g.group_id = m.group_id AND g.status = 'ACTIVE'
 WHERE u.user_id = $1 AND u.status = 'ACTIVE' AND EXISTS (
 SELECT 1 FROM user_role ur JOIN role r ON r.role_id = ur.role_id
 LEFT JOIN permission p ON p.role_id = r.role_id AND p.module_key = 'MOD-64'
 WHERE ur.user_id = u.user_id AND (r.code = 'CEO' OR p.can_create = true))`, [id, groupId])).rows[0];
const mediaAllowed = async (c, id, groupId) => (await c.query("SELECT media_id FROM comms_media WHERE media_id = $1 AND group_id = $2", [id, groupId])).rowCount > 0;
const vaultAllowed = async (c, id, groupId) => (await c.query("SELECT doc_id FROM document_vault WHERE doc_id = $1 AND entity_ref = $2", [id, `comms_group:${groupId}`])).rowCount > 0;
module.exports = { list, findRequest, insert, change, due, claim, sent, fail, sender, mediaAllowed, vaultAllowed };
