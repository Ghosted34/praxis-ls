/**
 * The tenant's own website content — `GET /api/tenant/public/site/pages/:key`.
 *
 * ── WHY THE PROOF STRIP READS FROM HERE AND NOWHERE ELSE ──────────────────
 *
 * A figures band is the one thing on a marketing page that is worth the most
 * when it is true and costs the most when it is not. `WEB_BUILD_BRIEF.md` N12
 * forbids inventing one, and a hardcoded "41,850 CBM managed" in a white-label
 * product is not a placeholder — it is a claim every other tenant would have to
 * find and delete before launch, and the ones they miss end up in front of a
 * procurement officer.
 *
 * So the numbers come from the tenant's own `stat_counters` blocks, and the
 * server has already resolved each one against its metric registry
 * (`site_content.metrics.js`) before it answers: where a block names a metric,
 * `value` is what the ledger says this morning; where it does not, `value` is
 * the literal the tenant typed. The renderer is never handed the choice, which
 * is why there is no `metric_key` in the payload below.
 *
 * A tenant with no home page, no published page, or the `website` package off
 * has no strip. That is the correct empty state and the caller draws nothing —
 * a band that says "statistics coming soon" is worse than no band.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ─────────────────────────────
 *
 * It is not a page renderer. The block library has fourteen types and the
 * marketing page is a hand-built scaffold, not a CMS view; consuming the two
 * stat types is a narrow, honest read of content the tenant already authors.
 * Anything more is the site-builder project, not this one.
 */
import { publicGet } from "./api";
import type { Lang } from "./i18n";

/** A bilingual string as the block schema stores it. FR is required upstream
 *  (`site_content.schema.js`), EN is optional — so FR is the fallback, never a
 *  blank. */
export type Bilingual = { fr: string; en?: string | null };

/** One figure. `value` is post-resolution: live where the block named a metric,
 *  the tenant's literal where it did not. */
export type StatCounter = {
  label: Bilingual;
  sublabel?: Bilingual | null;
  unit?: string | null;
  value: number;
};

/** One credential or short claim — the quieter row under the figures. */
export type StatChip = { label: Bilingual; value: Bilingual };

export type SiteBlock = {
  block_id: string;
  type: string;
  content: Record<string, unknown>;
};

export type SitePage = {
  key: string;
  blocks: SiteBlock[];
};

/**
 * The page the marketing home reads its figures from.
 *
 * `'home'` is the key migration 12753 names in the column's own comment
 * ("'home' | 'about' | … — stable, referenced by the router, never shown"), so
 * it is a convention the schema states rather than one this file invents.
 */
export const HOME_PAGE_KEY = "home";

/**
 * The page key the careers screen reads its "why work here" blocks from (13792).
 *
 * A key and not a new table, because `site_page.key` is already free-form
 * (`^[a-z0-9][a-z0-9-]*[a-z0-9]$` in the settings screen) and every tenant can
 * already create one. It is here rather than invented at the call site so that
 * the careers page and any future reader are looking at the same string — the
 * failure mode otherwise is a tenant authoring `careers` and a component asking
 * for `career`, which reads as "the editor does not work".
 */
export const CAREERS_PAGE_KEY = "careers";

/**
 * One published page, or `null`.
 *
 * Every failure is the same answer on purpose. An unknown key, an unpublished
 * page and a tenant without the `website` package are three different facts
 * server-side and one fact here: there is nothing to draw. Distinguishing them
 * would only give a marketing band a decision it should not be making, and the
 * band renders nothing in all three cases.
 */
export const getSitePage = (key: string): Promise<SitePage | null> =>
  publicGet<SitePage>(`/public/site/pages/${encodeURIComponent(key)}`).catch(
    () => null,
  );

/** A bilingual field read in the visitor's language, falling back to the other
 *  rather than to a blank — the same rule `services-api.pickText` follows for
 *  the tenant's service copy, and for the same reason. */
