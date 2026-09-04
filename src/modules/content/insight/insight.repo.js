"use strict";

/**
 * Articles (migration 12757). Parameterised SQL only.
 */

const TABLE = "insight_article";

/**
 * The columns a caller may write. The list is the boundary — `published_at`,
 * `published_by` and `is_published` are absent on purpose and are set by
 * `setPublished`, which stamps who and when in the same statement.
 */
const WRITABLE = [
  "slug_fr", "slug_en",
  "title_fr", "title_en",
  "excerpt_fr", "excerpt_en",
  "body_fr", "body_en",
  "meta_title_fr", "meta_title_en",
  "meta_description_fr", "meta_description_en",
  "cover_vault_id",
  "gallery_vault_ids",
  "tags",
  "author_user_id",
  "sort_order",
];

/**
 * The author is joined, never denormalised.
 *
 * A copy of the name on the article would be the name as it was on the day it
 * was written — which is how a colleague who marries appears under two names on
 * one website. The join costs nothing at these row counts and the answer is
 * always current.
 *
 * TWO joins, because the two facts live in two places: `app_user` is the login
 * and carries `full_name`, while the job title is HR data on `employee`, reached
 * through `app_user.employee_id`. This is the "free win" WS5 names — their site
 * keeps author names inside translation keys, and the same five people are in
 * this database already with their titles and their photographs.
 *
 * Both joins are LEFT: an author who was never an employee (a founder posting
 * under a platform account) still gets their name, and an article whose author
 * has left gets neither rather than an error.
 */
const SELECT_LIST = `
  SELECT a.*,
         u.full_name  AS author_name,
         e.job_title  AS author_title,
         COALESCE(e.avatar_ref, u.avatar_ref) AS author_avatar_ref
    FROM insight_article a
    LEFT JOIN app_user u ON u.user_id = a.author_user_id
    LEFT JOIN employee e ON e.employee_id = u.employee_id
`;

async function list(client, { publishedOnly = false, tag = null, limit = null, offset = 0 } = {}) {
  const params = [publishedOnly, tag];
  let sql = `${SELECT_LIST}
     WHERE ($1::boolean = false OR a.is_published = true)
       AND ($2::text IS NULL OR a.tags @> ARRAY[$2]::text[])
     ORDER BY a.published_at DESC NULLS LAST, a.sort_order ASC, a.created_at DESC`;
  if (limit !== null) {
    params.push(limit, offset);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }
  const { rows } = await client.query(sql, params);
  return rows;
}

/** The count the paginated list reports, under the same filter. */
async function count(client, { publishedOnly = false, tag = null } = {}) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM insight_article a
      WHERE ($1::boolean = false OR a.is_published = true)
        AND ($2::text IS NULL OR a.tags @> ARRAY[$2]::text[])`,
    [publishedOnly, tag],
  );
  return rows[0].n;
}

/**
 * Every tag actually in use, with how many articles carry it.
 *
 * This is the fix for the bug WS5 names: their filter bar is a hardcoded list of
 * four while the articles carry six tags, so two articles are unreachable by any
 * filter. Deriving the list means a tag cannot exist without a way to reach it,
 * and a tag nobody uses cannot linger in the bar.
 */
async function tagsInUse(client, { publishedOnly = true } = {}) {
  const { rows } = await client.query(
    `SELECT tag, COUNT(*)::int AS count
       FROM insight_article a, unnest(a.tags) AS tag
      WHERE ($1::boolean = false OR a.is_published = true)
      GROUP BY tag
      ORDER BY COUNT(*) DESC, tag ASC`,
    [publishedOnly],
  );
  return rows;
}

async function get(client, id) {
  const { rows } = await client.query(
    `${SELECT_LIST} WHERE a.insight_article_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * By slug, in EITHER language.
 *
 * A reader who follows a French link and switches to English must land on the
 * same article, and the two slugs differ. Matching both columns is what makes
 * one URL per language work without a redirect table.
 */
async function getBySlug(client, slug, { publishedOnly = false } = {}) {
  const { rows } = await client.query(
    `${SELECT_LIST}
      WHERE (a.slug_fr = $1 OR a.slug_en = $1)
        AND ($2::boolean = false OR a.is_published = true)
      LIMIT 1`,
    [slug, publishedOnly],
  );
  return rows[0] || null;
}

async function slugTaken(client, slug, exceptId = null) {
  if (!slug) return false;
  const { rowCount } = await client.query(
    `SELECT 1 FROM insight_article
      WHERE (slug_fr = $1 OR slug_en = $1)
        AND ($2::uuid IS NULL OR insight_article_id <> $2)
      LIMIT 1`,
    [slug, exceptId],
  );
  return rowCount > 0;
}

