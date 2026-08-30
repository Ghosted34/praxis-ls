"use strict";

/**
 * Pages and blocks (migration 12753). Parameterised SQL only — assembly,
 * validation and metric resolution all live in the service.
 */

/** Admin list — includes unpublished pages, which the public read never sees. */
async function listPages(client) {
  const { rows } = await client.query(
    `SELECT p.*, COUNT(b.block_id)::int AS block_count
       FROM site_page p
       LEFT JOIN site_block b ON b.page_id = p.page_id
      GROUP BY p.page_id
      ORDER BY p.sort_order ASC, p.key ASC`,
  );
  return rows;
}

async function getPageByKey(client, key, { publishedOnly = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM site_page
      WHERE key = $1 AND ($2::boolean = false OR is_published = true)
      LIMIT 1`,
    [key, publishedOnly],
  );
  return rows[0] || null;
}

async function getPage(client, pageId) {
  const { rows } = await client.query(
    "SELECT * FROM site_page WHERE page_id = $1",
    [pageId],
  );
  return rows[0] || null;
}

async function pageKeyTaken(client, key, exceptId = null) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM site_page
      WHERE key = $1 AND ($2::uuid IS NULL OR page_id <> $2) LIMIT 1`,
    [key, exceptId],
  );
  return rowCount > 0;
}

const PAGE_COLUMNS = [
  "key",
  "title_fr", "title_en",
  "slug_fr", "slug_en",
  "meta_title_fr", "meta_title_en",
  "meta_description_fr", "meta_description_en",
  "sort_order",
];

async function createPage(client, patch) {
  const cols = PAGE_COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(patch, c));
  const params = cols.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await client.query(
    `INSERT INTO site_page (${cols.join(", ")}) VALUES (${params}) RETURNING *`,
    cols.map((c) => patch[c]),
  );
  return rows[0];
}

/** Omitted keys unchanged. Publish state is NOT settable here — see setPublished. */
async function updatePage(client, pageId, patch) {
  const cols = PAGE_COLUMNS.filter((c) => Object.prototype.hasOwnProperty.call(patch, c));
  if (cols.length === 0) return getPage(client, pageId);
  const set = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
  const { rows } = await client.query(
    `UPDATE site_page SET ${set}, updated_at = now() WHERE page_id = $1 RETURNING *`,
    [pageId, ...cols.map((c) => patch[c])],
  );
  return rows[0] || null;
}

/**
 * Publish is its own writer, not a column on the patch.
 *
 * Publishing stamps who and when, and the stamp is the audit trail for "who put
 * this on the client's website". A caller that could set `is_published` through
 * the ordinary update would set the flag without the stamp.
 */
async function setPublished(client, pageId, actorUserId, published) {
  const { rows } = await client.query(
    `UPDATE site_page
        SET is_published = $3,
            published_at = CASE WHEN $3 THEN now() ELSE NULL END,
            published_by = CASE WHEN $3 THEN $2::uuid ELSE NULL END,
            updated_at = now()
      WHERE page_id = $1
      RETURNING *`,
    [pageId, actorUserId, published],
  );
  return rows[0] || null;
}

async function deletePage(client, pageId) {
  const { rows } = await client.query(
    "DELETE FROM site_page WHERE page_id = $1 RETURNING *",
    [pageId],
  );
  return rows[0] || null;
}

/* ── blocks ──────────────────────────────────────────────────────────────── */

/**
 * @param {boolean} visibleOnly the public read passes true; the editor false,
 *   because an editor that could not see a hidden block could not unhide it.
 */
async function listBlocks(client, pageId, { visibleOnly = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM site_block
      WHERE page_id = $1 AND ($2::boolean = false OR is_visible = true)
      ORDER BY sort_order ASC, created_at ASC`,
    [pageId, visibleOnly],
  );
  return rows;
}

async function getBlock(client, blockId) {
  const { rows } = await client.query(
    "SELECT * FROM site_block WHERE block_id = $1",
    [blockId],
  );
  return rows[0] || null;
}

async function createBlock(client, pageId, { type, content, sort_order, is_visible }) {
  const { rows } = await client.query(
    `INSERT INTO site_block (page_id, type, content, sort_order, is_visible)
          VALUES ($1, $2, $3::jsonb, COALESCE($4, 100), COALESCE($5, true))
       RETURNING *`,
    [pageId, type, JSON.stringify(content ?? {}), sort_order ?? null, is_visible ?? null],
  );
  return rows[0];
}

/**
 * `content` is replaced wholesale, never merged.
 *
 * A block's content is one edited document — the editor sends the whole thing.
 * Deep-merging would make it impossible to REMOVE an item from a list, which is
 * the operation a tenant reaches for most often after adding one.
 */
async function updateBlock(client, blockId, patch) {
  const sets = [];
  const params = [blockId];
  if (Object.prototype.hasOwnProperty.call(patch, "content")) {
    params.push(JSON.stringify(patch.content ?? {}));
    sets.push(`content = $${params.length}::jsonb`);
  }
  for (const col of ["sort_order", "is_visible"]) {
    if (Object.prototype.hasOwnProperty.call(patch, col)) {
      params.push(patch[col]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (sets.length === 0) return getBlock(client, blockId);
  const { rows } = await client.query(
    `UPDATE site_block SET ${sets.join(", ")}, updated_at = now()
      WHERE block_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteBlock(client, blockId) {
  const { rows } = await client.query(
    "DELETE FROM site_block WHERE block_id = $1 RETURNING *",
    [blockId],
  );
  return rows[0] || null;
}

/**
 * Reorder in one statement rather than a loop of updates.
 *
 * A loop would leave the page half-reordered if it failed midway, and the page
 * is what a visitor sees. The UPDATE ... FROM applies every position or none,
 * and is scoped to the page so an id from another page cannot be moved by
 * passing it here.
 */
async function reorderBlocks(client, pageId, orderedIds) {
  const { rows } = await client.query(
    `UPDATE site_block b
        SET sort_order = v.pos, updated_at = now()
       FROM (SELECT id, ordinality * 10 AS pos
               FROM unnest($2::uuid[]) WITH ORDINALITY AS t(id, ordinality)) v
      WHERE b.block_id = v.id AND b.page_id = $1
      RETURNING b.block_id`,
    [pageId, orderedIds],
  );
  return rows.length;
}

module.exports = {
  PAGE_COLUMNS,
  listPages,
  getPage,
  getPageByKey,
  pageKeyTaken,
  createPage,
  updatePage,
  setPublished,
  deletePage,
  listBlocks,
  getBlock,
  createBlock,
  updateBlock,
  deleteBlock,
  reorderBlocks,
};