export function pickBilingual(
  value: Bilingual | null | undefined,
  lang: Lang,
): string {
  if (!value) return "";
  const wanted = lang === "fr" ? value.fr : value.en;
  if (typeof wanted === "string" && wanted) return wanted;
  const other = lang === "fr" ? value.en : value.fr;
  return typeof other === "string" ? other : "";
}

const itemsOf = (page: SitePage | null, type: string): unknown[] => {
  const block = (page?.blocks || []).find((b) => b.type === type);
  const items = block?.content?.items;
  return Array.isArray(items) ? items : [];
};

/**
 * The figures, from the FIRST `stat_counters` block on the page.
 *
 * First rather than merged: a tenant may repeat a headline number further down
 * their own page, and a strip that concatenated every stat block on the page
 * would show the same figure twice in one row. The strip is the top of the
 * page, so the top block is the one it means.
 *
 * Items with a non-finite value are dropped. `value` is `z.number()` in the
 * schema and the resolver only ever overwrites it with a finite number, so this
 * cannot fire today — it is here because a `NaN` rendered into a figures band
 * is the one failure mode that looks like a bug in the client's business rather
 * than in their website.
 */
export const statCounters = (page: SitePage | null): StatCounter[] =>
  itemsOf(page, "stat_counters").filter(
    (i): i is StatCounter =>
      !!i &&
      typeof i === "object" &&
      Number.isFinite((i as StatCounter).value),
  );

/**
 * ── THE OVERRIDE READERS ───────────────────────────────────────────────────
 *
 * Everything below reads a block the tenant authored and hands it to a band
 * that already has copy of its own. That is the whole model, and it is worth
 * stating once rather than in four places:
 *
 *   the dictionary is the DEFAULT, the page is the OVERRIDE.
 *
 * A band renders `site.hero.*` from `i18n-dict.ts` until a tenant publishes a
 * home page carrying a `hero` block, at which point the block wins outright.
 * Not a merge — a tenant must never see a headline half theirs and half ours.
 *
 * This is what closes the gap the whole website editor fell into: the words on
 * the homepage were real, visible, and written into a frontend bundle where no
 * tenant could reach them. Seed 9086 puts the same words into blocks, so the
 * first thing a tenant sees in the editor is the page they already have.
 *
 * Every reader answers null when the block is absent, which is the normal state
 * and the one the fallbacks are for.
 */

/** A link as the block schema stores it: a label plus an internal path or a
 *  mailto/tel/https URL. Relative paths resolve against the site base, so a
 *  link keeps working when the tenant moves off /public onto their own domain. */
export type BlockLink = { label: Bilingual; href: string } | null;

export type HeroBlock = {
  kicker: Bilingual | null;
  title: Bilingual;
  lead: Bilingual | null;
  cta: BlockLink;
};

export type FeatureItem = { title: Bilingual; text: Bilingual | null };

export type FeatureListBlock = {
  title: Bilingual | null;
  items: FeatureItem[];
};

export type CtaBandBlock = {
  title: Bilingual;
  text: Bilingual | null;
  cta: BlockLink;
};

const blockOf = (page: SitePage | null, type: string): Record<string, unknown> | null => {
  const block = (page?.blocks || []).find((b) => b.type === type);
  return block ? (block.content as Record<string, unknown>) : null;
};

/** A bilingual field, or null when the block omitted it. `bi()` in the block
 *  schema requires FR and allows EN to be absent, so this only has to prove the
 *  shape, never that both halves are present — `pickBilingual` handles that. */
const bilingual = (v: unknown): Bilingual | null =>
  v && typeof v === "object" && typeof (v as Bilingual).fr === "string"
    ? (v as Bilingual)
    : null;

const linkOf = (v: unknown): BlockLink => {
  if (!v || typeof v !== "object") return null;
  const raw = v as { label?: unknown; href?: unknown };
  const label = bilingual(raw.label);
  return label && typeof raw.href === "string" && raw.href ? { label, href: raw.href } : null;
};

