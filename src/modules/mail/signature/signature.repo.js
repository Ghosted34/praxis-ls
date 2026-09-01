"use strict";

const listTemplates = (client, { includeInactive = false } = {}) =>
  client.query(
    `SELECT * FROM signature_template
      WHERE ($1::boolean OR is_active)
      ORDER BY is_system DESC, scope_kind, name`,
    [includeInactive],
  ).then((r) => r.rows);

const getTemplate = (client, id) =>
  client.query(`SELECT * FROM signature_template WHERE signature_template_id = $1`, [id])
    .then((r) => r.rows[0] || null);

const getTemplateByKey = (client, key) =>
  client.query(`SELECT * FROM signature_template WHERE key = $1`, [key])
    .then((r) => r.rows[0] || null);

async function defaultTemplate(client, { department = null, entityId = null } = {}) {
  if (department) {
    const d = await client.query(
      `SELECT * FROM signature_template
        WHERE is_active AND is_default AND scope_kind = 'DEPARTMENT'
          AND lower(scope_value) = lower($1)
        LIMIT 1`,
      [department],
    );
    if (d.rows[0]) return d.rows[0];
  }
  if (entityId) {
    const e = await client.query(
      `SELECT * FROM signature_template
        WHERE is_active AND is_default AND scope_kind = 'ENTITY' AND scope_value = $1
        LIMIT 1`,
      [String(entityId)],
    );
    if (e.rows[0]) return e.rows[0];
  }
  const t = await client.query(
    `SELECT * FROM signature_template
      WHERE is_active AND is_default AND scope_kind = 'TENANT'
      ORDER BY is_system DESC LIMIT 1`,
  );
  return t.rows[0] || null;
}

async function updateTemplate(client, id, fields) {
  const allowed = ["name", "description", "layout", "copy_en", "copy_fr", "scope_kind", "scope_value", "is_default", "is_active"];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] === undefined) continue;
    vals.push(fields[k]);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) return getTemplate(client, id);
  vals.push(id);
  const { rows } = await client.query(
    `UPDATE signature_template SET ${sets.join(", ")}, updated_at = now()
      WHERE signature_template_id = $${vals.length}
      RETURNING *`,
    vals,
  );
  return rows[0] || null;
}

const getProfile = (client, userId) =>
  client.query(`SELECT * FROM user_signature_profile WHERE user_id = $1`, [userId])
    .then((r) => r.rows[0] || null);

async function upsertProfile(client, userId, fields) {
  const { rows } = await client.query(
    `INSERT INTO user_signature_profile (
       user_id, signature_template_id, phone_desk, phone_mobile, whatsapp,
       pronouns, credentials, booking_url, language, extra, is_enabled, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'{}'::jsonb),COALESCE($11,true), now())
     ON CONFLICT (user_id) DO UPDATE SET
       signature_template_id = COALESCE(EXCLUDED.signature_template_id, user_signature_profile.signature_template_id),
       phone_desk  = COALESCE(EXCLUDED.phone_desk,  user_signature_profile.phone_desk),
       phone_mobile= COALESCE(EXCLUDED.phone_mobile,user_signature_profile.phone_mobile),
       whatsapp    = COALESCE(EXCLUDED.whatsapp,    user_signature_profile.whatsapp),
       pronouns    = COALESCE(EXCLUDED.pronouns,    user_signature_profile.pronouns),
       credentials = COALESCE(EXCLUDED.credentials, user_signature_profile.credentials),
       booking_url = COALESCE(EXCLUDED.booking_url, user_signature_profile.booking_url),
       language    = COALESCE(EXCLUDED.language,    user_signature_profile.language),
       extra       = CASE WHEN $10 IS NULL THEN user_signature_profile.extra ELSE EXCLUDED.extra END,
       is_enabled  = COALESCE(EXCLUDED.is_enabled,  user_signature_profile.is_enabled),
       updated_at  = now()
     RETURNING *`,
    [
      userId,
      fields.signature_template_id || null,
      fields.phone_desk ?? null,
      fields.phone_mobile ?? null,
      fields.whatsapp ?? null,
      fields.pronouns ?? null,
      fields.credentials ?? null,
      fields.booking_url ?? null,
      fields.language || null,
      fields.extra || null,
      fields.is_enabled,
    ],
  );
  return rows[0];
}

