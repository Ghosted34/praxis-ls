/**
 * Published service profiles — `GET /api/tenant/public/services[/:slug]`.
 *
 * The one content source on the marketing site that a tenant can actually edit
 * (`operations/service_type_web`, authored per service type). It is gated by the
 * `website` FEATURE, so a tenant on a package without it answers 403
 * `FEATURE_DISABLED` — which is a normal state for a public page and is handled
 * by falling back to the dictionary, not by an error banner. `feature: null`
 * routes (portfolio, tracking, careers, proposals) never do this, which is why
 * only this module has to think about it.
 *
 * Names and slugs are per-language (`name_en` / `name_fr`, `slug_en` /
 * `slug_fr`) because the editor writes both: the site language picks which half
 * to read, and `alternates` is what lets the language switcher land on the
 * equivalent page instead of dumping the visitor on the homepage.
 */
import { PublicApiError, publicGet } from "./api";

export type Lang = "en" | "fr";

export type ServiceAccent = "PRIMARY" | "ACCENT" | "SUCCESS";

export type ServiceCard = {
  service_type_id: string;
  slug_fr: string;
  slug_en: string;
  name_fr: string;
  name_en: string;
  short_description_fr: string | null;
  short_description_en: string | null;
  /** The one emphasised line closing the card. Migration 12755 is explicit that
   *  this is NOT `highlights[0]` — a positional convention that survives exactly
   *  until somebody reorders the list. */
  claim_fr: string | null;
  claim_en: string | null;
  /** A brand TOKEN NAME, never a hex: the palette is tenant config, so a stored
   *  colour would hardcode one tenant's brand into another's data. */
  accent: ServiceAccent;
  cover_url: string | null;
  icon_url: string | null;
  has_video: boolean;
  sort_order: number | null;
  published_month: string | null;
};

export type ServiceFaq = {
  faq_id: string;
  question_fr: string;
  question_en: string;
  answer_fr: string;
  answer_en: string;
};

export type ServiceProfile = ServiceCard & {
  alternates: { fr: string; en: string };
  long_description_fr: string | null;
  long_description_en: string | null;
  highlights_fr: string[];
  highlights_en: string[];
  coverage_fr: string | null;
  coverage_en: string | null;
  gallery_urls: string[];
  video_url: string | null;
  meta_title_fr: string | null;
  meta_title_en: string | null;
  meta_description_fr: string | null;
  meta_description_en: string | null;
  faq: ServiceFaq[];
  related: {
    slug_en: string;
    slug_fr: string;
    name_en: string;
    name_fr: string;
  }[];
};

/**
 * A bilingual row read in the visitor's language.
 *
 * The fallback matters: a tenant who filled in the English half of the form and
 * not the French one is the normal case, and blanking a heading because of it
 * would make the published page worse than the untranslated one. So the order is
 * "asked-for language, then the other", never "nothing".
 */
function readField(
  row: Record<string, unknown>,
  field: string,
  lang: Lang,
): unknown {
  const wanted = row[`${field}_${lang}`];
  if (wanted !== null && wanted !== undefined && wanted !== "") return wanted;
  return row[`${field}_${lang === "en" ? "fr" : "en"}`];
}

/** A sentence-ish field (name, description, coverage, a meta title). */
export function pickText(
  row: Record<string, unknown>,
  field: string,
  lang: Lang,
): string | null {
  const v = readField(row, field, lang);
  return typeof v === "string" && v ? v : null;
}

/** A list field (highlights). Unset is `[]` upstream, so `[]` is the fallback. */
export function pickList(
  row: Record<string, unknown>,
  field: string,
  lang: Lang,
): string[] {
  const v = readField(row, field, lang);
  return Array.isArray(v) ? (v as string[]) : [];
}

/** The slug for the language the visitor is reading in — used for links out and
 *  for the switcher's return trip. */
export function pickSlug(
  row: { slug_en: string; slug_fr: string },
  lang: Lang,
) {
  return lang === "fr" ? row.slug_fr : row.slug_en;
}

/** `FEATURE_DISABLED` and a genuinely-empty list are different states, and the
 *  page says so differently: one offers the service menu, the other asks for a
 *  quote. */
export const isFeatureDisabled = (e: unknown): boolean =>
  e instanceof PublicApiError &&
  (e.code === "FEATURE_DISABLED" || e.status === 403);

/**
 * A pillar, with its services under it.
 *
 * `key` is the anchor handle (`/services#freight`), stable across a rename, and
 * it is `null` for the trailing bucket the server collects unassigned services
 * into. That bucket is not an error state: it is where every tenant starts on
 * the day the column ships, and where a service returns when its pillar is
 * retired. It renders without a heading — it is never dropped.
 */
export type ServiceGroup = {
  key: string | null;
  name_fr: string | null;
  name_en: string | null;
  /** An icon NAME resolved by the renderer against its own set — not a URL and
   *  not markup, because a tenant-editable field that reached the DOM as HTML
   *  would be stored XSS on a public page. */
  icon: string | null;
  services: ServiceCard[];
};

/**
 * `GET /public/services` answers an OBJECT, not the flat array it used to.
 *
 * This is the shape migration 12755 introduced and the reason the services page
 * has been empty: the client asked for `ServiceCard[]`, got `{groups: […]}`,
 * and every consumer guarded with `Array.isArray(rows) ? rows : []` — which is
 * false for an object, so a tenant's published services were parsed as "none"
 * and thrown away on every load. The type is the fix; the guard was doing
 * exactly what it was written to do.
 */
export type ServicesIndex = { groups: ServiceGroup[] };

export const listServices = () =>
  publicGet<ServicesIndex>("/public/services");

export const getService = (slug: string) =>
  publicGet<ServiceProfile>(`/public/services/${encodeURIComponent(slug)}`);