/**
 * The hero, when the tenant has written one.
 *
 * `title` is required by the schema, so a block without one is malformed and
 * answers null rather than rendering a hero with no headline — which on this
 * page would be a full-bleed photograph with two buttons floating on it.
 *
 * `background_image` is deliberately NOT read here. The hero already resolves
 * its artwork from branding (`siteHeroUrl`, then the login backdrop), and a
 * third source competing with those two would mean a tenant who uploads in
 * Settings › Branding sees nothing change. One image, one place to set it.
 */
export function heroBlock(page: SitePage | null): HeroBlock | null {
  const c = blockOf(page, "hero");
  const title = bilingual(c?.title);
  if (!title) return null;
  return {
    kicker: bilingual(c?.kicker),
    title,
    lead: bilingual(c?.lead),
    cta: linkOf(c?.cta),
  };
}

/** The how-it-works list, from the first `feature_list` block. Items without a
 *  title are dropped rather than rendered as an empty step. */
export function featureList(page: SitePage | null): FeatureListBlock | null {
  const c = blockOf(page, "feature_list");
  if (!c) return null;
  const raw = Array.isArray(c.items) ? c.items : [];
  const items = raw
    .map((i) => {
      const row = i as { title?: unknown; text?: unknown };
      const title = bilingual(row.title);
      return title ? { title, text: bilingual(row.text) } : null;
    })
    .filter((i): i is FeatureItem => i !== null);
  return items.length ? { title: bilingual(c.title), items } : null;
}

/** The closing call to action, from the first `cta_band` block. */
export function ctaBand(page: SitePage | null): CtaBandBlock | null {
  const c = blockOf(page, "cta_band");
  const title = bilingual(c?.title);
  if (!title) return null;
  return { title, text: bilingual(c?.text), cta: linkOf(c?.cta) };
}

/** The credentials row, from the first `stat_chips` block. */
export const statChips = (page: SitePage | null): StatChip[] =>
  itemsOf(page, "stat_chips").filter(
    (i): i is StatChip => !!i && typeof i === "object",
  );

/* ── the group story (§6.9's `/public/site/about`) ─────────────────────────
 *
 * PR 5 (§9.1) renders the whole of this as the About page. PR 4 needs one field
 * from it: `esg`, which §8.4 turns into the programme's worked example of the
 * 90-word rule.
 *
 * THREE FIXED PILLARS, NOT AN OPEN BAG. `packages/shared/schemas/site-settings.js`
 * says why in as many words: the renderer builds a three-panel interactive and
 * can only do that if it knows there are exactly three and what they are
 * called. An open record would mean the renderer guessing at whatever an editor
 * typed, and a fourth pillar silently breaking the layout.
 *
 * The pillar NAMES are ours and come from the dictionary — Environment, Social,
 * Governance are the standard triad, not a claim about this tenant. Everything
 * inside a pillar is theirs.
 */
export type EsgPillar = {
  text: string;
  points: string[];
};

export type EsgContent = {
  environment: EsgPillar | null;
  social: EsgPillar | null;
  governance: EsgPillar | null;
};

type RawPillar = {
  text_fr?: unknown;
  text_en?: unknown;
  points?: unknown;
};

/** One pillar, read in the visitor's language. Null when the tenant has not
 *  written it — which is the default, and the band draws nothing rather than a
 *  heading over an empty column. */
function pillar(raw: unknown, lang: Lang): EsgPillar | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawPillar;
  const text = pickBilingual(
    { fr: String(r.text_fr ?? ""), en: r.text_en == null ? null : String(r.text_en) },
    lang,
  );
  const points = (Array.isArray(r.points) ? r.points : [])
    .map((pt) => pickBilingual(pt as Bilingual, lang))
    .filter((t): t is string => !!t);
  // A pillar with neither prose nor a single point is not a pillar. Rendering
  // its heading anyway would put "Environment" over white space on a public
  // page, which is worse than the section being one column shorter.
  return text || points.length ? { text, points } : null;
}

