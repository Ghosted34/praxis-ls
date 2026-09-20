"use strict";

/**
 * SQL for the link-preview cache (`comms_link_preview`, migration 13990).
 *
 * Every statement here is keyed on the sha256 of a canonical URL, because that is
 * the only identity a preview has — see the migration header for why it is not
 * keyed on a message.
 *
 * ── WHY A READ IS ALLOWED TO WRITE HERE ─────────────────────────────────────
 *
 * `touchSeen` and `markStale` run on the thread-read path. Both are the reason a
 * preview stays cheap and current rather than a snapshot nobody refreshes, and
 * both are safe to lose: no reader's screen depends on either row, and neither is
 * inside the message's transaction (the thread is read AFTER the messages are
 * already committed and returned, and the write is best-effort by contract — the
 * caller swallows a failure, because a link card that is one page-view stale is a
 * worse outcome than refusing to render the thread the reader asked for).
 *
 * ── WHY `putResult` NEVER CLEARS A GOOD CARD ────────────────────────────────
 *
 * The COALESCEs below are the whole "last-known-good" rule from the migration: a
 * refresh that fails, or that comes back with a page whose title has been replaced
 * by a "Session expired" notice, must not erase the card that was right yesterday.
 * `state` and the timestamps do update — the row must be honest about the fetch
 * that just happened — and `stale_at` clears either way, because the refresh WAS
 * attempted, and re-attempting it on every page view of a dead host is the
 * behaviour this row exists to prevent.
 */

const crypto = require("node:crypto");

/** The cache key. One function so a writer and a reader can never disagree about
 *  what "the same URL" means — a disagreement there is a silent second row per
 *  URL and a preview that never lands. */
const hashUrl = (canonicalUrl) =>
  crypto.createHash("sha256").update(String(canonicalUrl)).digest("hex");

/** Rows for a page of messages, in one round trip. `last_seen_at` is bumped in
 *  the same statement rather than a second one, because a read that only looked
 *  at a card is still a read that kept the card alive. */
async function findMany(client, canonicalUrls) {
  const urls = [...new Set((canonicalUrls || []).filter(Boolean))].slice(0, 200);
  if (!urls.length) return [];
  const hashes = urls.map(hashUrl);
  const { rows } = await client.query(
    `UPDATE comms_link_preview
        SET last_seen_at = now(), updated_at = now()
      WHERE url_hash = ANY($1::text[])
      RETURNING url, url_hash, state, title, description, site_name,
                image_url, image_width, image_height, icon_url,
                media_kind, media_id, duration_seconds, author_name,
                fetched_at, last_ok_at, stale_at`,
    [hashes],
  );
  return rows;
}

/** Record that these URLs now exist in this tenant, without fetching anything.
 *  ON CONFLICT DO NOTHING: a link pasted a second time must not reset the fetch
 *  state, bump `attempts` or move `next_attempt_at` — that would let a busy
 *  channel keep a broken host permanently out of the retry schedule. */
async function noteUrls(client, canonicalUrls) {
  const urls = [...new Set((canonicalUrls || []).filter(Boolean))].slice(0, 50);
  if (!urls.length) return [];
  const values = urls.map((u, i) => `($${i * 2 + 1}, $${i * 2 + 2}, 'PENDING')`).join(", ");
  const params = urls.flatMap((u) => [hashUrl(u), u]);
  const { rows } = await client.query(
    `INSERT INTO comms_link_preview (url_hash, url, state)
     VALUES ${values}
     -- A conflict updates nothing, so first_seen_at keeps the ORIGINAL paste date
     -- and RETURNING yields only the rows this statement actually inserted — which
     -- is exactly the set worth queueing a fetch for.
     ON CONFLICT (url_hash) DO NOTHING
     RETURNING url`,
    params,
  );
  return rows.map((r) => r.url);
}

