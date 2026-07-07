"use strict";
async function safe(client, sql, params) { try { const { rows } = await client.query(sql, params); return rows; } catch { return []; } }
const approvals = (c, roleIds = []) => safe(c, "SELECT * FROM approval_task WHERE status='PENDING' ORDER BY created_at DESC LIMIT 50");
const recentEvents = (c) => safe(c, "SELECT * FROM event_log ORDER BY created_at DESC LIMIT 50");
const unread = (c, userId) => safe(c, "SELECT * FROM notification WHERE user_id=$1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 50", [userId]);
module.exports = { approvals, recentEvents, unread };
