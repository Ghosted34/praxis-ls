"use strict";

/**
 * Pages, blocks, and the metric resolution that makes a stat true.
 */

const { atomically } = require("../../../shared/db/tx");
const { audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const events = require("./site_content.events");
const repo = require("./site_content.repo");
const { validateBlock } = require("./site_content.schema");
const { REGISTRY, resolveMetric } = require("./site_content.metrics");

const pageRef = (id) => `site_page:${id}`;
const blockRef = (id) => `site_block:${id}`;

/* ── what the editor needs before it can draw anything ────────────────────── */

/**
 * Two facts the website editor cannot get anywhere else, in one read.
 *
 * ── `website_enabled` ─────────────────────────────────────────────────────
 *
 * The commercial switch, from `feature_state` — the same row `requireFeature`
 * checks before it lets `site_public` answer. This module is deliberately NOT
 * gated on it (an editor must be able to prepare a site before the package is
 * bought), so the flag is INFORMATION here rather than enforcement: the client
 * uses it to decide whether to offer the screen, and to say on the screen that
 * the public site is dark. Nothing on this router refuses because of it.
 *
 * ── `metrics` ─────────────────────────────────────────────────────────────
 *
 * The keys a `stat_counters` item may legally bind to. The editor has to offer
 * a CHOICE of them, and the only alternative to sending the list is a second
 * copy of the registry typed into the client — which drifts the first time a
 * metric is added, in the direction nobody notices: a key still in the dropdown
 * after it stopped existing is a 422 at save time with no explanation, and one
 * that exists but is missing from the dropdown is simply unreachable.
 *
 * `unit` travels with the key because it is the registry's own answer to "what
 * is this number measured in", and the editor prefills the item's unit from it
 * rather than expecting a marketing person to know that CBM is cubic metres.
 */
async function editorMeta(client) {
  const { rows } = await client.query(
    "SELECT state FROM feature_state WHERE feature_key = $1",
    ["website"],
  );
  return {
    website_enabled: !!(rows[0] && rows[0].state === "on"),
    metrics: [...REGISTRY.values()].map((m) => ({ key: m.key, unit: m.unit })),
  };
}

/* ── the public read ─────────────────────────────────────────────────────── */

/**
 * Resolve every metric a page's stat blocks name, ONCE each.
 *
 * Two stat blocks naming the same metric — plausible, since a tenant may repeat
 * a headline number on Home and in a band lower down — must not run the query
 * twice on one page render. The keys are collected, deduplicated, resolved in
 * parallel, and the map is then applied.
 *
 * @returns {Promise<Map<string, number>>} resolved values, missing where the
 *   metric is unknown or failed. A missing entry means "use the literal".
 */
async function resolveMetricsFor(client, blocks) {
  const keys = new Set();
  for (const block of blocks) {
    if (block.type !== "stat_counters") continue;
    for (const item of (block.content && block.content.items) || []) {
      if (item && item.metric_key) keys.add(item.metric_key);
    }
  }
  if (keys.size === 0) return new Map();

  const pairs = await Promise.all(
    [...keys].map(async (key) => [key, await resolveMetric(client, key)]),
  );
  return new Map(pairs.filter(([, value]) => value !== null));
}

/**
 * Overwrite a stat's literal with its resolved value where one exists.
 *
 * The renderer reads `value` and nothing else — it is never handed a decision
 * about which of two numbers to trust. `metric_key` is dropped from the public
 * payload: it names an internal query and tells a visitor nothing.
 */
function applyMetrics(block, resolved) {
  if (block.type !== "stat_counters") return block;
  const items = ((block.content && block.content.items) || []).map((item) => {
    const { metric_key: key, ...rest } = item || {};
    const live = key ? resolved.get(key) : undefined;
    return live === undefined ? rest : { ...rest, value: live };
  });
  return { ...block, content: { ...block.content, items } };
}

/**
 * One published page, blocks in order, metrics resolved.
 *
 * 404 rather than an empty page for an unpublished or unknown key: a page that
 * does not exist and a page not yet published are the same fact to a visitor,
 * and rendering an empty shell would let half-written copy leak as a URL that
 * returns 200.
 */
async function getPublicPage(client, key) {
  const page = await repo.getPageByKey(client, key, { publishedOnly: true });
  if (!page) throw new AppError("NOT_FOUND", "Page not found", 404);

  const blocks = await repo.listBlocks(client, page.page_id, { visibleOnly: true });
  const resolved = await resolveMetricsFor(client, blocks);

  return {
    key: page.key,
    title_fr: page.title_fr,
    title_en: page.title_en,
    slug_fr: page.slug_fr,
    slug_en: page.slug_en,
    meta_title_fr: page.meta_title_fr,
    meta_title_en: page.meta_title_en,
    meta_description_fr: page.meta_description_fr,
    meta_description_en: page.meta_description_en,
    blocks: blocks.map((block) => {
      const withMetrics = applyMetrics(block, resolved);
      return {
        block_id: withMetrics.block_id,
        type: withMetrics.type,
        content: withMetrics.content,
      };
    }),
  };
}

/** The nav — published pages only, in nav order. */
async function listPublicPages(client) {
  const pages = await repo.listPages(client);
  return pages
    .filter((p) => p.is_published)
    .map((p) => ({
      key: p.key,
      title_fr: p.title_fr,
      title_en: p.title_en,
      slug_fr: p.slug_fr,
      slug_en: p.slug_en,
    }));
}

/* ── admin ───────────────────────────────────────────────────────────────── */

const listPages = (client) => repo.listPages(client);

async function getPageTab(client, pageId) {
  const page = await repo.getPage(client, pageId);
  if (!page) throw new AppError("NOT_FOUND", "Page not found", 404);
  // Editor sees hidden blocks: one that could not see them could not unhide.
  const blocks = await repo.listBlocks(client, pageId, { visibleOnly: false });
  return { page, blocks };
}

async function createPage(client, { patch, actor = {} }) {
  if (await repo.pageKeyTaken(client, patch.key)) {
    throw new AppError("KEY_TAKEN", `A page already uses the key "${patch.key}"`, 422, {
      key: ["already in use"],
    });
  }
  return atomically(client, async () => {
    const row = await repo.createPage(client, patch);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.PAGE_CREATED,
      moduleKey: events.MODULE,
      entityRef: pageRef(row.page_id),
      before: null,
      after: row,
    });
    return row;
  });
}

