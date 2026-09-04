/**
 * Insight articles — `GET/POST/PATCH/DELETE /insights`, gated server-side by
 * MOD-29 view/edit (`content/insight/insight.routes.js`).
 *
 * ── WHY THIS FILE DID NOT EXIST UNTIL NOW ──────────────────────────────────
 *
 * The backend shipped complete: a table (12757), full CRUD, its own publish
 * endpoint, and a public read at `/public/insights` feeding `/insights` and
 * `/insights/:slug` on the marketing site — which are in that site's header
 * navigation. The screen to write an article was never built. So the product
 * shipped a nav link to a page only curl could fill.
 *
 * That is the same shape of gap `site-content-api.ts` was written to close, one
 * module over, and it is closed the same way: a typed client here, a list and
 * an editor beside the website pages screen, because an article is website
 * content and belongs where the rest of the website is edited.
 *
 * ── PUBLISHING IS ITS OWN VERB ─────────────────────────────────────────────
 *
 * `POST /insights/:id/publish`, never a field on the PATCH. The server stamps
 * who and when and refuses an article with no body or no slug, and keeping it
 * off the patch is what stops an ordinary typo fix from flipping an article
 * live — the same rule the pages screen follows.
 */
import { tenant } from "./api-client";

/** FR is required upstream and EN is optional; the public page falls back
 *  FR↔EN rather than blanking a heading somebody half-translated. */
export type InsightArticle = {
  insight_article_id: string;
  slug_fr: string | null;
  slug_en: string | null;
  title_fr: string;
  title_en: string | null;
  excerpt_fr: string | null;
  excerpt_en: string | null;
  body_fr: string | null;
  body_en: string | null;
  meta_title_fr: string | null;
  meta_title_en: string | null;
  meta_description_fr: string | null;
  meta_description_en: string | null;
  cover_vault_id: string | null;
  /** Vault ids in display order, drawn below the body on the public page. The
   *  array IS the order, which is why reordering and removing are one write. */
  gallery_vault_ids: string[];
  tags: string[];
  author_user_id: string | null;
  is_published: boolean;
  published_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** Every field the editor may write. `title_fr` is the only one the server
 *  insists on at creation, which is what lets a writer start an article from a
 *  headline and fill the rest over a week. */
export type InsightPatch = Partial<{
  slug_fr: string | null;
  slug_en: string | null;
  title_fr: string;
  title_en: string | null;
  excerpt_fr: string | null;
  excerpt_en: string | null;
  body_fr: string | null;
  body_en: string | null;
  meta_title_fr: string | null;
  meta_title_en: string | null;
  meta_description_fr: string | null;
  meta_description_en: string | null;
  cover_vault_id: string | null;
  tags: string[];
  sort_order: number;
}>;

export const listInsights = (tag?: string | null) =>
  tenant<InsightArticle[]>(
    tag ? `/insights?tag=${encodeURIComponent(tag)}` : "/insights",
  );

export const fetchInsight = (id: string) =>
  tenant<InsightArticle>(`/insights/${id}`);

export const createInsight = (body: InsightPatch & { title_fr: string }) =>
  tenant<InsightArticle>("/insights", { method: "POST", body });

export const updateInsight = (id: string, body: InsightPatch) =>
  tenant<InsightArticle>(`/insights/${id}`, { method: "PATCH", body });

/** Its own endpoint — see the header. */
export const publishInsight = (id: string, published: boolean) =>
  tenant<InsightArticle>(`/insights/${id}/publish`, {
    method: "POST",
    body: { published },
  });

/**
 * The cover — bytes, so its own endpoint rather than a field on the PATCH.
 *
 * A patch that accepted a data URL among the text fields would make every
 * ordinary save carry a possible ten-megabyte upload. Both calls answer with the
 * article row, so the editor re-renders from one response instead of re-fetching.
 */
export const setInsightCover = (
  id: string,
  body: { data_url: string; original_name?: string },
) => tenant<InsightArticle>(`/insights/${id}/cover`, { method: "POST", body });

export const removeInsightCover = (id: string) =>
  tenant<InsightArticle>(`/insights/${id}/cover`, { method: "DELETE" });

/**
 * Where a cover's bytes are served from — the ONE legal URL for them.
 *
 * The public media route refuses a doc whose article is not published, so this
 * answers a working image only for a live article. A draft's cover is stored
 * and bound and simply not servable yet, which is why the editor shows its
 * state in words rather than a broken frame.
 */
export const insightCoverUrl = (id: string | null | undefined): string | null =>
  id ? `/api/tenant/public/insights/media/${id}` : null;

/** Add one image to the gallery. Appends — a writer adding an image expects to
 *  find it at the end. */
export const addInsightGalleryImage = (
  id: string,
  body: { data_url: string; original_name?: string },
) => tenant<InsightArticle>(`/insights/${id}/gallery`, { method: "POST", body });

/** Store the whole list: this is BOTH the reorder and the removal, because the
 *  array is the display order. The server ignores any id that was not already
 *  the article's, so a stale list cannot bind a foreign document. */
export const setInsightGallery = (id: string, ids: string[]) =>
  tenant<InsightArticle>(`/insights/${id}/gallery`, { method: "PUT", body: { ids } });

export const deleteInsight = (id: string) =>
  tenant<{ deleted: boolean }>(`/insights/${id}`, { method: "DELETE" });
