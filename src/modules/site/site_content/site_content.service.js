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
/* Deep path for the reason site_content.schema.js states: the catalogue is not
   on the shared package's index, because only one side of the wire bundles it. */
const {
  isSiteCopyKey,
  SITE_COPY_ENTRIES,
  SITE_COPY_SECTIONS,
} = require("../../../../packages/shared/data/site-copy.generated");

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

/* ── the copy overlay ──────────────────────────────────────────────────────
 *
 * ── WHAT THIS ANSWERS, AND WHY IT IS ITS OWN ENDPOINT ─────────────────────
 *
 * `GET /public/site/pages/:key` answers "what did the tenant put ON this
 * page". This answers a different question: "which of the words PRAXIS puts on
 * every page has this tenant rewritten". The two do not belong in one payload,
 * because their consumers differ — the page read is per route and the overlay
 * is global (a footer disclaimer and a 404 heading have no page of their own),
 * and because the overlay has to be applied BEFORE the first paint of any
 * route, which a per-route read cannot promise.
 *
 * ── THE SHAPE IS A NESTED TREE, NOT A FLAT MAP ────────────────────────────
 *
 * `{ en: { site: { portfolioPage: { titleMain: "…" } } } }`, because that is
 * what i18next's `addResourceBundle` merges — and handing the renderer a flat
 * `{"site.portfolioPage.titleMain": "…"}` would mean the client re-splitting
 * every key on "." and building this tree itself, in a bundle whose whole
 * design constraint is size. Building it here costs one pass over rows already
 * in memory.
 *
 * ── LAST WRITER WINS, AND THAT IS DELIBERATE ──────────────────────────────
 *
 * Two published pages may both override `site.footer.legal` — nothing stops a
 * tenant adding a copy block to each page and editing the footer from
 * whichever one they had open. The repo orders by the page's own nav order, so
 * the LAST page's value wins and the result is at least stable between
 * requests. It is not arbitration: the editor writes one copy block on one page
 * and there is no second place to put one. A merge that tried to be clever —
 * first-writer, or per-section ownership — would make "why is my footer still
 * the old text" depend on nav order, which is a worse thing to explain than
 * "the most recent page you edited it on is the one that counts".
 *
 * ── KEYS ARE RE-CHECKED ON READ ───────────────────────────────────────────
 *
 * The write path already refuses a key the catalogue does not know. This checks
 * again, because the catalogue is a build artefact and the row is data: a key
 * RETIRED from the dictionary in a later deploy is a row that was valid when it
 * was written and is meaningless now. Dropping it here means the shipped
 * sentence comes back on its own, rather than a `site.oldThing.title` override
 * sitting in a table for a page that no longer reads it.
 */
/** Segments that would reach the prototype chain instead of the tree. */
const UNSAFE_SEGMENT = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Write `value` at a dotted path, creating the objects on the way.
 *
 * ── WHY THIS GUARDS A KEY THE CATALOGUE ALREADY VETTED ────────────────────
 *
 * Every key reaching here has passed `isSiteCopyKey`, so by construction it is
 * a dictionary path and cannot be `__proto__`. The guard is here anyway,
 * because that argument is about the catalogue and this function is about
 * assignment: it holds only as long as nobody ever calls `setPath` from
 * somewhere else, and "safe because of what the only caller happens to do
 * today" is exactly the property that stops being true without anyone
 * noticing. The cost is a `Set` lookup per segment on a read that is cached
 * for five minutes.
 *
 * Null-prototype objects for the same reason. They serialise identically —
 * `JSON.stringify` ignores the prototype — so the wire format is unchanged,
 * and there is no inherited property left for a key to collide with.
 */