/** The fetch's answer, successful or not. */
async function putResult(client, canonicalUrl, result) {
  const ok = result.state === "OK" || result.state === "EMPTY";
  const { rows } = await client.query(
    `UPDATE comms_link_preview SET
        state = $2,
        -- Last-known-good: a failed refresh keeps whatever the last successful
        -- one saw. COALESCE(new, old) in this direction, not COALESCE(old, new),
        -- is deliberate: an empty field from a thin page must not overwrite a
        -- richer card, and a page that really did lose its description is rare
        -- enough that showing the old one is the better error.
        title        = CASE WHEN $3::bool THEN COALESCE($4, title)       ELSE title        END,
        description  = CASE WHEN $3::bool THEN COALESCE($5, description) ELSE description  END,
        site_name    = CASE WHEN $3::bool THEN COALESCE($6, site_name)    ELSE site_name    END,
        image_url    = CASE WHEN $3::bool THEN COALESCE($7, image_url)    ELSE image_url    END,
        image_width  = CASE WHEN $3::bool THEN COALESCE($8, image_width)  ELSE image_width  END,
        image_height = CASE WHEN $3::bool THEN COALESCE($9, image_height) ELSE image_height END,
        icon_url     = CASE WHEN $3::bool THEN COALESCE($10, icon_url)    ELSE icon_url     END,
        media_kind   = CASE WHEN $3::bool THEN $11 ELSE media_kind END,
        media_id     = CASE WHEN $3::bool THEN $12 ELSE media_id   END,
        duration_seconds = CASE WHEN $3::bool THEN COALESCE($16, duration_seconds) ELSE duration_seconds END,
        author_name      = CASE WHEN $3::bool THEN COALESCE($17, author_name)      ELSE author_name      END,
        fetched_at = now(),
        last_ok_at = CASE WHEN $3::bool THEN now() ELSE last_ok_at END,
        stale_at = NULL,
        attempts = CASE WHEN $3::bool THEN 0 ELSE attempts + 1 END,
        -- REFUSED is terminal: the guard said no, and a retry of the same URL
        -- will get the same answer. UNREACHABLE backs off (15m, then doubling to
        -- ~a day) so a temporarily dead host is not hammered on every page view.
        next_attempt_at = CASE
          WHEN $2 = 'REFUSED' THEN now() + interval '100 years'
          WHEN $3::bool THEN now() + make_interval(days => $14::int)
          ELSE now() + (make_interval(mins => $13::int) * power(2, least(attempts, 4)))
        END,
        last_error = CASE WHEN $3::bool THEN NULL ELSE left($15, 400) END,
        updated_at = now()
      WHERE url_hash = $1
      RETURNING url_hash`,
    [
      hashUrl(canonicalUrl),
      result.state,
      ok,
      result.title ?? null,
      result.description ?? null,
      result.siteName ?? null,
      result.imageUrl ?? null,
      result.imageWidth ?? null,
      result.imageHeight ?? null,
      result.iconUrl ?? null,
      result.mediaKind ?? "NONE",
      result.mediaId ?? null,
      // Retry base for failures, and the freshness horizon for successes.
      result.retryBaseMinutes ?? 15,
      result.ttlDays ?? 7,
      result.error || null,
      result.duration ?? null,
      result.authorName ?? null,
    ],
  );
  if (rows.length) return true;
  // No row yet (a thread read that found a URL the send path never noted, or a
  // message written before the migration): create it from the result directly.
  const { rows: inserted } = await client.query(
    `INSERT INTO comms_link_preview
       (url_hash, url, state, title, description, site_name, image_url, image_width,
        image_height, icon_url, media_kind, media_id, duration_seconds, author_name,
        fetched_at, last_ok_at, attempts, last_error, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),
             CASE WHEN $15::bool THEN now() ELSE NULL END,
             CASE WHEN $15::bool THEN 0 ELSE 1 END,
             CASE WHEN $15::bool THEN NULL ELSE left($16,400) END,
             CASE WHEN $3 = 'REFUSED' THEN now() + interval '100 years' ELSE now() END)
     ON CONFLICT (url_hash) DO NOTHING
     RETURNING url_hash`,
    [
      hashUrl(canonicalUrl),
      canonicalUrl,
      result.state,
      result.title ?? null,
      result.description ?? null,
      result.siteName ?? null,
      result.imageUrl ?? null,
      result.imageWidth ?? null,
      result.imageHeight ?? null,
      result.iconUrl ?? null,
      result.mediaKind ?? "NONE",
      result.mediaId ?? null,
      result.duration ?? null,
      result.authorName ?? null,
      ok,
      result.error || null,
    ],
  );
  return inserted.length > 0;
}

/** A row past its TTL, seen by a reader. Returns the URLs so the caller can queue
 *  the refresh — the read itself never fetches, or a slow site would be a slow
 *  thread. */
/**
 * A row past its freshness horizon, seen by a reader. `minMinutes` is the floor
 * that stops a page view becoming a fetch storm: a row already marked stale inside
 * that window is not marked again, so one thread opened twenty times refreshes
 * once.
 */
async function markStale(client, canonicalUrls, minMinutes = 15) {
  const urls = [...new Set((canonicalUrls || []).filter(Boolean))];
  if (!urls.length) return [];
  const { rows } = await client.query(
    `UPDATE comms_link_preview
        SET stale_at = now(), updated_at = now()
      WHERE url_hash = ANY($1::text[])
        AND state IN ('OK','EMPTY','UNREACHABLE')
        -- A row marked stale recently is left alone, and an UNREACHABLE row still
        -- inside its retry backoff is not eligible at all.
        AND (stale_at IS NULL OR stale_at < now() - make_interval(mins => $2::int))
        AND next_attempt_at <= now()
      RETURNING url`,
    [urls.map(hashUrl), Math.max(1, Math.round(Number(minMinutes) || 15))]
  );
  return rows.map((r) => r.url);
}

/**
 * The worker's due list: what the send path queued, what the backoff has
 * released, and what a reader marked stale. Bounded by LIMIT, ordered oldest-first
 * so a backlog drains the links a reader is most likely to see.
 *
 * NO `FOR UPDATE SKIP LOCKED` here, even though two workers can pick the same URL.
 * A claim only helps if the work and the state change are one transaction, and
 * they cannot be: the fetch is a network call that must not hold a row lock (or a
 * tenant's slow link becomes a worker holding Postgres open for ten seconds), so
 * the lock would be released before the work started and would buy a false sense
 * of exclusivity. Two workers fetching one URL is bounded, idempotent
 * (`putResult` is a last-write-wins UPDATE on a unique key) and rarer than the
 * dedupe jobId the queue already applies on enqueue.
 */
async function due(client, limit) {
  const { rows } = await client.query(
    `SELECT url, url_hash, attempts
       FROM comms_link_preview
      WHERE state IN ('PENDING','UNREACHABLE')
         OR stale_at IS NOT NULL
      ORDER BY least(next_attempt_at, coalesce(stale_at, next_attempt_at))
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 10, 1), 100)],
  );
  return rows;
}

/** Drop a row. Only used by an operator purge; nothing else may, because the URL
 *  it caches is still in message bodies and will simply be re-fetched. */
const remove = (client, canonicalUrl) =>
  client.query("DELETE FROM comms_link_preview WHERE url_hash = $1", [hashUrl(canonicalUrl)]);

module.exports = { hashUrl, findMany, noteUrls, putResult, markStale, due, remove };