async function insert(client, patch) {
  const cols = WRITABLE.filter((c) => Object.prototype.hasOwnProperty.call(patch, c));
  const params = cols.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await client.query(
    `INSERT INTO insight_article (${cols.join(", ")}) VALUES (${params})
       RETURNING insight_article_id`,
    cols.map((c) => patch[c]),
  );
  return get(client, rows[0].insight_article_id);
}

/** Omitted keys unchanged. Publish state is NOT settable here. */
async function update(client, id, patch) {
  const cols = WRITABLE.filter((c) => Object.prototype.hasOwnProperty.call(patch, c));
  if (cols.length === 0) return get(client, id);
  const set = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  await client.query(
    `UPDATE insight_article SET ${set} WHERE insight_article_id = $1`,
    [id, ...cols.map((c) => patch[c])],
  );
  return get(client, id);
}

/**
 * Publishing stamps who and when, in the statement that sets the flag.
 *
 * `published_at` is NOT re-stamped on a re-publish: it is the article's date,
 * shown on every card and sent as `article:published_time`, and moving it every
 * time somebody fixes a typo would make an old piece look new each time it was
 * corrected. Unpublishing clears the publisher but KEEPS the date, so bringing
 * an article back does not silently re-date it either.
 */
async function setPublished(client, id, actorUserId, published) {
  await client.query(
    `UPDATE insight_article
        SET is_published = $3,
            published_at = CASE WHEN $3 THEN COALESCE(published_at, now()) ELSE published_at END,
            published_by = CASE WHEN $3 THEN $2::uuid ELSE NULL END
      WHERE insight_article_id = $1`,
    [id, actorUserId, published],
  );
  return get(client, id);
}

async function remove(client, id) {
  const { rows } = await client.query(
    "DELETE FROM insight_article WHERE insight_article_id = $1 RETURNING insight_article_id",
    [id],
  );
  return rows[0] || null;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The fail-closed allowlist re-check for a public cover, mirroring
 * `service_type_web.repo.publicMediaForServe` (which §3.5 says to read first).
 *
 * A bare doc id NEVER grants public access. Every one of these conditions is a
 * separate way the answer must be no:
 *
 *   · a non-UUID is refused at the boundary, before a connection is used;
 *   · the document must be VERIFIED, scoped INSIGHT, and an image;
 *   · the owning article must be PUBLISHED — so an unannounced piece's cover
 *     cannot be fetched at a guessed URL before its date; and
 *   · the doc must still be bound to the article's `cover_vault_id` — so a
 *     cover swapped out is not served from a stale URL, and a doc scoped to
 *     article A cannot be streamed by asking for article B's media.
 */
async function publicCoverForServe(client, docId) {
  if (!UUID_RE.test(String(docId || ""))) return null;
  const { rows } = await client.query(
    `SELECT v.doc_id, v.public_media_content_type, v.storage_path
       FROM document_vault v
       JOIN insight_article a ON a.cover_vault_id = v.doc_id
      WHERE v.doc_id = $1
        AND v.status = 'VERIFIED'
        AND v.public_media_scope = 'INSIGHT'
        AND v.public_media_role = 'COVER'
        AND v.public_media_content_type = ANY($2::text[])
        AND a.is_published = true`,
    [docId, IMAGE_TYPES],
  );
  return rows[0] || null;
}

/**
 * A gallery image, for the public media route.
 *
 * Same fail-closed shape as `publicCoverForServe` and one clause different: the
 * doc must be a member of the owning article's `gallery_vault_ids`, which is
 * what `= ANY(a.gallery_vault_ids)` asserts. A doc removed from the array stops
 * being servable on the next request even though its vault row still exists —
 * which is the property that lets removal archive rather than delete.
 */
async function publicGalleryForServe(client, docId) {
  if (!UUID_RE.test(String(docId || ""))) return null;
  const { rows } = await client.query(
    `SELECT v.doc_id, v.public_media_content_type, v.storage_path
       FROM document_vault v
       JOIN insight_article a ON v.doc_id = ANY(a.gallery_vault_ids)
      WHERE v.doc_id = $1
        AND v.status = 'VERIFIED'
        AND v.public_media_scope = 'INSIGHT'
        AND v.public_media_role = 'GALLERY'
        AND v.public_media_content_type = ANY($2::text[])
        AND a.is_published = true`,
    [docId, IMAGE_TYPES],
  );
  return rows[0] || null;
}

/** The cover or a gallery image — the public media route serves one URL space
 *  and does not know which of the two an id is until it asks. Cover first: it
 *  is the one every article has. */
async function publicMediaForServe(client, docId) {
  return (
    (await publicCoverForServe(client, docId)) ||
    (await publicGalleryForServe(client, docId))
  );
}

module.exports = {
  TABLE, WRITABLE, IMAGE_TYPES, UUID_RE,
  publicCoverForServe, publicGalleryForServe, publicMediaForServe,
  list, count, tagsInUse, get, getBySlug, slugTaken,
  insert, update, setPublished, remove,
};