async function updatePage(client, { pageId, patch, actor = {} }) {
  const before = await repo.getPage(client, pageId);
  if (!before) throw new AppError("NOT_FOUND", "Page not found", 404);
  if (patch.key && patch.key !== before.key
      && await repo.pageKeyTaken(client, patch.key, pageId)) {
    throw new AppError("KEY_TAKEN", `A page already uses the key "${patch.key}"`, 422, {
      key: ["already in use"],
    });
  }
  return atomically(client, async () => {
    const row = await repo.updatePage(client, pageId, patch);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.PAGE_UPDATED,
      moduleKey: events.MODULE,
      entityRef: pageRef(pageId),
      before,
      after: row,
    });
    return row;
  });
}

/**
 * Publishing refuses an empty page.
 *
 * A page with no visible blocks renders as a header and a footer around
 * nothing. Publishing it puts a blank page on a client's domain, and the
 * tenant would discover it from a customer rather than from us.
 */
async function setPublished(client, { pageId, published, actor = {} }) {
  const before = await repo.getPage(client, pageId);
  if (!before) throw new AppError("NOT_FOUND", "Page not found", 404);
  if (published) {
    const blocks = await repo.listBlocks(client, pageId, { visibleOnly: true });
    if (blocks.length === 0) {
      throw new AppError("EMPTY_PAGE", "Add at least one visible block before publishing", 422);
    }
  }
  return atomically(client, async () => {
    const row = await repo.setPublished(client, pageId, actor.user_id || null, published);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: published ? events.PAGE_PUBLISHED : events.PAGE_UNPUBLISHED,
      moduleKey: events.MODULE,
      entityRef: pageRef(pageId),
      before,
      after: row,
    });
    return row;
  });
}

async function deletePage(client, { pageId, actor = {} }) {
  const before = await repo.getPage(client, pageId);
  if (!before) throw new AppError("NOT_FOUND", "Page not found", 404);
  // Deleting a LIVE page would 404 a URL that is in search results and on
  // printed material. Unpublish first, deliberately, then delete.
  if (before.is_published) {
    throw new AppError("PUBLISHED", "Unpublish the page before deleting it", 422);
  }
  return atomically(client, async () => {
    await repo.deletePage(client, pageId);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.PAGE_DELETED,
      moduleKey: events.MODULE,
      entityRef: pageRef(pageId),
      before,
      after: null,
    });
    return { deleted: true };
  });
}