export const getPublicEsg = (opts: { lang: Lang; signal?: AbortSignal }) =>
  publicGet<{ esg?: unknown }>("/public/site/about", { signal: opts.signal })
    .then(
      (about): EsgContent => ({
        environment: pillar((about?.esg as Record<string, unknown>)?.environment, opts.lang),
        social: pillar((about?.esg as Record<string, unknown>)?.social, opts.lang),
        governance: pillar((about?.esg as Record<string, unknown>)?.governance, opts.lang),
      }),
    )
    /* Every failure is the same answer, for the reason `getSitePage` states: an
       unpublished story, a tenant without the `website` package and a network
       error are three facts server-side and one fact here — there is nothing to
       draw. The band renders nothing in all three. */
    .catch((): EsgContent => ({ environment: null, social: null, governance: null }));

/** Whether any pillar has content. The band mounts nothing at all otherwise —
 *  no heading, no empty columns, no "coming soon".
 *
 *  A TYPE GUARD rather than a boolean, so the null check and the render site
 *  cannot drift. Guarding with a plain boolean would leave the call site
 *  needing a non-null assertion — and an assertion is what survives the day
 *  somebody makes this read optional, silently, with a crash behind it. */
export const hasEsg = (esg: EsgContent | null): esg is EsgContent =>
  !!esg && !!(esg.environment || esg.social || esg.governance);

/* ── public-enabled entities (§6.9) ────────────────────────────────────────
 *
 * PR 5 (§9.2) renders these as a network in their own right. PR 3 needs one
 * field from them: `coverage`, which is the list of countries each entity
 * actually operates in.
 *
 * WHY THE SET PIECE READS IT. §7.5 says the scene's data comes from
 * `listCorridors` AND this endpoint, and the two answer different questions: a
 * corridor is a lane the tenant has RUN, an entity's coverage is ground the
 * tenant STANDS ON. A network drawing that cannot tell "we deliver here" from
 * "we are here" is missing the distinction a visitor most wants.
 *
 * The join is on `country_code` and nothing else — an exact code-to-code match,
 * both sides of it authored by the tenant. Matching an entity's ADDRESS against
 * a corridor's place NAME was the other option and it is inference: "Douala"
 * against "Douala, Littoral, Cameroun" works until the first tenant who writes
 * it differently, and a marketing page that quietly mislabels where a company
 * is, is exactly what N12 exists to prevent.
 */
export type PublicEntity = {
  id: string;
  code: string | null;
  legal_name: string;
  trading_name: string | null;
  country_code: string | null;
  /** `[{country_code, label_fr, label_en}]` — migration 13787.
   *
   *  The LABELS are read now as well as the codes (§8.5's coverage figure).
   *  They are the tenant's own words for the place, which is the only naming
   *  this app is entitled to print: a two-letter code resolved against a
   *  country table would be OUR name for their market, and the schema requires
   *  both languages precisely so it does not have to be. */
  coverage: Array<{
    country_code?: string | null;
    label_fr?: string | null;
    label_en?: string | null;
  }>;
  /* ── the fields §9.2 reads, and PR 3/PR 4 did not ──────────────────────
   *
   * All of them were already in the payload (§6.9, PR 2). PR 3 needed
   * `coverage` and PR 4 needed `coverage` with its labels, so the type stopped
   * there rather than describing fields nothing consumed. §9.2 draws the
   * entities as a network in their own right, which needs the rest.
   *
   * WHAT IS STILL NOT HERE IS THE POINT. No `rccm`, no `niu`, no legal form, no
   * incorporation date, no cap table, no governance — because none of them is
   * in the response. `tests/unit/site-public-redaction.test.js` asserts that on
   * the SERIALISED body, and `about-page.test.tsx` asserts it again on the
   * rendered DOM, which is the assertion §9.7 actually asks for. */
  summary?: { fr?: string | null; en?: string | null } | null;
  focus?: Array<{
    label_fr?: string | null;
    label_en?: string | null;
    mode?: string | null;
  }>;
  cover_id?: string | null;
  cover_variants?: MediaVariants;
  leaders?: PublicLeader[];
};

