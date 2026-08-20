/**
 * The three PR-5 controls that run on every message, at the one place a message
 * enters or leaves the system.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * `antispoof.js`, `archive-chain.js` and `bounce-parse.js` shipped correct,
 * unit-tested and CALLED BY NOTHING. `email_archive`, `party_verified_domain`
 * and `email_bounce` were created by migrations 10760–10762 and then read and
 * written by zero lines of application code, so `GET /mail/archive/verify`
 * walked an empty table and answered `{ ok: true }` for a mailbox that had
 * never archived anything, no message ever carried an `auth_verdict`, and a
 * bounce arrived as ordinary mail. Every unit test passed throughout, because
 * every one of them called the pure function directly.
 *
 * Collecting the three into one hook, called from one place, is deliberate:
 * a single call site is a single thing a wiring test can assert on, and a
 * single thing a future edit to the sync loop can be checked against.
 * `tests/security/mail-ingest-hooks-wiring.test.js` does exactly that.
 *
 * ── FAILURE POLICY ──────────────────────────────────────────────────────────
 *
 * Archiving is the one hook that must NOT be swallowed: an un-archived message
 * is a gap in a hash chain we tell auditors is complete, so it fails the ingest
 * of that message and the per-folder isolation in the sync loop records it. The
 * verdict and DSN hooks are advisory enrichment — a message that arrives with
 * no verdict is worse than one with, but very much better than a mailbox that
 * stops syncing — so they are caught and logged.
 */
"use strict";

const antispoof = require("./antispoof");
const archive = require("./archive-chain");
const bounce = require("./bounce-parse");
const { logger } = require("../../../config/logger");

/* ── Anti-spoofing (§9.7) ─────────────────────────────────────────────────── */

/**
 * The domains we may trust for this message's thread.
 *
 * `ADMIN_VERIFIED` only. `OBSERVED` rows accrue from correspondence history and
 * §9.7 is explicit that they "never confer VERIFIED on their own — that
 * requires a human, in the UI, once". Feeding OBSERVED in here would let an
 * attacker who mails us twice verify themselves.
 */
async function verifiedDomainsFor(client, entityRef) {
  if (!entityRef) return [];
  const m = /^(client|supplier):(.+)$/.exec(String(entityRef));
  if (!m) return [];
  const { rows } = await client.query(
    `SELECT domain::text AS domain FROM party_verified_domain
      WHERE party_kind = $1 AND party_id = $2 AND source = 'ADMIN_VERIFIED'`,
    [m[1].toUpperCase(), m[2]],
  );
  return rows.map((r) => r.domain);
}

/**
 * Record that we have seen this domain corresponding as this party.
 *
 * Upserted as `OBSERVED` with a message counter, which is what makes the
 * "mark this domain as belonging to <party>" affordance in the UNVERIFIED
 * banner a one-click action rather than a typing exercise. It confers nothing.
 */
async function observeDomain(client, entityRef, fromAddress) {
  const m = /^(client|supplier):(.+)$/.exec(String(entityRef || ""));
  const domain = String(fromAddress || "").toLowerCase().split("@")[1];
  if (!m || !domain) return;
  await client.query(
    `INSERT INTO party_verified_domain (party_kind, party_id, domain, source, message_count)
     VALUES ($1, $2, $3, 'OBSERVED', 1)
     ON CONFLICT (party_kind, party_id, domain)
       DO UPDATE SET message_count = party_verified_domain.message_count + 1`,
    [m[1].toUpperCase(), m[2], domain],
  );
}

async function stampVerdict(client, { messageId, threadId, message }) {
  const { rows } = await client.query(
    `SELECT entity_ref FROM email_thread WHERE email_thread_id = $1`,
    [threadId],
  );
  const entityRef = rows[0] && rows[0].entity_ref;
  const verifiedDomains = await verifiedDomainsFor(client, entityRef);

  // Lookalike detection needs the whole corpus of party domains, not just this
  // thread's — the attack is a domain that resembles a party we know, and the
  // thread it arrives on is typically bound to nothing at all.
  const { rows: allKnown } = await client.query(
    `SELECT DISTINCT domain::text AS domain FROM party_verified_domain WHERE source = 'ADMIN_VERIFIED'`,
  );
  const { rows: parties } = await client.query(
    `SELECT name FROM client_master WHERE is_active
      UNION ALL SELECT name FROM supplier_master WHERE is_active`,
  ).catch(() => ({ rows: [] }));

  const { verdict, detail } = antispoof.evaluate(message, {
    parties,
    verifiedDomains: verifiedDomains.length ? verifiedDomains : allKnown.map((r) => r.domain),
  });

  await client.query(
    `UPDATE email_message SET auth_verdict = $2, auth_detail = $3::jsonb WHERE email_message_id = $1`,
    [messageId, verdict, JSON.stringify(detail || {})],
  );
  await observeDomain(client, entityRef, message.from_address);
  return { verdict, detail };
}

/* ── Immutable archive (§9.6) ─────────────────────────────────────────────── */

/**
 * Append one message to the hash chain.
 *
 * Serialised on the tail row with `FOR UPDATE`: two messages archived
 * concurrently that both read the same `prev_hash` produce two rows claiming
 * the same predecessor, and `verify()` walks straight into the second one and
 * reports a break in a chain that was never actually tampered with. A lock on
 * the tail is cheap — archiving happens once per message, on ingest or send,
 * never in a loop over history.
 */
