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

module.exports = { identityFor };
