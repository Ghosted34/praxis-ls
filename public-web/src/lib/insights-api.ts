/**
 * Insights — `GET /api/tenant/public/insights`.
 *
 * ── THE FILTER LIST COMES FROM THE SERVER, AND THAT IS THE POINT ───────────
 *
 * smartls.cm's Kaizen Hub hardcodes four filter buttons (All / Strategy /
 * Humanitarian / Technology) while its articles carry six tags in `data-tags` —
 * `sustainability` and `operations` among them. Two of its five articles are
 * therefore unreachable by any filter, a bug invisible until somebody counts.
 *
 * `tags` ships with every list response, derived from the tags actually in use
 * (`insight.repo.tagsInUse`). A tag cannot exist in the data without a way to
 * reach it, and a tag nobody uses cannot linger in the bar. **Do not build a
 * filter list in this app.**
 *
 * ── WHY THE CARD CARRIES A DATE ────────────────────────────────────────────
 *
 * Theirs has none: no published date on a card, no `article:published_time`, and
 * `og:type` of `website`. A knowledge hub whose pieces all look the same age is
 * not one, and recency is most of what makes an article worth clicking.
 *
 * ── MEDIA ──────────────────────────────────────────────────────────────────
 *
 * `cover_id` is a vault document id and `coverUrl()` composes the ONLY URL this
 * app may use for it. The route re-checks a fail-closed allowlist and answers
 * 404 for a draft's cover, so a `has_cover` of true is not a promise the image
 * will stream — render the frame only when the load succeeds.
 */
import { publicGet } from "./api";

export type InsightAuthor = {
  name: string;
  title: string | null;
  avatar_ref: string | null;
};

/** `article` or `announcement` — the `ck_insight_kind` CHECK (13784) admits
 *  exactly these. An announcement is an article with a different renderer, not
 *  a second CMS: same detail route, same media, same shape. */
export type InsightKind = "article" | "announcement";

export type InsightCard = {
  slug_fr: string | null;
  slug_en: string | null;
  title_fr: string;
  title_en: string | null;
  excerpt_fr: string | null;
  excerpt_en: string | null;
  tags: string[];
  published_at: string | null;
  has_cover: boolean;
  cover_id: string | null;
  author: InsightAuthor | null;
  kind: InsightKind;
  /** When this pin lapses. The band SHOWS it: a visitor who reads "until 4
   *  March" knows the notice is current, which is most of what a notice is
   *  for. Null on everything that is not pinned. */
  pinned_until: string | null;
};

export type InsightArticle = InsightCard & {
  /** Vault document ids, in the order the writer arranged them, drawn below the
   *  body. Ids rather than URLs for the same reason `cover_id` is one:
   *  `coverUrl()` composes the only legal URL, so a payload carrying a built
   *  one would bake this deploy's hostname into the tenant's content. */
  gallery_ids: string[];
  body_fr: string | null;
  body_en: string | null;
  meta_title_fr: string | null;
  meta_title_en: string | null;
  meta_description_fr: string | null;
  meta_description_en: string | null;
};

/** `{tag, count}` — the count is what lets the bar show "Strategy (3)". */
export type InsightTag = { tag: string; count: number };

export type InsightIndex = {
  articles: InsightCard[];
  tags: InsightTag[];
  page: number;
  per_page: number;
  total: number;
  /** Sent rather than derived: a rounding disagreement between the browser's
   *  idea of `per_page` and the server's is a "next" that leads nowhere. */
  has_more: boolean;
};

export const listInsights = (
  opts: {
    tag?: string;
    /** `article` | `announcement`, or absent for both (§8.6). Validated by the
     *  server since 13784; the public route only started READING it in PR 4,
     *  which is why nothing sent it before. */
    kind?: InsightKind | "";
    page?: number;
    signal?: AbortSignal;
  } = {},
) =>
  publicGet<InsightIndex>("/public/insights", {
    query: { tag: opts.tag, kind: opts.kind || undefined, page: opts.page },
    signal: opts.signal,
  });

/**
 * The homepage band's read — `GET /public/site/announcements`.
 *
 * ── TWO COLLECTIONS, ONE REQUEST ───────────────────────────────────────────
 *
 * `pinned` is what the band draws and the server caps it at five; `articles` is
 * the list behind "view more". They arrive together because they are one
 * screenful, and a second round trip for the second half would land on the
 * heels of the LCP.
 *
 * THE CAP IS THE SERVER'S. Do not re-slice here and do not raise it with
 * `per_page` — that parameter narrows the LIST only. A client-side cap would be
 * a cap this app enforces for itself and nobody else.
 *
 * A pinned announcement also appears in `articles`, deliberately: somebody who
 * follows "view more" looking for the notice they just read should find it.
 */
export type AnnouncementIndex = InsightIndex & { pinned: InsightCard[] };

export const listAnnouncements = (
  opts: { page?: number; signal?: AbortSignal } = {},
) =>
  publicGet<AnnouncementIndex>("/public/site/announcements", {
    query: { page: opts.page },
    signal: opts.signal,
  });

/** Whether a pin is still live, by the same test the SQL makes
 *  (`pinned_until > now()`). A payload can outlive its pin in a cache, and a
 *  band that drew an expired notice would be the exact staleness 13784's
 *  timestamp exists to prevent. */
export const pinLive = (a: Pick<InsightCard, "pinned_until">): boolean =>
  Boolean(a.pinned_until && new Date(a.pinned_until).getTime() > Date.now());

export const getInsight = (slug: string, opts: { signal?: AbortSignal } = {}) =>
  publicGet<InsightArticle>(
    `/public/insights/${encodeURIComponent(slug.trim())}`,
    { signal: opts.signal },
  );

export const coverUrl = (id: string | null | undefined): string | null =>
  id ? `/api/tenant/public/insights/media/${encodeURIComponent(id)}` : null;

/**
 * The slug to link to in the reader's language, falling back to the other.
 *
 * An article may exist in one language only — `title_fr` is required and
 * `slug_en` is not — and a card with no href is a card that looks broken. The
 * fallback means a French reader can still open an English-only piece rather
 * than being shown a dead tile.
 */
export const insightSlug = (a: InsightCard, lang: string): string | null =>
  (lang === "fr" ? a.slug_fr || a.slug_en : a.slug_en || a.slug_fr) || null;

/** Title and excerpt in the reader's language, falling back the same way. */
export const insightTitle = (a: InsightCard, lang: string): string =>
  (lang === "fr" ? a.title_fr || a.title_en : a.title_en || a.title_fr) || "";

export const insightExcerpt = (a: InsightCard, lang: string): string | null =>
  (lang === "fr" ? a.excerpt_fr || a.excerpt_en : a.excerpt_en || a.excerpt_fr) || null;

export const insightBody = (a: InsightArticle, lang: string): string | null =>
  (lang === "fr" ? a.body_fr || a.body_en : a.body_en || a.body_fr) || null;
