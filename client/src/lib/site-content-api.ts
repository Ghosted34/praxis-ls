/**
 * The tenant's public website — pages, blocks, and the two stat blocks the
 * marketing site actually renders. `GET/POST/PATCH/DELETE /site/*`, gated
 * server-side by MOD-29 view/edit (site_content.routes.js).
 *
 * ── WHY ONLY TWO BLOCK TYPES HAVE A FORM ───────────────────────────────────
 *
 * The block library has fifteen. `public-web` renders two of them — the proof
 * strip under the hero reads the home page's `stat_counters` and `stat_chips`
 * and nothing else. An editor offering the other thirteen would let a tenant
 * spend an afternoon authoring a `leader_message` that no page displays, which
 * is a worse experience than an editor that is visibly narrow: the first reads
 * as broken, the second as unfinished.
 *
 * So `EDITABLE_BLOCK_TYPES` is the list this screen writes, and it grows when
 * `public-web` learns to draw another one — in the same commit, or it is the
 * same bug again.
 *
 * ── WHY `content` IS TYPED HERE AND VALIDATED THERE ───────────────────────
 *
 * The server holds the only definition of a block's shape
 * (`site_content.schema.js`, a Zod schema per type) and answers 422 with field
 * errors. These types are the client's reading of that contract for the two it
 * edits — convenience, never authority. `errMsg` turns the 422 into the field
 * list, so a shape this file gets wrong surfaces as a message rather than as a
 * silent write.
 */
import * as React from "react";
import { tenant } from "./api-client";

/** Bilingual text, as the block schema stores it. FR is required upstream; EN
 *  is optional, and the public page falls back FR↔EN rather than blanking. */
export type Bilingual = { fr: string; en?: string | null };

export type StatCounterItem = {
  label: Bilingual;
  sublabel?: Bilingual | null;
  unit?: string | null;
  /** The literal. Always present — it is the fallback when a bound metric is
   *  unknown, absent or fails, and the only value for a stat the ERP cannot
   *  compute. */
  value: number;
  /** Optional binding to the metric registry. Refused at save time if it names
   *  a metric that does not exist, so a typo is a 422 rather than a number that
   *  silently never updates. */
  metric_key?: string | null;
};

export type StatChipItem = { label: Bilingual; value: Bilingual };

/** A link as the block schema stores it: a label plus an internal path or a
 *  mailto/tel/https URL. The renderer only follows rooted paths — see the note
 *  in `public-web/src/lib/site-api.ts` on why an absolute URL through `p()`
 *  produces `/public/https://…`. */
export type BlockLink = { label: Bilingual; href: string } | null;

export type HeroContent = {
  kicker?: Bilingual | null;
  title: Bilingual;
  lead?: Bilingual | null;
  cta?: BlockLink;
};

export type FeatureListItem = { title: Bilingual; text?: Bilingual | null };
export type FeatureListContent = {
  title?: Bilingual | null;
  items: FeatureListItem[];
};

export type CtaBandContent = {
  title: Bilingual;
  text?: Bilingual | null;
  cta?: BlockLink;
};

export type EditableBlockType =
  | "hero"
  | "stat_counters"
  | "feature_list"
  | "stat_chips"
  | "cta_band";

/**
 * The five the public site draws — and the list that must grow in the SAME
 * commit as the renderer.
 *
 * It held two for as long as `public-web` drew two. When the marketing page
 * learned to prefer a tenant's `hero`, `feature_list` and `cta_band` over its
 * own dictionary copy, those three became content a tenant could see on their
 * site and not edit here — which is the worse half of the original defect,
 * because a block that renders and cannot be changed reads as broken rather
 * than as unbuilt. Hence this list, in that commit's follow-up.
 *
 * The order is RENDER order on the home page, not alphabetical: this is what
 * the "add a block" menu offers, and offering them in the order they appear is
 * the difference between a menu and a list of type names.
 */
export const EDITABLE_BLOCK_TYPES: EditableBlockType[] = [
  "hero",
  "stat_counters",
  "feature_list",
  "cta_band",
  "stat_chips",
];

export type SiteBlock = {
  block_id: string;
  page_id?: string;
  type: string;
  sort_order: number;
  is_visible: boolean;
  content: Record<string, unknown>;
};

export type SitePage = {
  page_id: string;
  key: string;
  title_fr: string;
  title_en: string | null;
  slug_fr: string | null;
  slug_en: string | null;
  meta_title_fr: string | null;
  meta_title_en: string | null;
  meta_description_fr: string | null;
  meta_description_en: string | null;
  is_published: boolean;
  published_at: string | null;
  sort_order: number;
};

