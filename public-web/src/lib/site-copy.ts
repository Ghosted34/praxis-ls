/**
 * The tenant's own words for the strings the APP puts on their site —
 * `GET /public/site/copy`.
 *
 * ── WHAT THIS FIXES ────────────────────────────────────────────────────────
 *
 * `site-api.ts` lets a tenant override four BANDS of the home page. This
 * overrides the other 465 strings: the section headings, the empty states, the
 * form labels, the buttons, the legal line in the footer — every sentence in
 * `i18n-dict.ts` under `site.*`.
 *
 * They are not chrome. "Success stories / Operations we have run, in our own
 * words" is the headline of the Our-work page and a claim about the tenant's
 * business, written into a frontend bundle in words we chose for them. So is
 * "We publish case notes as work finishes", and "Freight that moves your
 * business forward", and the promise list on the contact page. On a white-label
 * product, a tenant who sells project cargo and would call that page
 * "Reference projects" had no way to say so and no way to discover that they
 * could not. Their only options were our sentence or an empty page.
 *
 * ── HOW IT IS APPLIED, AND WHY NOTHING ELSE CHANGED ───────────────────────
 *
 * As an i18next RESOURCE BUNDLE, merged over the dictionary. That is the whole
 * mechanism, and it is chosen because it costs nothing at the call sites: every
 * `t("site.…")` in the app already reads through i18next, so a band written two
 * years ago picks up a tenant's rewrite with no change to it. The alternative —
 * threading an overrides object through every component — is a diff across ~40
 * files that has to be repeated for every string added afterwards, which is the
 * kind of fix that is 90% done forever.
 *
 * `addResourceBundle(…, deep = true, overwrite = true)` merges INTO the arrays
 * the dictionary already holds (`site.how.steps`, `site.services.items`,
 * `site.quote.steps`, `site.preview.stages`, `site.contact.promise`) rather than
 * replacing them, so an override of one step's title leaves the other steps and
 * that step's other fields alone, and `tList()` still gets a real array back.
 * A tenant overriding one word of one step must not blank the two beside it.
 *
 * ── WHY THE CACHE IS READ SYNCHRONOUSLY AND THE FETCH IS NOT AWAITED ──────
 *
 * The overlay decides what the largest text on the page says, so a returning
 * visitor must never see our heading flip to theirs. The cached payload is
 * applied before the first render — the same trick `readCachedSiteTheme` uses
 * for the same reason, and the same storage failure modes handled the same way.
 *
 * A FIRST visit paints the dictionary and swaps when the answer lands, which is
 * deliberately the behaviour `marketing-page.tsx` already documents and had
 * already tried the alternative to: holding first paint behind this read blanks
 * the whole site for every tenant who has overridden nothing, which is every
 * tenant on day one, on the metered connection this app's payload budget exists
 * for. A brief swap for the few beats a white screen for the many.
 */
import i18n, { type Lang } from "./i18n";
import { publicGet } from "./api";

/** One language's overrides, shaped as the dictionary is: a `site` subtree of
 *  nested objects and arrays whose leaves are strings. */
export type CopyTree = Record<string, unknown>;

/** `{ en, fr }` — the server resolves each language before answering, so a
 *  tenant who wrote only French gets their French in both. Half a heading in
 *  their words and half in ours is the one outcome nobody would choose. */
export type CopyOverlay = Record<Lang, CopyTree>;

const CACHE_KEY = "praxis.site-copy.v1";

const isTree = (v: unknown): v is CopyTree =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** A payload this app can apply. Anything else — an older cache, a proxy's
 *  error page parsed as JSON, a half-written response — is not repaired, it is
 *  discarded: the dictionary underneath is always a complete, correct site. */
function isOverlay(v: unknown): v is CopyOverlay {
  return isTree(v) && isTree((v as CopyOverlay).en) && isTree((v as CopyOverlay).fr);
}

export const getSiteCopy = (): Promise<CopyOverlay | null> =>
  publicGet<CopyOverlay>("/public/site/copy")
    .then((v) => (isOverlay(v) ? v : null))
    /* Every failure is the same answer, for the reason `getSitePage` states: a
       tenant with no overrides, a tenant without the `website` package and a
       network error are three facts server-side and one fact here — there is
       nothing to override — and in all three the site reads as it shipped. */
    .catch(() => null);

export function readCachedSiteCopy(): CopyOverlay | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isOverlay(parsed) ? parsed : null;
  } catch {
    // A private window, cleared site data, or a browser refusing storage. The
    // network fetch still runs; there is simply nothing to apply first.
    return null;
  }
}

export function writeCachedSiteCopy(payload: CopyOverlay): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage quota or a blocked API. Caching is an optimisation, never a
    // requirement — swallowing this is correct.
  }
}

/**
 * Merge one overlay over the dictionary, in both languages.
 *
 * Only the `site` subtree is taken, and that is a real boundary rather than
 * tidiness. `errors.*`, `states.*` and `portal.*` are the sentences shown when
 * something FAILS and the vocabulary the client portal shares with the ERP — a
 * milestone that reads one way on the public page and another once the client
 * signs in is the inconsistency those sections sit at the top level to prevent.
 * The server's catalogue only contains `site.*` keys, so this is the second of
 * two locks on the same door; the one that survives a mistake in the other.
 */
export function applySiteCopy(payload: CopyOverlay): void {
  for (const lang of ["en", "fr"] as const) {
    const site = payload[lang]?.site;
    if (!isTree(site)) continue;
    i18n.addResourceBundle(lang, "translation", { site }, true, true);
  }
  /* i18next does not announce a bundle change, and `useTranslation` subscribes
     to `languageChanged` — so without this the words are in the store and on
     screen only after the next render that happens for some other reason. The
     root's `useLang()` listens to the same event, which is what re-renders the
     `tr()` call sites that have no hook of their own. */
  i18n.emit("languageChanged", i18n.language);
}

/**
 * Apply what is cached, then refresh from the network. Called once, before the
 * first render.
 *
 * Returns the promise so a test can await the refresh; nothing in the app does,
 * which is the point — see the header on why first paint is not held back.
 */
export function initSiteCopy(): Promise<void> {
  const cached = readCachedSiteCopy();
  if (cached) applySiteCopy(cached);
  return getSiteCopy().then((fresh) => {
    if (!fresh) return;
    applySiteCopy(fresh);
    writeCachedSiteCopy(fresh);
  });
}
