"use strict";
/**
 * Website settings — SQL only. Every statement is parameterised; no assembly,
 * no derivation, no palette maths. Those live in the service.
 *
 * ── THE SINGLETONS ─────────────────────────────────────────────────────────
 *
 * `site_theme` and `site_about` are one-row tables (13780, 13785), seeded by
 * their own migrations. The getters therefore never return null in practice —
 * but they are written to tolerate it anyway, because a tenant database
 * restored from a partial backup is a real thing and a 500 on the homepage is
 * a worse answer than the default palette.
 */

/* ── theme ──────────────────────────────────────────────────────────────────*/

const THEME_COLUMNS = [
  "primary_hex", "secondary_hex", "tertiary_hex",
  "font_display", "font_body", "font_mono",
  "radius_px", "default_mode",
];

async function getTheme(client) {
  const { rows } = await client.query("SELECT * FROM site_theme LIMIT 1");
  return rows[0] || null;
}

async function updateTheme(client, patch, actorId) {
  const sets = [];
  const vals = [];
  for (const col of THEME_COLUMNS) {
    if (patch[col] !== undefined) {
      vals.push(patch[col]);
      sets.push(`${col} = $${vals.length}`);
    }
  }
  if (!sets.length) return getTheme(client);
  vals.push(actorId || null);
  sets.push(`updated_by = $${vals.length}`, "updated_at = now()");
  const { rows } = await client.query(
    `UPDATE site_theme SET ${sets.join(", ")} WHERE singleton = true RETURNING *`,
    vals,
  );
  return rows[0] || null;
}

/* ── social ─────────────────────────────────────────────────────────────────*/

async function listSocial(client) {
  const { rows } = await client.query(
    "SELECT platform, url FROM site_social_link ORDER BY platform",
  );
  return rows;
}

/** Upsert, because the settings screen is a form of one row per platform and
 *  "save" means "this is the set now". */
async function setSocial(client, platform, url, actorId) {
  const { rows } = await client.query(
    `INSERT INTO site_social_link (platform, url, updated_by)
          VALUES ($1, $2, $3)
     ON CONFLICT (platform)
       DO UPDATE SET url = EXCLUDED.url, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING platform, url`,
    [platform, url, actorId || null],
  );
  return rows[0];
}

/** Clearing the field deletes the row. Absence IS the empty state (13781) —
 *  an empty-string row would render a footer icon linking nowhere. */
async function clearSocial(client, platform) {
  await client.query("DELETE FROM site_social_link WHERE platform = $1", [platform]);
}

/* ── partners ───────────────────────────────────────────────────────────────*/

const PARTNER_COLUMNS = ["name", "kind", "url", "permission_note", "sort_order", "is_active", "logo_vault_id"];

const listPartners = async (client) => (
  await client.query("SELECT * FROM site_partner ORDER BY kind, sort_order, name")
).rows;

const getPartner = async (client, id) => (
  await client.query("SELECT * FROM site_partner WHERE partner_id = $1", [id])
).rows[0] || null;

