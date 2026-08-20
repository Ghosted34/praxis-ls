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
    `SELECT u.user_id, u.full_name AS user_full_name, u.email,
            e.employee_id, e.full_name AS employee_full_name, e.job_title, e.department,
            e.entity_id, e.avatar_ref
       FROM app_user u
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE u.user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function loadEntity(client, entityId) {
  if (!entityId) {
    const { rows } = await client.query(
      `SELECT * FROM corporate_entity WHERE is_active IS DISTINCT FROM false ORDER BY created_at LIMIT 1`,
    );
    return decorateEntity(rows[0] || null);
  }
  const { rows } = await client.query(
    `SELECT * FROM corporate_entity WHERE entity_id = $1`,
    [entityId],
  );
  return decorateEntity(rows[0] || null);
}

function decorateEntity(row) {
  if (!row) return null;
  return {
    ...row,
    address_line: row.address || null,
    po_box: row.po_box || null,
    postal_code: row.postal_code || null,
    city: row.city || null,
    country: row.country_code || row.country || null,
    logo_url: row.logo_url || null,
  };
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
  getProfile, upsertProfile, loadPerson, loadEntity,
  getCached, putCached, deleteCachedForUser, deleteCachedForIdentity, deleteAllCached,
  usersForEntity,
};