export type PageTab = { page: SitePage; blocks: SiteBlock[] };

/** What the editor needs before it can draw its own controls. */
export type SiteMeta = {
  /** The commercial switch. Informational: this module is not gated on it, so
   *  a site can be prepared before the package is bought. */
  website_enabled: boolean;
  /** Every key a `stat_counters` item may bind to, with the registry's unit. */
  metrics: { key: string; unit: string | null }[];
};

export type PagePatch = Partial<
  Pick<
    SitePage,
    | "key"
    | "title_fr"
    | "title_en"
    | "slug_fr"
    | "slug_en"
    | "meta_title_fr"
    | "meta_title_en"
    | "meta_description_fr"
    | "meta_description_en"
    | "sort_order"
  >
>;

export const fetchSiteMeta = () => tenant<SiteMeta>("/site/meta");

export const listSitePages = () => tenant<SitePage[]>("/site/pages");

export const fetchSitePage = (pageId: string) =>
  tenant<PageTab>(`/site/pages/${encodeURIComponent(pageId)}`);

export const createSitePage = (body: PagePatch & { key: string }) =>
  tenant<SitePage>("/site/pages", { method: "POST", body });

export const updateSitePage = (pageId: string, body: PagePatch) =>
  tenant<SitePage>(`/site/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body,
  });

/** Its own endpoint, not a field: publishing stamps who and when, so an
 *  ordinary update must not be able to flip it. */
export const publishSitePage = (pageId: string, published: boolean) =>
  tenant<SitePage>(`/site/pages/${encodeURIComponent(pageId)}/publish`, {
    method: "POST",
    body: { published },
  });

export const deleteSitePage = (pageId: string) =>
  tenant(`/site/pages/${encodeURIComponent(pageId)}`, { method: "DELETE" });

export const createSiteBlock = (
  pageId: string,
  body: { type: EditableBlockType; content?: unknown; sort_order?: number },
) =>
  tenant<SiteBlock>(`/site/pages/${encodeURIComponent(pageId)}/blocks`, {
    method: "POST",
    body,
  });

/** `type` is absent on purpose — a block's type is fixed at creation, because
 *  changing it would leave content shaped for the old one. */
export const updateSiteBlock = (
  blockId: string,
  body: { content?: unknown; is_visible?: boolean; sort_order?: number },
) =>
  tenant<SiteBlock>(`/site/blocks/${encodeURIComponent(blockId)}`, {
    method: "PATCH",
    body,
  });

export const deleteSiteBlock = (blockId: string) =>
  tenant(`/site/blocks/${encodeURIComponent(blockId)}`, { method: "DELETE" });

/** Whole-page order in one statement, so two blocks can never claim one slot. */
export const reorderSiteBlocks = (pageId: string, blockIds: string[]) =>
  tenant<SiteBlock[]>(
    `/site/pages/${encodeURIComponent(pageId)}/blocks/reorder`,
    { method: "POST", body: { block_ids: blockIds } },
  );

/* ── the one thing the Settings hub needs ─────────────────────────────────── */

/**
 * Is the public website package on for this tenant?
 *
 * `null` means UNKNOWN — not "no". The hub hides the Website card only on an
 * explicit `false`, which is the same rule `route-access.ts` states for an
 * unresolved permissions read: over-offering for one frame is recoverable, a
 * card that vanishes after the grid has painted is not.
 *
 * Cached in module scope rather than fetched per mount. The hub renders on
 * every visit to /settings and the answer changes when somebody buys a package,
 * not between two clicks.
 */
let metaPromise: Promise<SiteMeta | null> | null = null;

export function loadSiteMeta(): Promise<SiteMeta | null> {
  if (!metaPromise) {
    metaPromise = fetchSiteMeta().catch(() => {
      // A 403 here is the ordinary answer for anyone without MOD-29, and a
      // network failure must not take the Settings grid down with it. Drop the
      // cache so a later mount can ask again.
      metaPromise = null;
      return null;
    });
  }
  return metaPromise;
}

/** Reset for tests. Not called in the app. */
export function __resetSiteMeta(): void {
  metaPromise = null;
}

/**
 * `true` / `false` / `null` — where `null` is UNKNOWN and never "no".
 *
 * `enabled` gates the request itself: the Settings hub renders for everyone, and
 * asking an endpoint that answers 403 to most of them once per visit is a
 * request nobody needed. Callers pass whether this user can open the screen at
 * all.
 */
export function useWebsiteEnabled(enabled: boolean): boolean | null {
  const [on, setOn] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    void loadSiteMeta().then((m) => {
      if (alive) setOn(m ? m.website_enabled : null);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return on;
}