/** One place a tenant says they cover, named as they named it. Rows without a
 *  label in either language are dropped rather than falling back to the code —
 *  "CM" on a public page is not a place name. */
export function coverageLabels(
  entity: PublicEntity,
  lang: Lang,
): string[] {
  const seen = new Set<string>();
  for (const c of entity.coverage || []) {
    const label = pickBilingual(
      {
        fr: String(c.label_fr ?? ""),
        en: c.label_en == null ? null : String(c.label_en),
      },
      lang,
    );
    if (label) seen.add(label);
  }
  return [...seen];
}

export const listPublicEntities = (opts: { signal?: AbortSignal } = {}) =>
  publicGet<PublicEntity[]>("/public/site/entities", { signal: opts.signal });

/**
 * Every ISO country code the tenant's public entities sit in or cover, upper-cased.
 *
 * Empty for a tenant with no public entity — which is the default, since
 * `public_enabled` is off until somebody turns it on deliberately (13787). The
 * scene then marks nothing, which is correct: no claim is made from an absence.
 */
export function coveredCountries(entities: PublicEntity[] | null): Set<string> {
  const out = new Set<string>();
  for (const e of entities || []) {
    if (e.country_code) out.add(e.country_code.toUpperCase());
    for (const c of e.coverage || []) {
      if (c && c.country_code) out.add(String(c.country_code).toUpperCase());
    }
  }
  return out;
}

/* ── website media (§6.3, built in PR 5) ───────────────────────────────────
 *
 * ── WHY THE CLIENT BUILDS THE URL AND THE SERVER SENDS AN ID ──────────────
 *
 * The reads publish `logo_id` / `photo_id` / `cover_id` and a `*_variants`
 * ladder, not a URL. That looks like extra work here and it is the right split:
 * the id is a FACT about the document, the URL is a routing detail of this app,
 * and the two other consumers of these endpoints (the settings preview and,
 * later, a tenant's own domain) resolve the same id against a different base.
 *
 * ── THE LADDER IS WHAT WAS WRITTEN, NOT WHAT WAS ASKED FOR ────────────────
 *
 * `sharp` never upscales, so a 700 px mark has no 1600 rung. A `srcset` naming
 * a width that does not exist is a 404 per visitor per image — the browser has
 * already committed to the candidate it picked — which is why the widths come
 * from the row rather than from a constant in this file.
 */
export type MediaVariants = { widths: number[]; formats: string[] } | null;

/** The original bytes. Always valid for a document the read published, because
 *  the serve route's own owner join is the same condition that put the id in
 *  the payload. */
export const mediaUrl = (id: string | null | undefined): string | null =>
  id ? `/api/tenant/public/site/media/${encodeURIComponent(id)}` : null;

/**
 * One `<source>` line — every width the document has, in one format.
 *
 * Returns null when the format was never written, so a caller can omit the
 * `<source>` entirely rather than emit an empty `srcset` (which Safari treats
 * as a candidate and then fails to load).
 */
export function mediaSrcSet(
  id: string | null | undefined,
  variants: MediaVariants,
  format: string,
): string | null {
  if (!id || !variants || !variants.formats.includes(format)) return null;
  const widths = variants.widths.filter((w) => Number.isFinite(w) && w > 0);
  if (!widths.length) return null;
  return widths
    .map((w) => `/api/tenant/public/site/media/${encodeURIComponent(id)}/${w}.${format} ${w}w`)
    .join(", ");
}

/* ── the group story (§9.1) ────────────────────────────────────────────────
 *
 * PR 4 read one field from `/public/site/about` — `esg` — because §8.4 needed
 * it and §9.1 owned the page. This is the rest of it.
 */

/** One person, group tier or entity tier. §6.7: one table with a nullable
 *  `entity_id`, so one renderer draws both and they cannot disagree. */
