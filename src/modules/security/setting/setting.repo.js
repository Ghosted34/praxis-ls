/** Settings repository (MOD-70). Keyed by (section, key); upsert bumps version. */
"use strict";

async function listAll(client) {
  const { rows } = await client.query("SELECT section, key, value, version, updated_at FROM setting ORDER BY section, key");
  return rows;
}
async function listSections(client) {
  const { rows } = await client.query("SELECT DISTINCT section FROM setting ORDER BY section");
  return rows.map((r) => r.section);
}
async function getSection(client, section) {
  const { rows } = await client.query("SELECT key, value, version, updated_at FROM setting WHERE section = $1 ORDER BY key", [section]);
  return rows;
}
async function getByKey(client, section, key) {
  const { rows } = await client.query("SELECT section, key, value, version, updated_at FROM setting WHERE section = $1 AND key = $2", [section, key]);
  return rows[0] || null;
}
async function upsert(client, { section, key, value, updatedBy }) {
  const { rows } = await client.query(
    "INSERT INTO setting (section, key, value, updated_by) VALUES ($1,$2,$3::jsonb,$4) " +
      "ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value, version = setting.version + 1, " +
      "updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *",
    [section, key, JSON.stringify(value ?? {}), updatedBy || null],
  );
  return rows[0];
}
async function remove(client, section, key) {
  const { rowCount } = await client.query("DELETE FROM setting WHERE section = $1 AND key = $2", [section, key]);
  return rowCount > 0;
}
module.exports = { listAll, listSections, getSection, getByKey, upsert, remove };