async function loadPerson(client, userId) {
  const { rows } = await client.query(
    `SELECT u.user_id, u.full_name AS user_full_name, u.email AS user_email,
            e.employee_id, e.full_name AS employee_full_name, e.job_title, e.department,
            e.entity_id, e.avatar_ref,
            e.email        AS employee_email,
            e.phone_desk   AS employee_phone_desk,
            e.phone_mobile AS employee_phone_mobile
       FROM app_user u
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

/**
 * The entity, WITH its address.
 *
 * `decorateEntity` used to read `row.po_box`, `row.city` and `row.postal_code`
 * straight off `corporate_entity`. That table has none of those columns — they
 * live on `entity_address` (migration 0515), which nothing here joined. So the
 * three fields were `undefined || null` on every render since the engine
 * shipped: every signature in the system has been missing its P.O. Box and city,
 * silently, and `address_line` has been the legacy free-text `address` column
 * alone. The letterhead already learned this and prefers the REGISTERED row
 * (0513 §5); signatures now do the same.
 *
 * REGISTERED first, then the primary row, then any row — matching the
 * letterhead's precedence so the two documents cannot disagree about where the
 * company is.
 */
const ENTITY_SELECT = `
  SELECT ce.*,
         a.line1        AS addr_line1,
         a.line2        AS addr_line2,
         a.city         AS addr_city,
         a.region       AS addr_region,
         a.postal_code  AS addr_postal_code,
         a.po_box       AS addr_po_box,
         a.country_code AS addr_country_code
    FROM corporate_entity ce
    LEFT JOIN LATERAL (
      SELECT * FROM entity_address ea
       WHERE ea.entity_id = ce.entity_id AND ea.is_active
       ORDER BY (ea.type = 'REGISTERED') DESC, ea.is_primary DESC, ea.created_at
       LIMIT 1
    ) a ON true`;

async function loadEntity(client, entityId) {
  if (!entityId) {
    const { rows } = await client.query(
      `${ENTITY_SELECT} WHERE ce.is_active IS DISTINCT FROM false ORDER BY ce.created_at LIMIT 1`,
    );
    return decorateEntity(rows[0] || null);
  }
  const { rows } = await client.query(
    `${ENTITY_SELECT} WHERE ce.entity_id = $1`,
    [entityId],
  );
  return decorateEntity(rows[0] || null);
}

function decorateEntity(row) {
  if (!row) return null;
  // The structured address row wins; the legacy free-text `address` column is
  // the fallback, so an entity nobody has migrated still renders a street line.
  const street = [row.addr_line1, row.addr_line2].filter(Boolean).join(", ") || row.address || null;
  return {
    ...row,
    address_line: street,
    street_line: street,
    po_box: row.addr_po_box || null,
    postal_code: row.addr_postal_code || null,
    city: row.addr_city || null,
    region: row.addr_region || null,
    country: row.addr_country_code || row.country_code || row.country || null,
    logo_url: row.logo_url || null,
  };
}

/**
 * The tenant's appearance settings — the card's parametric palette (see
 * signature.palette.js). Read from the same `setting` rows the branding module
 * writes rather than through that module's service, because this runs on the
 * send path and wants one query, not a module boundary.
 *
 * Returns camelCase to match branding.service.getBranding()'s shape, which is
 * what signature.palette.resolve expects.
 */
async function loadBranding(client) {
  // FIELD → setting key, the same direction branding.service.js's own KEYS map
  // runs. Written this way round for a second reason: the reverse (`font_body:
  // "fontBody"`) reads to `check:fonts` as a font_body setting being assigned
  // the family "fontBody", and it failed the build for it. The gate was right to
  // look — that pattern is exactly how a stray family name gets persisted — so
  // this avoids the shape rather than exempting the file.
  const KEYS = {
    primary: "primary_color",
    secondary: "secondary_color",
    accent: "accent",
    accentDeep: "accent_deep",
    accentGlow: "accent_glow",
    logoUrl: "logo_url",
  };
  try {
    const { rows } = await client.query(
      `SELECT key, value FROM setting WHERE section = 'appearance' AND key = ANY($1)`,
      [Object.values(KEYS)],
    );
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const out = {};
    for (const [field, key] of Object.entries(KEYS)) {
      const v = byKey.get(key);
      out[field] = v === undefined || v === null ? null : (typeof v === "string" ? v : String(v));
    }
    return out;
  } catch {
    /* @silent:storage a tenant with no appearance rows renders the Praxis
       fallback palette, which is exactly what signature.palette does with {}. */
    return {};
  }
}

/**
 * Staff who can have a signature rendered: an active user linked to an
 * employee, which is what supplies the name and job title. A user with no
 * employee row would render a card with an empty title bar, so they are not
 * offered rather than offered and broken.
 */
async function listSignatureStaff(client, { search = null, limit = 500 } = {}) {
  const { rows } = await client.query(
    `SELECT u.user_id,
            COALESCE(e.full_name, u.full_name) AS full_name,
            e.job_title, e.department, u.email,
            (p.user_id IS NOT NULL) AS has_profile
       FROM app_user u
       JOIN employee e ON e.employee_id = u.employee_id
       LEFT JOIN user_signature_profile p ON p.user_id = u.user_id
      WHERE u.status = 'ACTIVE'
        AND ($1::text IS NULL OR COALESCE(e.full_name, u.full_name) ILIKE '%' || $1 || '%')
      ORDER BY COALESCE(e.full_name, u.full_name)
      LIMIT $2`,
    [search || null, Math.min(Number(limit) || 500, 2000)],
  );
  return rows;
}

const getCached = (client, { userId = null, identityKey = null, language, format, scale }) =>
  client.query(
    `SELECT * FROM signature_render
      WHERE COALESCE(user_id::text, identity_key) = COALESCE($1::text, $2)
        AND language = $3 AND format = $4 AND scale = $5`,
    [userId, identityKey, language, format, scale],
  ).then((r) => r.rows[0] || null);

async function putCached(client, row) {
  // Expression unique indexes cannot be inferred by ON CONFLICT. Replace the
  // matching row instead: one render per (subject, language, format, scale).
  await client.query(
    `DELETE FROM signature_render
      WHERE COALESCE(user_id::text, identity_key) = COALESCE($1::text, $2)
        AND language = $3 AND format = $4 AND scale = $5`,
    [row.user_id || null, row.identity_key || null, row.language, row.format, row.scale],
  );
  const { rows } = await client.query(
    `INSERT INTO signature_render (
       user_id, identity_key, language, format, scale, content, storage_path, source_hash, generated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     RETURNING *`,
    [
      row.user_id || null, row.identity_key || null, row.language, row.format,
      row.scale, row.content || null, row.storage_path || null, row.source_hash,
    ],
  );
  return rows[0];
}

const deleteCachedForUser = (client, userId) =>
  client.query(`DELETE FROM signature_render WHERE user_id = $1`, [userId]);

const deleteCachedForIdentity = (client, identityKey) =>
  client.query(`DELETE FROM signature_render WHERE identity_key = $1`, [identityKey]);

/**
 * Every SYSTEM render, whatever its identity.
 *
 * `identity_key IS NOT NULL` is what makes this the system half — a personal
 * render carries a `user_id` and no identity key. Used when the company itself
 * changes, since every corporate block derives from the same entity row.
 */
const deleteAllIdentityCached = (client) =>
  client.query(`DELETE FROM signature_render WHERE identity_key IS NOT NULL`)
    .then((r) => r.rowCount);

const deleteAllCached = (client) =>
  client.query(`DELETE FROM signature_render`);

const usersForEntity = (client, entityId) =>
  client.query(
    `SELECT u.user_id FROM app_user u
       JOIN employee e ON e.employee_id = u.employee_id
      WHERE e.entity_id = $1`,
    [entityId],
  ).then((r) => r.rows.map((x) => x.user_id));

module.exports = {
  listTemplates, getTemplate, getTemplateByKey, defaultTemplate, updateTemplate,
  getProfile, upsertProfile, loadPerson, loadEntity, loadBranding, listSignatureStaff,
  getCached, putCached, deleteCachedForUser, deleteCachedForIdentity,
  deleteAllIdentityCached, deleteAllCached,
  usersForEntity,
};
