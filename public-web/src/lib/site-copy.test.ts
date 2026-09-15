import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import i18n, { setLang, tList } from "@/lib/i18n";
import {
  applySiteCopy,
  initSiteCopy,
  readCachedSiteCopy,
  writeCachedSiteCopy,
  type CopyOverlay,
} from "@/lib/site-copy";

/**
 * The copy overlay — a tenant's own words over the app's own strings.
 *
 * ── WHAT THESE PIN ─────────────────────────────────────────────────────────
 *
 * Two failure modes, and the second is the one that would have shipped.
 *
 *   1. A malformed payload must be discarded, not applied. Same argument as
 *      `site-theme.test.ts`: a proxy's error page parsed as JSON reaching
 *      `addResourceBundle` is a boot-time throw, which for a client-rendered
 *      app is a blank marketing site.
 *
 *   2. Five dictionary sections are ARRAYS (`site.how.steps`,
 *      `site.services.items`, `site.quote.steps`, `site.preview.stages`,
 *      `site.contact.promise`) and `tList()` returns `[]` for anything that is
 *      not one. A merge that turned an array into an object keyed "0","1"
 *      would not throw, would not fail typecheck, and would silently empty the
 *      how-it-works band, the service cards and the quote wizard's step list on
 *      every tenant who overrode a single word in any of them.
 */

/** Restore the shipped dictionary between tests. `addResourceBundle` mutates a
 *  module-level store, so an override applied in one test is still there in the
 *  next one — which would make these pass in isolation and lie in a suite. */
const DICT = JSON.parse(
  JSON.stringify({
    en: i18n.getResourceBundle("en", "translation"),
    fr: i18n.getResourceBundle("fr", "translation"),
  }),
) as Record<string, unknown>;

beforeEach(() => {
  setLang("en");
  localStorage.clear();
});

afterEach(() => {
  for (const lang of ["en", "fr"] as const) {
    // `deep = false, overwrite = true` replaces the bundle outright rather than
    // merging the pristine copy over the polluted one, which would leave an
    // override in place wherever the two agree.
    i18n.addResourceBundle(lang, "translation", DICT[lang], false, true);
  }
  vi.unstubAllGlobals();
});

const overlay = (site: Record<string, unknown>): CopyOverlay => ({
  en: { site },
  fr: { site },
});

describe("applySiteCopy", () => {
  it("replaces a shipped string with the tenant's", () => {
    expect(i18n.t("site.portfolioPage.titleMain")).toBe("Success");
    applySiteCopy(overlay({ portfolioPage: { titleMain: "Reference" } }));
    expect(i18n.t("site.portfolioPage.titleMain")).toBe("Reference");
  });

  it("leaves the strings the tenant did not override alone", () => {
    const sub = i18n.t("site.portfolioPage.sub");
    applySiteCopy(overlay({ portfolioPage: { titleMain: "Reference" } }));
    expect(i18n.t("site.portfolioPage.sub")).toBe(sub);
  });

  it("keeps a list a list, and the untouched items intact", () => {
    const before = tList<{ t: string; d: string }>("site.how.steps");
    expect(before.length).toBeGreaterThan(1);

    applySiteCopy(overlay({ how: { steps: { 0: { t: "Tell us the lane" } } } }));

    const after = tList<{ t: string; d: string }>("site.how.steps");
    expect(after).toHaveLength(before.length);
    expect(after[0].t).toBe("Tell us the lane");
    // The overridden item's OTHER field, and the items beside it, survive.
    expect(after[0].d).toBe(before[0].d);
    expect(after[1]).toEqual(before[1]);
  });

  it("does not reach outside site.*", () => {
    const shipped = i18n.t("errors.loadFailed");
    applySiteCopy({
      en: { site: {}, errors: { loadFailed: "pwned" } },
      fr: { site: {}, errors: { loadFailed: "pwned" } },
    } as unknown as CopyOverlay);
    expect(i18n.t("errors.loadFailed")).toBe(shipped);
  });

  it("applies French to the French dictionary only", () => {
    applySiteCopy({
      en: { site: { portfolioPage: { titleMain: "Reference" } } },
      fr: { site: { portfolioPage: { titleMain: "Références" } } },
    });
    expect(i18n.t("site.portfolioPage.titleMain")).toBe("Reference");
    setLang("fr");
    expect(i18n.t("site.portfolioPage.titleMain")).toBe("Références");
  });
});

describe("the cache", () => {
  it("round-trips a payload", () => {
    const payload = overlay({ portfolioPage: { titleMain: "Reference" } });
    writeCachedSiteCopy(payload);
    expect(readCachedSiteCopy()).toEqual(payload);
  });

  it("discards a cache written by an older version of this app", () => {
    localStorage.setItem("praxis.site-copy.v1", JSON.stringify({ site: { hero: {} } }));
    expect(readCachedSiteCopy()).toBeNull();
  });

  it("discards unparseable storage rather than throwing on boot", () => {
    localStorage.setItem("praxis.site-copy.v1", "{not json");
    expect(readCachedSiteCopy()).toBeNull();
  });
});

describe("initSiteCopy", () => {
  const respond = (body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

  it("applies the cache before the network answers", async () => {
    writeCachedSiteCopy(overlay({ portfolioPage: { titleMain: "Cached" } }));
    respond({ data: overlay({ portfolioPage: { titleMain: "Fresh" } }) });

    const pending = initSiteCopy();
    // Synchronously, before the fetch resolves — this is the whole reason the
    // cache exists: a returning visitor must not watch our heading flip to
    // theirs.
    expect(i18n.t("site.portfolioPage.titleMain")).toBe("Cached");
    await pending;
    expect(i18n.t("site.portfolioPage.titleMain")).toBe("Fresh");
  });

  it("leaves the dictionary standing when the read fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(initSiteCopy()).resolves.toBeUndefined();
    expect(i18n.t("site.portfolioPage.titleMain")).toBe("Success");
  });

  it("leaves the dictionary standing when the server answers nonsense", async () => {
    respond({ data: { not: "an overlay" } });
    await initSiteCopy();
    expect(i18n.t("site.portfolioPage.titleMain")).toBe("Success");
    // …and does not cache it, so the next boot is not poisoned either.
    expect(readCachedSiteCopy()).toBeNull();
  });
});
