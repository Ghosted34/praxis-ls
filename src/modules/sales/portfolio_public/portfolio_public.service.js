"use strict";

const storage = require("../../../services/storage.service");
const { AppError } = require("../../../utils/errors");
const { publishedMonth } = require("../../../shared/date/published-month");

const nope = () => new AppError("NOT_FOUND", "Story not found", 404);
const nameOf = (row) => row.public_reference_consent === "NAMED"
  ? (row.legal_name || row.name)
  : "Client anonymised";
const mediaUrl = (id) => id ? `/api/tenant/public/portfolio/media/${id}` : null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function list(client) {
  const { rows } = await client.query(
    `SELECT s.success_story_id, s.slug, s.title, s.service_category,
            s.cover_vault_id, s.client_logo_vault_id, s.published_at,
            cm.name, cm.legal_name, cm.public_reference_consent,
            EXISTS (
              SELECT 1 FROM document_vault v
               WHERE v.doc_id = s.cover_vault_id AND v.status = 'VERIFIED'
                 AND v.doc_type = 'SUCCESS_STORY_MEDIA'
                 AND v.public_media_scope = 'SUCCESS_STORY'
                 AND v.public_media_entity_ref = 'success_story:' || s.success_story_id::text
                 AND v.public_media_role = 'COVER'
                 AND v.public_media_content_type = ANY($1::text[])
            ) AS cover_allowed,
            EXISTS (
              SELECT 1 FROM document_vault v
               WHERE v.doc_id = s.client_logo_vault_id AND v.status = 'VERIFIED'
                 AND v.doc_type = 'SUCCESS_STORY_MEDIA'
                 AND v.public_media_scope = 'SUCCESS_STORY'
                 AND v.public_media_entity_ref = 'success_story:' || s.success_story_id::text
                 AND v.public_media_role = 'CLIENT_LOGO'
                 AND v.public_media_content_type = ANY($1::text[])
            ) AS logo_allowed
       FROM success_story s
       LEFT JOIN client_master cm ON cm.client_id = s.client_id
      WHERE s.is_published = true
      ORDER BY s.published_at DESC`,
    [["image/png", "image/jpeg", "image/webp"]],
  );
  return rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    service_category: row.service_category,
    cover_url: row.cover_allowed ? mediaUrl(row.cover_vault_id) : null,
    client_logo_url: row.public_reference_consent === "NAMED" && row.logo_allowed
      ? mediaUrl(row.client_logo_vault_id) : null,
    client_name: nameOf(row),
    published_month: publishedMonth(row.published_at),
  }));
}

async function get(client, slug) {
  const { rows } = await client.query(
    `SELECT s.success_story_id, s.slug, s.title, s.headline,
            s.executive_summary, s.operations_execution, s.kpis,
            s.service_category, s.cover_vault_id, s.client_logo_vault_id,
            s.gallery_vault_ids, s.published_at,
            cm.name, cm.legal_name, cm.public_reference_consent
       FROM success_story s
       LEFT JOIN client_master cm ON cm.client_id = s.client_id
      WHERE s.slug = $1 AND s.is_published = true`,
    [slug],
  );
  const row = rows[0];
  if (!row) throw nope();
  const binding = ref(row.success_story_id);
  const ids = [
    row.cover_vault_id,
    row.client_logo_vault_id,
    ...(row.gallery_vault_ids || []),
  ].filter(Boolean);
  const allowed = ids.length ? await client.query(
    `SELECT doc_id, public_media_role
       FROM document_vault
      WHERE doc_id = ANY($1::uuid[]) AND status = 'VERIFIED'
        AND doc_type = 'SUCCESS_STORY_MEDIA'
        AND public_media_scope = 'SUCCESS_STORY'
        AND public_media_entity_ref = $2
        AND public_media_content_type = ANY($3::text[])`,
    [ids, binding, ["image/png", "image/jpeg", "image/webp"]],
  ) : { rows: [] };
  const byRole = new Map();
  for (const media of allowed.rows) {
    if (!byRole.has(media.public_media_role)) byRole.set(media.public_media_role, new Set());
    byRole.get(media.public_media_role).add(media.doc_id);
  }
  const coverAllowed = byRole.get("COVER")?.has(row.cover_vault_id);
  const logoAllowed = byRole.get("CLIENT_LOGO")?.has(row.client_logo_vault_id);
  const named = row.public_reference_consent === "NAMED";
  return {
    slug: row.slug,
    title: row.title,
    headline: row.headline,
    executive_summary: row.executive_summary,
    operations_execution: row.operations_execution,
    kpis: row.kpis,
    service_category: row.service_category,
    client_name: nameOf(row),
    cover_url: coverAllowed ? mediaUrl(row.cover_vault_id) : null,
    client_logo_url: named && logoAllowed ? mediaUrl(row.client_logo_vault_id) : null,
    gallery_urls: (row.gallery_vault_ids || [])
      .filter((id) => byRole.get("GALLERY")?.has(id))
      .map(mediaUrl),
    published_at: row.published_at,
  };
}

function ref(id) { return `success_story:${id}`; }

/**
 * Fail-closed anonymous media authorization. The vault row itself must carry an
 * exact verified image classification and exact story/role binding; a UUID in a
 * story column alone never grants public access.
 */
async function media(client, id) {
  if (!UUID.test(String(id))) throw nope();
  const { rows } = await client.query(
    `SELECT v.*
       FROM document_vault v
       JOIN success_story s
         ON v.public_media_entity_ref = 'success_story:' || s.success_story_id::text
       LEFT JOIN client_master cm ON cm.client_id = s.client_id
      WHERE v.doc_id = $1 AND v.status = 'VERIFIED'
        AND v.doc_type = 'SUCCESS_STORY_MEDIA'
        AND v.public_media_scope = 'SUCCESS_STORY'
        AND v.public_media_content_type = ANY($2::text[])
        AND s.is_published = true
        AND (
          (v.public_media_role = 'COVER' AND s.cover_vault_id = v.doc_id)
          OR (v.public_media_role = 'GALLERY' AND v.doc_id = ANY(s.gallery_vault_ids))
          OR (v.public_media_role = 'CLIENT_LOGO'
              AND s.client_logo_vault_id = v.doc_id
              AND cm.public_reference_consent = 'NAMED')
        )`,
    [id, ["image/png", "image/jpeg", "image/webp"]],
  );
  const doc = rows[0];
  if (!doc || !doc.storage_path || doc.storage_path.startsWith("pending://")) throw nope();
  return { doc, buffer: await storage.get(doc.storage_path) };
}

module.exports = { list, get, media, nameOf, nope };