export type PublicLeader = {
  id: string;
  name: string;
  role: Bilingual;
  bio: Bilingual;
  photo_id: string | null;
  photo_variants: MediaVariants;
  linkedin_url: string | null;
};

/** One dated moment in the company's story. `year` is required upstream; the
 *  label is the tenant's own words. */
export type TimelineEntry = {
  year: number;
  label: string;
  text: string;
};

export type PublicAbout = {
  headline: string;
  summary: string;
  mission: string;
  vision: string;
  principles: Array<{ label: string; text: string }>;
  esg: EsgContent;
  timeline: TimelineEntry[];
  foundedYear: number | null;
  headquarters: string | null;
  leaders: PublicLeader[];
};

type RawBilingual = { fr?: unknown; en?: unknown };
type RawItem = { label_fr?: unknown; label_en?: unknown; text_fr?: unknown; text_en?: unknown };

const bi = (v: unknown): Bilingual => {
  const r = (v || {}) as RawBilingual;
  return { fr: String(r.fr ?? ""), en: r.en == null ? null : String(r.en) };
};

const read = (v: unknown, lang: Lang): string => pickBilingual(bi(v), lang);

/** A `{label_fr, label_en, text_fr, text_en}` row, read in the visitor's
 *  language. The shape `site_about.principles` and `.timeline` both store. */
const readItem = (raw: RawItem, lang: Lang) => ({
  label: pickBilingual(
    { fr: String(raw.label_fr ?? ""), en: raw.label_en == null ? null : String(raw.label_en) },
    lang,
  ),
  text: pickBilingual(
    { fr: String(raw.text_fr ?? ""), en: raw.text_en == null ? null : String(raw.text_en) },
    lang,
  ),
});

const readLeader = (raw: unknown): PublicLeader => {
  const l = (raw || {}) as Record<string, unknown>;
  return {
    id: String(l.id ?? ""),
    name: String(l.name ?? ""),
    role: bi(l.role),
    bio: bi(l.bio),
    photo_id: l.photo_id == null ? null : String(l.photo_id),
    photo_variants: (l.photo_variants as MediaVariants) ?? null,
    linkedin_url: l.linkedin_url == null ? null : String(l.linkedin_url),
  };
};

/**
 * The whole group story, read in the visitor's language.
 *
 * ── THE TIMELINE IS SORTED HERE AND NOT IN SQL ────────────────────────────
 *
 * `site_about.timeline` is a jsonb array in the order a tenant dragged the rows
 * into, which is the order they want to EDIT in and not necessarily the order
 * time happened in. §9.1 draws it as depth — 2021 above 2024 — so the drawing
 * would be wrong for any tenant who added a founding year after writing three
 * later entries. Sorted by year, stably, so two entries in the same year keep
 * the tenant's own ordering between them.
 *
 * Entries with no usable year are DROPPED rather than placed at one end. A
 * scroll-scrubbed timeline puts a position on every entry, and an entry with no
 * date has no position that is not a guess.
 */
