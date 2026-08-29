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

export type ServiceCard = {
  service_type_id: string;
  slug_fr: string;
  slug_en: string;
  name_fr: string;
  name_en: string;
  short_description_fr: string | null;
  short_description_en: string | null;
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

export const listServices = () => publicGet<ServiceCard[]>("/public/services");

export const getService = (slug: string) =>
  publicGet<ServiceProfile>(`/public/services/${encodeURIComponent(slug)}`);