async function createPartner(client, patch, actorId) {
  const cols = PARTNER_COLUMNS.filter((c) => patch[c] !== undefined);
  const vals = cols.map((c) => patch[c]);
  vals.push(actorId || null);
  const { rows } = await client.query(
    `INSERT INTO site_partner (${cols.concat("updated_by").join(", ")})
          VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    vals,
  );
  return rows[0];
}

async function updatePartner(client, id, patch, actorId) {
  const cols = PARTNER_COLUMNS.filter((c) => patch[c] !== undefined);
  if (!cols.length) return getPartner(client, id);
  const vals = cols.map((c) => patch[c]);
  vals.push(actorId || null, id);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  sets.push(`updated_by = $${vals.length - 1}`, "updated_at = now()");
  const { rows } = await client.query(
    `UPDATE site_partner SET ${sets.join(", ")} WHERE partner_id = $${vals.length} RETURNING *`,
    vals,
  );
  return rows[0] || null;
}

const deletePartner = async (client, id) =>
  (await client.query("DELETE FROM site_partner WHERE partner_id = $1", [id])).rowCount > 0;

/* ── credentials ────────────────────────────────────────────────────────────*/

const CREDENTIAL_COLUMNS = ["name", "issuer", "identifier", "issued_on", "expires_on", "url", "sort_order", "is_active", "logo_vault_id"];

const listCredentials = async (client) => (
  await client.query("SELECT * FROM site_credential ORDER BY sort_order, name")
).rows;

const getCredential = async (client, id) => (
  await client.query("SELECT * FROM site_credential WHERE credential_id = $1", [id])
).rows[0] || null;

async function createCredential(client, patch, actorId) {
  const cols = CREDENTIAL_COLUMNS.filter((c) => patch[c] !== undefined);
  const vals = cols.map((c) => patch[c]);
  vals.push(actorId || null);
  const { rows } = await client.query(
    `INSERT INTO site_credential (${cols.concat("updated_by").join(", ")})
          VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    vals,
  );
  return rows[0];
}

async function updateCredential(client, id, patch, actorId) {
  const cols = CREDENTIAL_COLUMNS.filter((c) => patch[c] !== undefined);
  if (!cols.length) return getCredential(client, id);
  const vals = cols.map((c) => patch[c]);
  vals.push(actorId || null, id);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  sets.push(`updated_by = $${vals.length - 1}`, "updated_at = now()");
  const { rows } = await client.query(
    `UPDATE site_credential SET ${sets.join(", ")} WHERE credential_id = $${vals.length} RETURNING *`,
    vals,
  );
  return rows[0] || null;
}

const deleteCredential = async (client, id) =>
  (await client.query("DELETE FROM site_credential WHERE credential_id = $1", [id])).rowCount > 0;

/* ── about ──────────────────────────────────────────────────────────────────*/

const ABOUT_COLUMNS = [
  "headline_fr", "headline_en", "summary_fr", "summary_en",
  "mission_fr", "mission_en", "vision_fr", "vision_en",
  "principles", "esg", "timeline", "founded_year", "headquarters",
];
const ABOUT_JSON = new Set(["principles", "esg", "timeline"]);

const getAbout = async (client) =>
  (await client.query("SELECT * FROM site_about LIMIT 1")).rows[0] || null;

async function updateAbout(client, patch, actorId) {
  const cols = ABOUT_COLUMNS.filter((c) => patch[c] !== undefined);
  if (!cols.length) return getAbout(client);
  // jsonb columns are stringified here rather than at the call site: node-pg
  // sends a JS object as a Postgres record literal, not as json, and the
  // failure is a 22P02 that names neither the column nor the reason.
  const vals = cols.map((c) => (ABOUT_JSON.has(c) ? JSON.stringify(patch[c]) : patch[c]));
  vals.push(actorId || null);
  const sets = cols.map((c, i) => `${c} = $${i + 1}${ABOUT_JSON.has(c) ? "::jsonb" : ""}`);
  sets.push(`updated_by = $${vals.length}`, "updated_at = now()");
  const { rows } = await client.query(
    `UPDATE site_about SET ${sets.join(", ")} WHERE singleton = true RETURNING *`,
    vals,
  );
  return rows[0] || null;
}

/* ── leadership ─────────────────────────────────────────────────────────────*/

const LEADER_COLUMNS = ["entity_id", "full_name", "role_fr", "role_en", "bio_fr", "bio_en", "linkedin_url", "sort_order", "is_active", "photo_vault_id"];

/** `entity_id IS NULL` is group leadership — the whole two-tier mechanism.
 *  `undefined` here means "every tier"; `null` means "the group's". */