export function getPublicAbout(opts: { lang: Lang; signal?: AbortSignal }) {
  return publicGet<Record<string, unknown>>("/public/site/about", { signal: opts.signal })
    .then((raw): PublicAbout => {
      const a = raw || {};
      const lang = opts.lang;
      const timeline = (Array.isArray(a.timeline) ? a.timeline : [])
        .map((row) => {
          const r = (row || {}) as RawItem & { year?: unknown };
          const year = Number(r.year);
          return Number.isFinite(year) && year > 0
            ? { year, ...readItem(r, lang) }
            : null;
        })
        .filter((r): r is TimelineEntry => r !== null)
        .sort((x, y) => x.year - y.year);

      return {
        headline: read(a.headline, lang),
        summary: read(a.summary, lang),
        mission: read(a.mission, lang),
        vision: read(a.vision, lang),
        principles: (Array.isArray(a.principles) ? a.principles : [])
          .map((row) => readItem((row || {}) as RawItem, lang))
          .filter((r) => r.label || r.text),
        esg: {
          environment: pillar((a.esg as Record<string, unknown>)?.environment, lang),
          social: pillar((a.esg as Record<string, unknown>)?.social, lang),
          governance: pillar((a.esg as Record<string, unknown>)?.governance, lang),
        },
        timeline,
        foundedYear: Number.isFinite(Number(a.founded_year)) ? Number(a.founded_year) : null,
        headquarters: a.headquarters == null ? null : String(a.headquarters),
        leaders: (Array.isArray(a.leaders) ? a.leaders : []).map(readLeader),
      };
    })
    /* Every failure is the same answer, for the reason `getSitePage` states. An
       unwritten story, a tenant without the `website` package and a network
       error are three facts server-side and one fact here — there is nothing to
       draw — and the About page renders its own empty state rather than an
       error plate on a marketing surface. */
    .catch((): PublicAbout => EMPTY_ABOUT);
}

export const EMPTY_ABOUT: PublicAbout = {
  headline: "",
  summary: "",
  mission: "",
  vision: "",
  principles: [],
  esg: { environment: null, social: null, governance: null },
  timeline: [],
  foundedYear: null,
  headquarters: null,
  leaders: [],
};

/* ── partners, clients and credentials (§9.4) ──────────────────────────────
 *
 * THREE CLAIMS, AND THE `kind` COLUMN IS WHAT KEEPS THEM APART. 13782's header
 * carries the argument; the short version is that "we move cargo on these
 * lines", "these organisations trust us" and "we are a member of this" are
 * three different assertions, and one grid makes none of them. N11 forbids the
 * undifferentiated wall.
 *
 * `permission_note` is never in this payload and cannot be: the read builds an
 * explicit object and filters on the note as well as on `is_active`, and 13782
 * makes an active row without one impossible in the first place.
 */
export type PartnerKind = "carrier" | "client" | "network";

export type PublicPartner = {
  id: string;
  name: string;
  kind: PartnerKind;
  logo_id: string | null;
  logo_variants: MediaVariants;
  url: string | null;
};

export type PublicCredential = {
  id: string;
  name: string;
  issuer: string | null;
  identifier: string | null;
  issued_on: string | null;
  expires_on: string | null;
  logo_id: string | null;
  logo_variants: MediaVariants;
  url: string | null;
};

export type PublicProof = {
  partners: PublicPartner[];
  credentials: PublicCredential[];
};

export const EMPTY_PROOF: PublicProof = { partners: [], credentials: [] };

export const getPublicProof = (opts: { signal?: AbortSignal } = {}) =>
  publicGet<PublicProof>("/public/site/partners", { signal: opts.signal })
    .then((r) => ({
      partners: Array.isArray(r?.partners) ? r.partners : [],
      credentials: Array.isArray(r?.credentials) ? r.credentials : [],
    }))
    .catch(() => EMPTY_PROOF);

/** Partners of one kind, in the order the server sent them (kind, sort_order,
 *  name — 13782's index). */
export const partnersOfKind = (proof: PublicProof, kind: PartnerKind) =>
  proof.partners.filter((p) => p.kind === kind);

/* ── social links (§9.5) ───────────────────────────────────────────────────
 *
 * Only platforms with a URL exist. 13781 DELETES a row rather than storing an
 * empty string, precisely so that "registered" and "has a link" cannot come
 * apart — a footer icon linking nowhere is worse than one icon fewer.
 */
export type SocialLink = { platform: string; url: string };

export const listPublicSocial = (opts: { signal?: AbortSignal } = {}) =>
  publicGet<SocialLink[]>("/public/site/social", { signal: opts.signal })
    .then((rows) =>
      (Array.isArray(rows) ? rows : []).filter(
        (r): r is SocialLink =>
          !!r && typeof r.platform === "string" && typeof r.url === "string" && !!r.url,
      ),
    )
    .catch((): SocialLink[] => []);