function setPath(tree, dotted, value) {
  const parts = dotted.split(".");
  if (parts.some((part) => UNSAFE_SEGMENT.has(part))) return;
  let node = tree;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    // `hasOwnProperty`, not a truthiness test on `node[part]`: the latter reads
    // through the prototype, so on a plain `{}` a segment named `toString`
    // would find the inherited function, decide the level already existed, and
    // then try to walk into it.
    if (
      !Object.prototype.hasOwnProperty.call(node, part) ||
      !node[part] ||
      typeof node[part] !== "object"
    ) {
      node[part] = Object.create(null);
    }
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

/**
 * The tenant's rewritten strings, as an i18next resource tree per language.
 *
 * English falls back to French rather than to the shipped English, which looks
 * backwards and is not: `bi()` makes FR required and EN optional across this
 * whole schema, so a tenant who writes only French has said something
 * deliberate about every language their site is read in. Half-overriding a
 * heading — their words in French, ours in English — is the one outcome nobody
 * would choose on purpose.
 */
async function getPublicCopy(client) {
  const rows = await repo.listPublishedCopyOverrides(client);
  // Null-prototype roots, matching what `setPath` creates below.
  const en = Object.create(null);
  const fr = Object.create(null);
  for (const row of rows) {
    const items = Array.isArray(row?.content?.items) ? row.content.items : [];
    for (const item of items) {
      const key = typeof item?.key === "string" ? item.key : "";
      // The catalogue is the allow-list: every key in it starts `site.` and is
      // a dictionary path. `setPath` guards the prototype chain a second time
      // rather than trusting that — see the note on it.
      if (!key || !isSiteCopyKey(key)) continue;
      const frText = typeof item?.value?.fr === "string" ? item.value.fr : "";
      if (!frText) continue;
      const enText = typeof item?.value?.en === "string" && item.value.en ? item.value.en : frText;
      setPath(fr, key, frText);
      setPath(en, key, enText);
    }
  }
  return { en, fr };
}

/** The catalogue itself — what the EDITOR needs to draw a form.
 *
 *  Served rather than bundled: 465 strings in two languages is ~60 kB of
 *  defaults that only one screen in the ERP has any use for, and the shared
 *  package it lives in is imported by the API for validation. Shipping it into
 *  the client bundle would put it in front of every user of the product to
 *  benefit the few who edit the website. */
function copyCatalogue() {
  return {
    sections: SITE_COPY_SECTIONS,
    entries: SITE_COPY_ENTRIES.map(([key, section, label, en, fr]) => ({
      key,
      section,
      label,
      default_en: en,
      default_fr: fr,
    })),
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

/**
 * Keys that identify a row the product itself depends on finding.
 *
 * `site-copy` carries the `copy_overrides` block — the tenant's wording for the
 * sentences the app prints — and the public overlay read matches on the block
 * type, not on this key, so a rename does not break the SITE. It breaks the
 * EDITOR: `website-copy.tsx` finds its row by key, and a renamed one is a
 * screen that silently opens empty and writes a second set of overrides
 * alongside the first, which then both apply in nav order. Refusing the rename
 * is cheaper to explain than that is to debug.
 *
 * Creation is deliberately NOT refused: the Wording screen creates this row
 * through the same endpoint on its first save, and the service cannot tell that
 * caller from any other. `pageKeyTaken` already makes a second one impossible.
 */
const RESERVED_PAGE_KEYS = new Set(["site-copy"]);

const reserved = (key) => RESERVED_PAGE_KEYS.has(String(key || "").toLowerCase());

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
  // Both directions. Renaming the reserved row away orphans the Wording
  // screen; renaming an ordinary page INTO the reserved key makes that page
  // disappear from the editor's own list, which is the same defect wearing the
  // other hat.
  if (patch.key && patch.key !== before.key && (reserved(patch.key) || reserved(before.key))) {
    throw new AppError("KEY_RESERVED", `The key "${reserved(patch.key) ? patch.key : before.key}" is reserved`, 422, {
      key: ["reserved — this row is managed by Settings › Website › Wording"],
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
  // The reserved row holds every override a tenant has written, across the
  // whole site, in both languages. There is no undo and no export, and the
  // failure is silent: the public site simply goes back to the shipped
  // wording. Clearing the fields in the Wording screen is the gesture for
  // "I no longer want my text" — it is reversible until they save.
  if (reserved(before.key)) {
    throw new AppError("KEY_RESERVED", `The page "${before.key}" is managed by the Wording screen and cannot be deleted`, 422);
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
  getPublicCopy,
  copyCatalogue,
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
