/**
 * ONE predicate. Used by list, get, search, timeline, context, AI grounding
 * and export. A second copy of this rule is a leak.
 */
"use strict";

const SQL = `
(  t.visibility = 'COMPANY'
OR (t.visibility = 'TEAM'    AND EXISTS (SELECT 1 FROM email_connection_member m
                                          WHERE m.email_connection_id = t.email_connection_id
                                            AND m.user_id = $USER
                                            AND m.revoked_at IS NULL))
OR (t.visibility = 'PRIVATE' AND (c.owner_user_id = $USER
                                  OR EXISTS (SELECT 1 FROM email_thread_share s
                                              WHERE s.email_thread_id = t.email_thread_id
                                                AND s.user_id = $USER))))
`;

function clause(userParam) {
  return SQL.replace(/\$USER/g, userParam);
}

function canSee(thread, { userId: _userId, isOwner, isMember, isShared, isGodMode }) {
  if (isGodMode) return { ok: true, breakglass: thread.visibility === "PRIVATE" && !isOwner && !isShared };
  if (thread.visibility === "COMPANY") return { ok: true };
  if (thread.visibility === "TEAM") return { ok: Boolean(isMember) };
  return { ok: Boolean(isOwner || isShared) };
}

module.exports = { clause, canSee, SQL };
