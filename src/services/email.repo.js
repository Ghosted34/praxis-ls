/**
 * Email-identity reader (SQL for the email service). Resolves the verified
 * sending identity for a purpose from the `email_identity` table (per-purpose
 * senders with their own From address/domain + SMTP host; SPF/DKIM/DMARC flags).
 * Prefers an active identity that matches the purpose; else the active fallback.
 */
"use strict";

async function identityFor(client, purpose) {
  const { rows } = await client.query(
    "SELECT * FROM email_identity WHERE is_active = true AND (purpose = $1 OR is_fallback = true) " +
      "ORDER BY (purpose = $1) DESC, is_fallback ASC LIMIT 1",
    [purpose],
  );
  return rows[0] || null;
}

/**
 * Append one row to email_send_log (the outbound send ledger surfaced by the
 * Mail → Send log view). Called by email.service.send on every attempt — a
 * SENT row with the provider message-id on success, a FAILED row with the error
 * on failure. `status` is constrained by the table CHECK; the audit trail /
 * deliverability history lives here. Best-effort: a failed log write must never
 * take down the send itself (caller wraps in try/catch).
 */
async function recordSend(client, { email_identity_id, to_address, subject, entity_ref, document_vault_id, status, provider_message_id, error }) {
  const { rows } = await client.query(
    "INSERT INTO email_send_log (email_identity_id, to_address, subject, entity_ref, document_vault_id, status, provider_message_id, error, sent_at) " +
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now()) RETURNING email_send_id",
    [
      email_identity_id || null,
      String(to_address || "").slice(0, 320),
      subject ? String(subject).slice(0, 1000) : null,
      entity_ref || null,
      document_vault_id || null,
      status || "SENT",
      provider_message_id ? String(provider_message_id).slice(0, 500) : null,
      error ? String(error).slice(0, 2000) : null,
    ],
  );
  return rows[0] || null;
}

/** The sender BOUND to an ERP section (WS-E3), if any. This is the override that
 *  makes a tenant-created section actually resolve — it wins over the legacy
 *  purpose-label match in resolveMail. */
async function identityForSection(client, section) {
  if (!section) return null;
  const { rows } = await client.query(
    "SELECT i.* FROM email_section_binding b JOIN email_identity i ON i.email_identity_id = b.email_identity_id " +
      "WHERE b.section_key = $1 AND i.is_active = true AND i.archived_at IS NULL LIMIT 1",
    [section],
  );
  return rows[0] || null;
}

module.exports = { identityFor, identityForSection, recordSend };
