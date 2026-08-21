/**
 * Secure ephemeral links (§9.4) — minting, listing, revoking, and SERVING.
 *
 * ── WHAT WAS MISSING ────────────────────────────────────────────────────────
 *
 * `GET /public/secure/:token` returned `{ label, target_kind, expires_at }`.
 * It never returned the document. It never wrote `secure_link_view`, so the IP
 * and user-agent columns migration 10758 created were dead, `view_count`
 * incremented with nothing behind it, and nothing reached the CRM timeline.
 *
 * That last part is the one that matters commercially. §9.4: link views are
 * "the ONLY open signal in the product, and it is precise, first-party and
 * unaffected by image blocking. It is the reason Q32's answer costs you nothing
 * commercially." Q32 removed open tracking on the strength of this existing.
 *
 * ── THE TOKEN IS NEVER STORED ───────────────────────────────────────────────
 *
 * Only its SHA-256. A lookup hashes the presented token and matches on the
 * hash, so a dump of `secure_link` yields nothing usable — the same discipline
 * `proposal.share()` already proved, which is what §9.4 says to model this on.
 */
"use strict";

const { AppError } = require("../../../utils/errors");
const { emitEvent } = require("../../../shared/events/emit");
const { logger } = require("../../../config/logger");
const token = require("./secure-link");

/* ── Minting and administration ───────────────────────────────────────────── */

async function mint(client, { targetKind, targetRef, entityRef = null, label = null, days = 7 }, actor = {}) {
  const raw = token.mintToken();
  const { rows } = await client.query(
    `INSERT INTO secure_link (token_hash, target_kind, target_ref, entity_ref, label, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval)
     RETURNING *`,
    [token.hashToken(raw), targetKind, targetRef, entityRef, label, actor.user_id || null, days],
  );
  // The only moment the plaintext token exists. It is returned once and never
  // recoverable — a "resend the link" flow mints a new one.
  return { ...rows[0], token: raw, path: `/public/secure/${raw}` };
}

const list = (client, { entityRef = null, includeExpired = false } = {}) =>
  client.query(
    `SELECT l.secure_link_id, l.target_kind, l.target_ref, l.entity_ref, l.label,
            l.created_by, l.created_at, l.expires_at, l.revoked_at,
            l.first_viewed_at, l.view_count,
            u.full_name AS created_by_name,
            (l.revoked_at IS NULL AND l.expires_at > now()) AS is_live
       FROM secure_link l
       LEFT JOIN app_user u ON u.user_id = l.created_by
      WHERE ($1::text IS NULL OR l.entity_ref = $1)
        AND ($2::boolean OR (l.revoked_at IS NULL AND l.expires_at > now()))
      ORDER BY l.created_at DESC
      LIMIT 200`,
    [entityRef, includeExpired === true],
  ).then((r) => r.rows);

/**
 * Who opened it, when, and from where.
 *
 * The audit trail §9.4 asks for, and the reason a link is safe to send: an
 * operator can answer "did they get it?" without a read receipt and without
 * guessing from an image pixel that most clients block anyway.
 */
const views = (client, secureLinkId) =>
  client.query(
    `SELECT viewed_at, ip::text AS ip, user_agent
       FROM secure_link_view WHERE secure_link_id = $1
      ORDER BY viewed_at DESC LIMIT 200`,
    [secureLinkId],
  ).then((r) => r.rows);

const revoke = (client, id) =>
  client.query(
    `UPDATE secure_link SET revoked_at = now() WHERE secure_link_id = $1 AND revoked_at IS NULL
     RETURNING *`,
    [id],
  ).then((r) => r.rows[0] || null);

/* ── Serving ──────────────────────────────────────────────────────────────── */

/**
 * Resolve a presented token to the row, or refuse.
 *
 * Expiry and revocation both answer 404 rather than 410 or 403, deliberately:
 * an unauthenticated caller learning the difference between "never existed",
 * "expired" and "revoked" is being told whether a document was ever there. The
 * message is the same in all three cases for the same reason.
 */
async function resolve(client, presented) {
  const row = await client.query(
    `SELECT * FROM secure_link WHERE token_hash = $1`,
    [token.hashToken(presented)],
  ).then((r) => r.rows[0] || null);

  if (!token.isUsable(row)) {
    throw new AppError("NOT_FOUND", "This link has expired or been revoked.", 404);
  }
  return row;
}

/**
 * Record the view, then hand back the document.
 *
 * The view row is written BEFORE the bytes are served, so a download that dies
 * mid-transfer still counts as an open — the interesting signal is that the
 * recipient reached it, not that they finished reading. `first_viewed_at` uses
 * COALESCE so it keeps the FIRST open rather than tracking the latest.
 */
async function open(client, row, { ip = null, userAgent = null } = {}) {
  await client.query(
    `INSERT INTO secure_link_view (secure_link_id, ip, user_agent) VALUES ($1, $2::inet, $3)`,
    [row.secure_link_id, ip || null, (userAgent || "").slice(0, 500) || null],
  ).catch((err) => logger.debug({ err }, "[mail] secure link view not recorded"));

  await client.query(
    `UPDATE secure_link
        SET view_count = view_count + 1,
            first_viewed_at = COALESCE(first_viewed_at, now())
      WHERE secure_link_id = $1`,
    [row.secure_link_id],
  );

  // The CRM timeline entry — §9.4's "only open signal in the product". Emitted
  // rather than written directly so it lands on the client's timeline through
  // the same path every other interaction does.
  if (row.entity_ref) {
    await emitEvent(client, {
      eventTypeKey: "mail.secure_link.viewed",
      moduleKey: "MOD-72",
      entityRef: row.entity_ref,
      actorUserId: null,
      payload: {
        secure_link_id: row.secure_link_id,
        label: row.label,
        target_kind: row.target_kind,
        // No IP on the timeline. The operator needs to know it was opened, not
        // where the recipient was sitting.
        view_count: row.view_count + 1,
      },
    }).catch(() => { /* @silent:storage the view row is the record */ });
  }

  return fetchTarget(client, row);
}

/**
 * The bytes.
 *
 * VAULT_DOC resolves through the vault service so its own permissions, storage
 * backend and retention apply — a secure link is a delegation of the sender's
 * access, not a second way into storage.
 */
async function fetchTarget(client, row) {
  if (row.target_kind === "VAULT_DOC") {
    const vault = require("../../vault/document_vault/document_vault.service");
    // `fetchBytes` refuses a document that is not rendered yet (409) and throws
    // 404 for one that does not exist. Both are re-thrown as the same opaque
    // 404 by the caller, so an anonymous viewer cannot probe.
    const { doc, buffer } = await vault.fetchBytes(client, row.target_ref);
    return {
      kind: "VAULT_DOC",
      filename: doc.original_name || doc.filename || row.label || "document",
      content_type: doc.content_type || "application/octet-stream",
      size_bytes: doc.size_bytes || (buffer && buffer.length) || null,
      buffer,
      doc_id: doc.doc_id,
    };
  }
  if (row.target_kind === "GENERATED_PDF") {
    // Generated documents are re-rendered on demand rather than stored, so the
    // link stays valid across a re-issue of the underlying record.
    return { kind: "GENERATED_PDF", target_ref: row.target_ref, label: row.label };
  }
  throw new AppError("NOT_FOUND", "This link has expired or been revoked.", 404);
}

module.exports = { mint, list, views, revoke, resolve, open, fetchTarget };