/* ── blocks ──────────────────────────────────────────────────────────────── */

/**
 * Content is validated against the type's schema before it is stored.
 *
 * This is the only guarantee there is: `content` is jsonb, so nothing in the
 * database will refuse a bad shape. A 422 here names the offending fields; the
 * alternative is a block that saves and then renders as nothing.
 */
function checkContent(type, content) {
  const parsed = validateBlock(type, content);
  if (!parsed.ok) {
    throw new AppError("VALIDATION_ERROR", `Invalid content for a ${type} block`, 422, parsed.errors);
  }
  return parsed.data;
}

async function createBlock(client, { pageId, patch, actor = {} }) {
  const page = await repo.getPage(client, pageId);
  if (!page) throw new AppError("NOT_FOUND", "Page not found", 404);
  const content = checkContent(patch.type, patch.content);
  return atomically(client, async () => {
    const row = await repo.createBlock(client, pageId, { ...patch, content });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.BLOCK_CREATED,
      moduleKey: events.MODULE,
      entityRef: blockRef(row.block_id),
      before: null,
      after: row,
    });
    return row;
  });
}

async function updateBlock(client, { blockId, patch, actor = {} }) {
  const before = await repo.getBlock(client, blockId);
  if (!before) throw new AppError("NOT_FOUND", "Block not found", 404);
  const next = { ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "content")) {
    // Validated against the block's EXISTING type: a block's type is fixed at
    // creation, because changing it would leave content shaped for the old one.
    next.content = checkContent(before.type, patch.content);
  }
  return atomically(client, async () => {
    const row = await repo.updateBlock(client, blockId, next);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.BLOCK_UPDATED,
      moduleKey: events.MODULE,
      entityRef: blockRef(blockId),
      before,
      after: row,
    });
    return row;
  });
}

async function deleteBlock(client, { blockId, actor = {} }) {
  const before = await repo.getBlock(client, blockId);
  if (!before) throw new AppError("NOT_FOUND", "Block not found", 404);
  return atomically(client, async () => {
    await repo.deleteBlock(client, blockId);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.BLOCK_DELETED,
      moduleKey: events.MODULE,
      entityRef: blockRef(blockId),
      before,
      after: null,
    });
    return { deleted: true };
  });
}

/**
 * Reorder refuses a partial list.
 *
 * Sending some of a page's blocks would leave the omitted ones on their old
 * positions, interleaved with the new ones in a way the caller did not ask for
 * and cannot predict. The whole page's order is the unit.
 */
async function reorderBlocks(client, { pageId, orderedIds, actor = {} }) {
  const page = await repo.getPage(client, pageId);
  if (!page) throw new AppError("NOT_FOUND", "Page not found", 404);
  const current = await repo.listBlocks(client, pageId, { visibleOnly: false });
  const currentIds = new Set(current.map((b) => b.block_id));
  const sent = new Set(orderedIds);
  if (sent.size !== orderedIds.length) {
    throw new AppError("VALIDATION_ERROR", "Duplicate block ids", 422);
  }
  if (sent.size !== currentIds.size || [...sent].some((id) => !currentIds.has(id))) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Send every block on the page, exactly once",
      422,
      { block_ids: [`expected ${currentIds.size}, received ${sent.size}`] },
    );
  }
  return atomically(client, async () => {
    const moved = await repo.reorderBlocks(client, pageId, orderedIds);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.BLOCKS_REORDERED,
      moduleKey: events.MODULE,
      entityRef: pageRef(pageId),
      before: { order: current.map((b) => b.block_id) },
      after: { order: orderedIds },
    });
    return { reordered: moved };
  });
}

module.exports = {
  // the editor's own bootstrap
  editorMeta,
  // public
  getPublicPage,
  listPublicPages,
  resolveMetricsFor,
  applyMetrics,
  // admin
  listPages,
  getPageTab,
  createPage,
  updatePage,
  setPublished,
  deletePage,
  createBlock,
  updateBlock,
  deleteBlock,
  reorderBlocks,
};
