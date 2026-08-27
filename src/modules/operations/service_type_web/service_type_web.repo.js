/**
 * service_type_web profile / FAQ / related SQL + the public read queries
 * (guide §4.5). All functions take a tenant client so they join the
 * request's connection.
 *
 * The "public read" queries are kept here rather than in the public module
 * because they are still the application's read path on the same table — the
 * shape differs (slim vs full) but the WHERE clause's source of truth
 * (is_published AND is_active) is the same in both places, and the public
 * module imports from here.
 */
"use strict";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Single-row read for the admin GET. Carries every field the dashboard
 * renders. JOIN on service_type so readiness can read name_en in the same
 * round-trip — the readiness object recomputes per GET, never stored, and
 * the FE renders the name_en row of the checklist against it.
 */
async function getProfile(client, serviceTypeId) {
  const { rows } = await client.query(
    `SELECT p.*, st.name_en AS service_type_name_en, st.is_active AS service_type_is_active,
            st.name_fr AS service_type_name_fr
       FROM service_type_web_profile p
       JOIN service_type st ON st.service_type_id = p.service_type_id
      WHERE p.service_type_id = $1`,
    [serviceTypeId],
  );
  return rows[0] || null;
}

/**
 * The shape returned when there is NO profile row yet. The service fills it
 * with defaults so the admin GET can answer 200 every time (guide §3.1,
 * §4.6 readiness) — the tab never branches on a 404.
 */
function emptyProfile(serviceTypeId) {
  return {
    service_type_id: serviceTypeId,
    short_description_fr: null,
    short_description_en: null,
    long_description_fr: null,
    long_description_en: null,
    highlights_fr: [],
    highlights_en: [],
    coverage_fr: null,
    coverage_en: null,
    slug_fr: null,
    slug_en: null,
    meta_title_fr: null,
    meta_title_en: null,
    meta_description_fr: null,
    meta_description_en: null,
    cover_vault_id: null,
    icon_vault_id: null,
    gallery_vault_ids: [],
    video_url: null,
    is_published: false,
    published_at: null,
    published_by: null,
    sort_order: 100,
    created_at: null,
    updated_at: null,
    service_type_name_en: null,
    service_type_is_active: true,
    service_type_name_fr: null,
  };
}

/**
 * Upsert the profile row. CREATE on the first write, UPDATE thereafter —
 * the guide's "one verb, omitted-keys-unchanged" rule is enforced in the
 * service (pick of defined keys) not here; the repo accepts the full patch
 * (only the keys the caller sent). The first INSERT carries the patch so
 * the row is created with the caller's values, not just defaults.
 */
async function upsertProfile(client, serviceTypeId, patch) {
  // The columns the patch may set on either branch.
  const COLUMNS = [
    "short_description_fr", "short_description_en",
    "long_description_fr", "long_description_en",
    "highlights_fr", "highlights_en",
    "coverage_fr", "coverage_en",
    "slug_fr", "slug_en",
    "meta_title_fr", "meta_title_en",
    "meta_description_fr", "meta_description_en",
    "cover_vault_id", "icon_vault_id",
    "gallery_vault_ids",
    "video_url",
    "sort_order",
  ];
  // Build an INSERT with ONLY the keys the patch actually carries (so a
  // first write with one field does not insert NULLs over every other
  // column) and ON CONFLICT DO UPDATE that COALESCEs the EXCLUDED value
  // back to the existing column — omitted keys are left unchanged.
  const sent = COLUMNS.filter((col) => Object.prototype.hasOwnProperty.call(patch, col));
  if (sent.length === 0) {
    // Pure touch (e.g. the caller only sent an audio field that maps to no
    // column). INSERT defaults and RETURN.
    const { rows } = await client.query(
      `INSERT INTO service_type_web_profile (service_type_id) VALUES ($1) RETURNING *`,
      [serviceTypeId],
    );
    return rows[0];
  }
  const insertCols = ["service_type_id", ...sent];
  const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(", ");
  const values = [serviceTypeId, ...sent.map((col) => (patch[col] === undefined ? null : patch[col]))];
  const updateSet = sent
    .map((col) => `${col} = COALESCE(EXCLUDED.${col}, service_type_web_profile.${col})`)
    .join(", ");
  const sql = `
    INSERT INTO service_type_web_profile (${insertCols.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT (service_type_id) DO UPDATE SET ${updateSet}
    RETURNING *`;
  const { rows } = await client.query(sql, values);
  return rows[0];
}

