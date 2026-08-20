"use strict";

const { AppError } = require("../../../utils/errors");

async function preview(client, threadId, target) {
  const { rows } = await client.query(
    `SELECT t.subject, t.participants::text[] AS participants, t.entity_ref
       FROM email_thread t WHERE t.email_thread_id = $1`,
    [threadId],
  );
  const t = rows[0];
  if (!t) throw new AppError("NOT_FOUND", "thread not found", 404);
  const email = Array.isArray(t.participants) ? t.participants[0] : null;
  let duplicates = [];
  if (target === "lead" && email) {
    duplicates = await client.query(
      `SELECT lead_id, company_name, created_at FROM lead WHERE lower(email) = lower($1) LIMIT 5`,
      [email],
    ).then((r) => r.rows).catch(() => []);
  }
  return {
    target,
    prefill: { email, subject: t.subject, entity_ref: t.entity_ref },
    duplicates,
    hint: duplicates.length
      ? "A record with this email already exists — attach this email to it rather than creating a duplicate."
      : null,
  };
}

module.exports = { preview };