async function listLeaders(client, { entityId = undefined } = {}) {
  if (entityId === undefined) {
    return (await client.query("SELECT * FROM site_leader ORDER BY entity_id NULLS FIRST, sort_order, full_name")).rows;
  }
  if (entityId === null) {
    return (await client.query("SELECT * FROM site_leader WHERE entity_id IS NULL ORDER BY sort_order, full_name")).rows;
  }
  return (await client.query("SELECT * FROM site_leader WHERE entity_id = $1 ORDER BY sort_order, full_name", [entityId])).rows;
}

const getLeader = async (client, id) =>
  (await client.query("SELECT * FROM site_leader WHERE leader_id = $1", [id])).rows[0] || null;

async function createLeader(client, patch, actorId) {
  const cols = LEADER_COLUMNS.filter((c) => patch[c] !== undefined);
  const vals = cols.map((c) => patch[c]);
  vals.push(actorId || null);
  const { rows } = await client.query(
    `INSERT INTO site_leader (${cols.concat("updated_by").join(", ")})
          VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
    vals,
  );
  return rows[0];
}

async function updateLeader(client, id, patch, actorId) {
  const cols = LEADER_COLUMNS.filter((c) => patch[c] !== undefined);
  if (!cols.length) return getLeader(client, id);
  const vals = cols.map((c) => patch[c]);
  vals.push(actorId || null, id);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  sets.push(`updated_by = $${vals.length - 1}`, "updated_at = now()");
  const { rows } = await client.query(
    `UPDATE site_leader SET ${sets.join(", ")} WHERE leader_id = $${vals.length} RETURNING *`,
    vals,
  );
  return rows[0] || null;
}

const deleteLeader = async (client, id) =>
  (await client.query("DELETE FROM site_leader WHERE leader_id = $1", [id])).rowCount > 0;

/* ── an entity's public story ───────────────────────────────────────────────*/

const ENTITY_STORY_COLUMNS = ["public_enabled", "public_summary_fr", "public_summary_en", "public_coverage", "public_focus", "public_cover_vault_id"];
const ENTITY_JSON = new Set(["public_coverage", "public_focus"]);

async function updateEntityStory(client, entityId, patch) {
  const cols = ENTITY_STORY_COLUMNS.filter((c) => patch[c] !== undefined);
  if (!cols.length) return getEntityStory(client, entityId);
  const vals = cols.map((c) => (ENTITY_JSON.has(c) ? JSON.stringify(patch[c]) : patch[c]));
  vals.push(entityId);
  const sets = cols.map((c, i) => `${c} = $${i + 1}${ENTITY_JSON.has(c) ? "::jsonb" : ""}`);
  const { rows } = await client.query(
    `UPDATE corporate_entity SET ${sets.join(", ")} WHERE entity_id = $${vals.length}
       RETURNING entity_id, code, legal_name, trading_name, country_code,
                 public_enabled, public_summary_fr, public_summary_en,
                 public_coverage, public_focus, public_cover_vault_id`,
    vals,
  );
  return rows[0] || null;
}

async function getEntityStory(client, entityId) {
  const { rows } = await client.query(
    `SELECT entity_id, code, legal_name, trading_name, country_code,
            public_enabled, public_summary_fr, public_summary_en,
            public_coverage, public_focus, public_cover_vault_id
       FROM corporate_entity WHERE entity_id = $1`,
    [entityId],
  );
  return rows[0] || null;
}

module.exports = {
  THEME_COLUMNS, PARTNER_COLUMNS, CREDENTIAL_COLUMNS, ABOUT_COLUMNS, LEADER_COLUMNS, ENTITY_STORY_COLUMNS,
  getTheme, updateTheme,
  listSocial, setSocial, clearSocial,
  listPartners, getPartner, createPartner, updatePartner, deletePartner,
  listCredentials, getCredential, createCredential, updateCredential, deleteCredential,
  getAbout, updateAbout,
  listLeaders, getLeader, createLeader, updateLeader, deleteLeader,
  getEntityStory, updateEntityStory,
};