/** SELECT … FOR UPDATE on the profile row, so a publish/slug/media write
 *  can refuse a stale "while published" check after a concurrent unpublish. */
async function lockProfile(client, serviceTypeId) {
  const { rows } = await client.query(
    `SELECT p.*, st.name_en AS service_type_name_en, st.is_active AS service_type_is_active
       FROM service_type_web_profile p
       JOIN service_type st ON st.service_type_id = p.service_type_id
      WHERE p.service_type_id = $1
      FOR UPDATE OF p`,
    [serviceTypeId],
  );
  return rows[0] || null;
}

/** The name_en presence + is_active read the publish gate needs. */
async function serviceTypeForPublish(client, serviceTypeId) {
  const { rows } = await client.query(
    `SELECT service_type_id, name_en, is_active
       FROM service_type
      WHERE service_type_id = $1`,
    [serviceTypeId],
  );
  return rows[0] || null;
}

/** Mark the profile published. Caller is responsible for the gate and the
 *  transaction. Sets published_at on the FIRST publish (row was unpublished)
 *  and never clears published_at / published_by on unpublish (historical). */
async function setPublished(client, serviceTypeId, actorUserId) {
  const { rows } = await client.query(
    `UPDATE service_type_web_profile
        SET is_published = true,
            published_at = COALESCE(published_at, now()),
            published_by = COALESCE(published_by, $2)
      WHERE service_type_id = $1
      RETURNING *`,
    [serviceTypeId, actorUserId || null],
  );
  return rows[0] || null;
}

async function setUnpublished(client, serviceTypeId) {
  const { rows } = await client.query(
    `UPDATE service_type_web_profile
        SET is_published = false
      WHERE service_type_id = $1
      RETURNING *`,
    [serviceTypeId],
  );
  return rows[0] || null;
}

/** Archive auto-unpublish hook (guide §4.2 rule 2): the same transaction
 *  that deactivates the service type also clears is_published. Reactivation
 *  never re-publishes — the tenant's job to walk through the checklist again. */
async function autoUnpublishForServiceType(client, serviceTypeId) {
  const { rows } = await client.query(
    `UPDATE service_type_web_profile
        SET is_published = false
      WHERE service_type_id = $1 AND is_published = true
      RETURNING service_type_id`,
    [serviceTypeId],
  );
  return rows[0] || null;
}

/* ── FAQ ──────────────────────────────────────────────────────────────────── */

async function listFaq(client, serviceTypeId) {
  const { rows } = await client.query(
    `SELECT faq_id, service_type_id, question_fr, question_en,
            answer_fr, answer_en, sort_order, created_at, updated_at
       FROM service_type_web_faq
      WHERE service_type_id = $1
      ORDER BY sort_order ASC, faq_id ASC`,
    [serviceTypeId],
  );
  return rows;
}

/** Set-replace the FAQ (the `replaceDossiers` precedent). Done in one
 *  transaction by the caller; the repo only does the delete+insert. */