async function appendToArchive(client, { messageId, message }) {
  const { rows: prev } = await client.query(
    `SELECT chain_hash FROM email_archive ORDER BY seq DESC LIMIT 1 FOR UPDATE`,
  );
  const entry = archive.append(prev[0] || null, {
    headers: {
      message_id: message.message_id_header || null,
      from: message.from_address || null,
      to: message.to_address || [],
      subject: message.subject || null,
      date: message.received_at || null,
    },
    body: `${message.body_html || ""}\n${message.body_text || ""}`,
    attachments: message.attachment_hashes || [],
  });
  await client.query(
    `INSERT INTO email_archive (email_message_id, content_hash, prev_hash, chain_hash, attachment_hashes)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email_message_id) DO NOTHING`,
    [messageId, entry.content_hash, entry.prev_hash, entry.chain_hash, entry.attachment_hashes],
  );
  return entry;
}

/* ── Bounce / DSN (§9.8) ──────────────────────────────────────────────────── */

/**
 * A delivery-status report is not mail — it is the answer to mail we sent.
 *
 * Returns null for anything that is not a DSN, so the caller can treat "this
 * was a bounce" as a truthy result rather than having to sniff content types
 * in the sync loop.
 */
async function recordBounce(client, { message }) {
  const dsn = bounce.parseDsn({
    contentType: message.content_type || (message.headers && message.headers["content-type"]) || "",
    body: message.body_text || "",
    headers: message.headers || {},
  });
  if (!dsn || !dsn.recipient) return null;

  const original = dsn.original_message_id_header
    ? await client.query(
      `SELECT email_message_id FROM email_message WHERE message_id_header = $1 LIMIT 1`,
      [dsn.original_message_id_header],
    ).then((r) => r.rows[0] || null)
    : null;

  await client.query(
    `INSERT INTO email_bounce (original_message_id, original_message_id_header, recipient,
                               bounce_type, status_code, diagnostic)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      original && original.email_message_id, dsn.original_message_id_header,
      dsn.recipient, dsn.bounce_type, dsn.status_code, dsn.diagnostic,
    ],
  );

  // A hard bounce is a fact about the ADDRESS, not about this send, so it is
  // recorded on the contact — that is what lets the composer warn before the
  // next attempt and ends the "we emailed the invoice three times" failure.
  // A soft bounce must never downgrade an address already known hard-failed.
  const status = dsn.bounce_type === "HARD" ? "HARD_FAILED"
    : dsn.bounce_type === "SOFT" ? "SOFT_FAILING" : null;
  if (status) {
    for (const table of ["client_contact", "supplier_contact"]) {
      await client.query(
        `UPDATE ${table} SET email_status = $2
          WHERE lower(email) = lower($1)
            AND NOT (email_status = 'HARD_FAILED' AND $2 = 'SOFT_FAILING')`,
        [dsn.recipient, status],
      ).catch(() => { /* @silent:storage a tenant without this table still gets the bounce row */ });
    }
  }
  return { ...dsn, original_message_id: original && original.email_message_id };
}

/* ── The one hook the ingest loop calls ───────────────────────────────────── */

/**
 * @param {object} client   tenant db client, inside the ingest transaction
 * @param {object} row      the inserted email_message row (+ thread_id)
 * @param {object} opts.raw the provider message, for headers the row does not keep
 */
async function onMessageIngested(client, row, { raw = {}, attachmentHashes = [] } = {}) {
  const message = {
    from_address: row.from_address,
    from_name: row.from_name,
    to_address: row.to_address,
    subject: row.subject,
    body_text: row.body_text,
    body_html: row.body_html,
    message_id_header: row.message_id_header,
    received_at: row.received_at,
    headers: raw.headers || {},
    content_type: raw.contentType || (raw.headers && raw.headers["content-type"]) || "",
    auth: raw.auth || {},
    attachment_hashes: attachmentHashes,
  };

  // Archive first, and let it throw. Everything after this point is enrichment;
  // the chain is the record.
  await appendToArchive(client, { messageId: row.email_message_id, message });

  const out = { archived: true, verdict: null, bounce: null };

  if (row.direction !== "OUT") {
    try {
      out.bounce = await recordBounce(client, { message });
    } catch (err) {
      logger.warn({ err, id: row.email_message_id }, "[mail] DSN parse skipped");
    }
    try {
      const v = await stampVerdict(client, {
        messageId: row.email_message_id, threadId: row.thread_id, message,
      });
      out.verdict = v.verdict;
    } catch (err) {
      logger.warn({ err, id: row.email_message_id }, "[mail] anti-spoof verdict skipped");
    }
  }
  return out;
}

/** Outbound messages are archived too (§9.6: "every message, in and out"). */
async function onMessageSent(client, row, { attachmentHashes = [] } = {}) {
  return appendToArchive(client, {
    messageId: row.email_message_id,
    message: { ...row, attachment_hashes: attachmentHashes },
  });
}

module.exports = {
  onMessageIngested, onMessageSent,
  appendToArchive, stampVerdict, recordBounce, verifiedDomainsFor, observeDomain,
};
