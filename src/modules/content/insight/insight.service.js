"use strict";

/**
 * Insights — the tenant's own articles (WS5).
 *
 * The public shapes live here rather than in the routes because two callers
 * need them: the public read, and `shared/http/public-head.js`, which builds the
 * `<head>` and the `Article` JSON-LD for a crawler that never runs the app.
 */

const { atomically } = require("../../../shared/db/tx");
const { audit, emitEvent } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const events = require("./insight.events");
const repo = require("./insight.repo");

const ref = (id) => `insight_article:${id}`;

/* ── shapes ──────────────────────────────────────────────────────────────── */

/**
 * The author, as a visitor may see them.
 *
 * Built explicitly rather than by deleting from the row: `app_user` carries a
 * password hash, a TOTP secret and a login history, and a denylist on an
 * anonymous endpoint fails OPEN the next time that table grows a column.
 *
 * Null when nobody is attached. An article whose author has left is
 * unattributed rather than attributed to a blank — the FK is ON DELETE SET NULL
 * precisely so the piece outlives the colleague.
 */
function publicAuthor(row) {
  if (!row.author_user_id || !row.author_name) return null;
  return {
    name: row.author_name,
    title: row.author_title || null,
    avatar_ref: row.author_avatar_ref || null,
  };
}

/**
 * A card in the index. Excerpt and date included, because their site has
 * neither and a knowledge hub that cannot show recency is not credible.
 */
function publicCard(row) {
  return {
    slug_fr: row.slug_fr,
    slug_en: row.slug_en,
    title_fr: row.title_fr,
    title_en: row.title_en,
    excerpt_fr: row.excerpt_fr,
    excerpt_en: row.excerpt_en,
    tags: row.tags || [],
    published_at: row.published_at,
    has_cover: !!row.cover_vault_id,
    cover_id: row.cover_vault_id || null,
    author: publicAuthor(row),
  };
}

/** The article itself. The card, plus the body and the meta the head needs. */
function publicArticle(row) {
  return {
    ...publicCard(row),
    body_fr: row.body_fr,
    body_en: row.body_en,
    meta_title_fr: row.meta_title_fr,
    meta_title_en: row.meta_title_en,
    meta_description_fr: row.meta_description_fr,
    meta_description_en: row.meta_description_en,
  };
}

/* ── the public read ─────────────────────────────────────────────────────── */

const DEFAULT_PER_PAGE = 9;

/**
 * One page of published articles, plus the filter bar's own contents.
 *
 * The tag list ships WITH the page rather than from a second endpoint, and it is
 * derived from the tags in use. Their filter bar is four hardcoded buttons over
 * six tags in the data, so two articles cannot be reached by any filter — a bug
 * that is invisible until somebody counts. A derived list cannot have it.
 *
 * The list is deliberately NOT filtered down to the tag when computing the bar:
 * a visitor who has narrowed to "strategy" still needs the other tags in front
 * of them, or the only way back is the browser's Back button.
 */
async function listPublic(client, { tag = null, page = 1, perPage = DEFAULT_PER_PAGE } = {}) {
  const offset = (page - 1) * perPage;
  const [rows, total, tags] = await Promise.all([
    repo.list(client, { publishedOnly: true, tag, limit: perPage, offset }),
    repo.count(client, { publishedOnly: true, tag }),
    repo.tagsInUse(client, { publishedOnly: true }),
  ]);
  return {
    articles: rows.map(publicCard),
    tags,
    page,
    per_page: perPage,
    total,
    // Sent rather than left to the browser to compute: the browser would have to
    // know `perPage`, and a rounding disagreement is a "next" button that leads
    // to an empty page.
    has_more: offset + rows.length < total,
  };
}

/**
 * One article by slug, in either language.
 *
 * 404 for unknown AND for unpublished, which are the same fact to a visitor.
 * Distinguishing them would let anyone confirm that a draft exists at a guessed
 * URL, which is how an unannounced piece leaks before its date.
 */