async function replaceFaq(client, serviceTypeId, rows) {
  await client.query(`DELETE FROM service_type_web_faq WHERE service_type_id = $1`, [serviceTypeId]);
  for (const row of rows) {
    await client.query(
      `INSERT INTO service_type_web_faq
         (service_type_id, question_fr, question_en, answer_fr, answer_en, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        serviceTypeId,
        row.question_fr,
        row.question_en,
        row.answer_fr,
        row.answer_en,
        row.sort_order === null || row.sort_order === undefined ? 100 : row.sort_order,
      ],
    );
  }
  return listFaq(client, serviceTypeId);
}

/* ── RELATED ──────────────────────────────────────────────────────────────── */

async function listRelated(client, serviceTypeId) {
  const { rows } = await client.query(
    `SELECT related_service_type_id
       FROM service_type_web_related
      WHERE service_type_id = $1
      ORDER BY related_service_type_id ASC`,
    [serviceTypeId],
  );
  return rows.map((r) => r.related_service_type_id);
}

/** Set-replace the related picks. Validated at the boundary (no self-pick,
 *  no duplicates) by the validator; the repo enforces the table CHECK
 *  a second time as a defence-in-depth. */
async function replaceRelated(client, serviceTypeId, ids) {
  await client.query(`DELETE FROM service_type_web_related WHERE service_type_id = $1`, [serviceTypeId]);
  for (const id of ids) {
    await client.query(
      `INSERT INTO service_type_web_related (service_type_id, related_service_type_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [serviceTypeId, id],
    );
  }
  return listRelated(client, serviceTypeId);
}

/* ── PUBLIC READS (guide §4.6) ────────────────────────────────────────────── */

/**
 * Public list — published AND active only, sort_order then name_fr. The
 * media allowlist is re-checked at read time via EXISTS subqueries so a
 * published profile whose cover was archived can never serve a stale image
 * URL. One round trip total: no N+1.
 *
 * The partial index ix_stwp_public_list covers the WHERE / ORDER BY so
 * EXPLAIN reads as an index scan, not a sort.
 */
async function publicList(client) {
  const { rows } = await client.query(
    `SELECT p.service_type_id, p.slug_fr, p.slug_en,
            st.name_fr, st.name_en,
            p.short_description_fr, p.short_description_en,
            p.cover_vault_id, p.icon_vault_id,
            p.video_url, p.sort_order, p.published_at,
            EXISTS (
              SELECT 1 FROM document_vault v
               WHERE v.doc_id = p.cover_vault_id
                 AND v.status = 'VERIFIED'
                 AND v.doc_type = 'SERVICE_TYPE_MEDIA'
                 AND v.public_media_scope = 'SERVICE_TYPE'
                 AND v.public_media_entity_ref = 'service_type:' || p.service_type_id::text
                 AND v.public_media_role = 'COVER'
                 AND v.public_media_content_type = ANY($1::text[])
            ) AS cover_allowed,
            EXISTS (
              SELECT 1 FROM document_vault v
               WHERE v.doc_id = p.icon_vault_id
                 AND v.status = 'VERIFIED'
                 AND v.doc_type = 'SERVICE_TYPE_MEDIA'
                 AND v.public_media_scope = 'SERVICE_TYPE'
                 AND v.public_media_entity_ref = 'service_type:' || p.service_type_id::text
                 AND v.public_media_role = 'ICON'
                 AND v.public_media_content_type = ANY($1::text[])
            ) AS icon_allowed,
            (p.video_url IS NOT NULL) AS has_video
       FROM service_type_web_profile p
       JOIN service_type st ON st.service_type_id = p.service_type_id
      WHERE p.is_published = true AND st.is_active = true
      ORDER BY p.sort_order ASC, st.name_fr ASC`,
    [IMAGE_TYPES],
  );
  return rows;
}

/**
 * Public detail — matches slug_fr OR slug_en, published AND active. Full
 * bilingual payload. The FAQ + related are fetched in a single follow-up
 * IN-list round trip (not a per-row fan-out), so the per-detail cost is two
 * queries regardless of how many FAQ rows the service has.
 *
 * If the row exists but a cover was archived, the URL is nulled at the
 * read path so the renderer never tries to fetch a dead image.
 */
async function publicDetail(client, slug) {
  const { rows } = await client.query(
    `SELECT p.*, st.name_fr, st.name_en, st.is_active
       FROM service_type_web_profile p
       JOIN service_type st ON st.service_type_id = p.service_type_id
      WHERE p.is_published = true AND st.is_active = true
        AND (p.slug_fr = $1 OR p.slug_en = $1)
      LIMIT 1`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  // Allowlist re-check at read time (cover + icon + gallery), one IN-list
  // round trip. A row's media URLs are derived from the allowlist, not
  // from the profile row alone.
  const ids = [row.cover_vault_id, row.icon_vault_id, ...(row.gallery_vault_ids || [])].filter(Boolean);
  const mediaByRole = new Map();
  if (ids.length) {
    const { rows: media } = await client.query(
      `SELECT doc_id, public_media_role
         FROM document_vault
        WHERE doc_id = ANY($1::uuid[]) AND status = 'VERIFIED'
          AND doc_type = 'SERVICE_TYPE_MEDIA'
          AND public_media_scope = 'SERVICE_TYPE'
          AND public_media_entity_ref = $2
          AND public_media_content_type = ANY($3::text[])`,
      [ids, `service_type:${row.service_type_id}`, IMAGE_TYPES],
    );
    for (const m of media) mediaByRole.set(m.doc_id, m.public_media_role);
  }
  return { row, mediaByRole };
}

/**
 * Related services for the public detail. Filtered to published + active
 * so the related list never leaks an unpublished slug.
 */
async function publicRelated(client, serviceTypeId) {
  const { rows } = await client.query(
    `SELECT st.service_type_id, st.name_fr, st.name_en,
            p.slug_fr, p.slug_en
       FROM service_type_web_related r
       JOIN service_type st ON st.service_type_id = r.related_service_type_id
       JOIN service_type_web_profile p ON p.service_type_id = r.related_service_type_id
      WHERE r.service_type_id = $1
        AND p.is_published = true
        AND st.is_active = true
      ORDER BY p.sort_order ASC, st.name_fr ASC`,
    [serviceTypeId],
  );
  return rows;
}

async function publicFaq(client, serviceTypeId) {
  const { rows } = await client.query(
    `SELECT faq_id, question_fr, question_en, answer_fr, answer_en
       FROM service_type_web_faq
      WHERE service_type_id = $1
      ORDER BY sort_order ASC, faq_id ASC`,
    [serviceTypeId],
  );
  return rows;
}

/* ── ADMIN LOOKUP HELPERS ─────────────────────────────────────────────────── */

/** True if the service_type row exists at all. The admin GET /web answers
 *  200 when the service type exists regardless of whether a profile row
 *  does, so this is the only 404 the route can produce. */
async function serviceTypeExists(client, serviceTypeId) {
  const { rows } = await client.query(
    `SELECT 1 FROM service_type WHERE service_type_id = $1`,
    [serviceTypeId],
  );
  return rows.length > 0;
}

/** Used by the readiness check + the public media route. Re-checks the
 *  allowlist at serve time (guide §4.3) — a row that points at a doc id
 *  whose scope/role has been cleared is unreachable. */
async function vaultMediaForServe(client, docId) {
  const { rows } = await client.query(
    `SELECT v.*
       FROM document_vault v
      WHERE v.doc_id = $1 AND v.status = 'VERIFIED'
        AND v.doc_type = 'SERVICE_TYPE_MEDIA'
        AND v.public_media_scope = 'SERVICE_TYPE'
        AND v.public_media_content_type = ANY($2::text[])`,
    [docId, IMAGE_TYPES],
  );
  return rows[0] || null;
}

module.exports = {
  IMAGE_TYPES,
  getProfile,
  emptyProfile,
  upsertProfile,
  lockProfile,
  serviceTypeForPublish,
  setPublished,
  setUnpublished,
  autoUnpublishForServiceType,
  listFaq,
  replaceFaq,
  listRelated,
  replaceRelated,
  publicList,
  publicDetail,
  publicRelated,
  publicFaq,
  serviceTypeExists,
  vaultMediaForServe,
};