async function getPublic(client, slug) {
  const row = await repo.getBySlug(client, slug, { publishedOnly: true });
  if (!row) throw new AppError("NOT_FOUND", "Article not found", 404);
  return publicArticle(row);
}

/* ── admin ───────────────────────────────────────────────────────────────── */

async function list(client, { tag = null } = {}) {
  return repo.list(client, { publishedOnly: false, tag });
}

async function get(client, id) {
  const row = await repo.get(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Article not found", 404);
  return row;
}

/**
 * Both slugs are checked against BOTH columns.
 *
 * `getBySlug` matches either column, so a French slug colliding with another
 * article's English slug would make one of the two unreachable — the lookup
 * would return whichever the planner found first. The unique indexes are
 * per-column and cannot see that, so the check belongs here.
 */
async function assertSlugsFree(client, patch, exceptId = null) {
  for (const key of ["slug_fr", "slug_en"]) {
    const value = patch[key];
    if (!value) continue;
    if (await repo.slugTaken(client, value, exceptId)) {
      throw new AppError("SLUG_TAKEN", `The slug "${value}" is already in use`, 422, {
        [key]: ["already in use"],
      });
    }
  }
  if (patch.slug_fr && patch.slug_en && patch.slug_fr === patch.slug_en) {
    // Legal in the database (two different columns) and wrong: the two
    // languages would share a URL, which is the thing per-language URLs exist
    // to avoid.
    throw new AppError("SLUG_TAKEN", "The two languages need different slugs", 422, {
      slug_en: ["must differ from the French slug"],
    });
  }
}

async function create(client, { patch, actor = {} }) {
  await assertSlugsFree(client, patch);
  return atomically(client, async () => {
    const row = await repo.insert(client, patch);
    await emitEvent(client, {
      eventTypeKey: events.CREATED,
      moduleKey: events.MODULE,
      entityRef: ref(row.insight_article_id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.CREATED,
      moduleKey: events.MODULE,
      entityRef: ref(row.insight_article_id),
      before: null,
      after: row,
    });
    return row;
  });
}

async function update(client, { id, patch, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);
  await assertSlugsFree(client, patch, id);
  return atomically(client, async () => {
    const row = await repo.update(client, id, patch);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.UPDATED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before,
      after: row,
    });
    return row;
  });
}

/**
 * Publishing refuses an article with nothing to read.
 *
 * A published row with no body is a URL in a sitemap that renders a title over
 * white space, and it is discovered by a reader rather than by the writer. FR is
 * the language checked because FR is the default and the one column that is NOT
 * NULL — an article written only in English still needs its French body before
 * it is a French-first site's article.
 */
async function setPublished(client, { id, published, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);
  if (published) {
    if (!String(before.body_fr || "").trim() && !String(before.body_en || "").trim()) {
      throw new AppError("EMPTY_ARTICLE", "Write the article before publishing it", 422, {
        body_fr: ["an article needs a body"],
      });
    }
    if (!before.slug_fr && !before.slug_en) {
      throw new AppError("NO_SLUG", "Give the article a slug before publishing it", 422, {
        slug_fr: ["a published article needs a URL"],
      });
    }
  }
  return atomically(client, async () => {
    const row = await repo.setPublished(client, id, actor.user_id || null, published);
    const action = published ? events.PUBLISHED : events.UNPUBLISHED;
    await emitEvent(client, {
      eventTypeKey: action,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before,
      after: row,
    });
    return row;
  });
}

/**
 * Deleting refuses a LIVE article, the same rule `site_content` applies to a
 * page: the URL is in search results and possibly linked from somewhere we do
 * not control. Unpublish first, deliberately, then delete.
 */
async function remove(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Article not found", 404);
  if (before.is_published) {
    throw new AppError("PUBLISHED", "Unpublish the article before deleting it", 422);
  }
  return atomically(client, async () => {
    await repo.remove(client, id);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.DELETED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before,
      after: null,
    });
    return { deleted: true };
  });
}

module.exports = {
  DEFAULT_PER_PAGE,
  publicAuthor, publicCard, publicArticle,
  listPublic, getPublic,
  list, get, create, update, setPublished, remove,
};
