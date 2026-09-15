import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * §8.7's first acceptance criterion, as a test rather than as a screenshot.
 *
 * "Every route in `router.tsx` has a designed entrance."
 *
 * ── WHY A SOURCE TEST AND NOT A RENDER TEST ────────────────────────────────
 *
 * Rendering each route would need a fixture per endpoint, a router per page and
 * a fetch stub per feature — and it would still only cover the routes somebody
 * remembered to add. The failure this criterion protects against is a NEW route
 * shipping without an entrance, which is precisely the case a hand-listed
 * render test cannot see: the list and the router drift, and the test passes
 * because it never knew about the new page.
 *
 * So the route table is read from `router.tsx` itself, and every page component
 * it names must carry an entrance. The list of routes is derived, never
 * declared, for the same reason `insight-article.test.js` says a filter bar
 * must be derived from the data: a hardcoded list can only lose entries.
 *
 * ── WHAT COUNTS AS AN ENTRANCE ─────────────────────────────────────────────
 *
 * A band that carries the page's `<h1>`. Three shapes qualify, and each is a
 * deliberate part of the design system rather than a way to pass this test:
 *
 *   `band-hero`     the marketing plate, on every index and lookup route
 *   `band-service`  §8.2's mode-lit plate, for one service
 *   `band band-muted` the document header, for the routes below that are
 *                   deliberately NOT marketing
 *
 * The last is the interesting one and it is why this test has an exceptions
 * table with reasons rather than a single rule.
 */

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/**
 * Page components that open with a DOCUMENT header rather than a marketing
 * plate, each with the reason. This is not a way out of the criterion — every
 * one of them still has a designed entrance — it is a statement that the
 * entrance is a different kind on purpose.
 */
const DOCUMENT_HEADER: Record<string, string> = {
  "features/proposals/proposal-page.tsx":
    "a priced document addressed to one recipient, reached by a token and often printed. Its own comment argues the case: the badge pill and the accent word are marketing grammar, and colouring half of somebody's proposal title is a liberty a quote does not get to take.",
  "features/insights/insight-page.tsx":
    "long-form, which §1.5 exempts in as many words — a reader who clicked an article wants an article. It opens with the date, the title and the byline, and §8.6's reading rail is its affordance. A marketing plate on an essay is how a serious piece starts reading as an advertisement.",
};

/** Every `element={<X />}` the router mounts, paired with the module it lazily
 *  imports. Derived from the file, so a route added tomorrow is covered. */
type Routed = { file: string; exported: string };

function routedComponents(): Map<string, Routed> {
  const router = read("app/router.tsx");
  const byName = new Map<string, Routed>();

  // `const Track = lazy(() => import("@/features/tracking/track-page"), "TrackPage");`
  const lazyRe =
    /const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\("@\/([^"]+)"\)\s*,\s*"(\w+)"/g;
  for (const m of router.matchAll(lazyRe))
    byName.set(m[1], { file: `${m[2]}.tsx`, exported: m[3] });

  /*
   * STATIC IMPORTS TOO, and missing them was a real hole in the first version
   * of this file.
   *
   * `NotFoundPage` is imported eagerly — the router's own comment explains why
   * ("the boundary is loaded eagerly because a page that cannot render without
   * a second request would flash") — so a parser that only understood
   * `lazy(...)` never saw the 404 route at all. It was the one route this test
   * was least likely to cover and the one most likely to be left undesigned,
   * which is a bad combination. Proved: with only the lazy branch, reverting
   * the 404 to a bare heading kept this file green.
   */
  // `import { NotFoundPage } from "@/features/not-found/not-found-page";`
  const staticRe = /import\s*\{\s*([\w,\s]+?)\s*\}\s*from\s*"@\/(features\/[^"]+)"/g;
  for (const m of router.matchAll(staticRe)) {
    for (const name of m[1].split(",").map((n) => n.trim())) {
      if (name) byName.set(name, { file: `${m[2]}.tsx`, exported: name });
    }
  }

  const mounted = new Map<string, Routed>();
  // `<Route path={p("/track")} element={<Track />} />`
  for (const m of router.matchAll(/element=\{<(\w+)\s*\/>\}/g)) {
    const hit = byName.get(m[1]);
    if (hit) mounted.set(m[1], hit);
  }
  return mounted;
}

const ENTRANCE = /class[Nn]ame="band-hero|className="band-service|className="band band-muted/;

describe("§8.7 — every route has a designed entrance", () => {
  const mounted = routedComponents();

  it("finds the route table, so this test cannot pass by reading nothing", () => {
    // The parser depends on how `router.tsx` is written. If that file is
    // reshaped, this fails loudly rather than reporting zero routes and a tick
    // — which is the F-12 failure shape (a gate that passes by not looking).
    expect(mounted.size).toBeGreaterThanOrEqual(12);
  });

  /**
   * Does this page open with an entrance of its own?
   *
   * ── AND WHY IT DOES NOT SIMPLY GREP THE IMPORTS ───────────────────────────
   *
   * The first version of this appended the source of every `@/components/site/*`
   * the page imported, so that the homepage — whose entrance is `<Hero />` —
   * would be seen. It passed, and it was WRONG: `section.tsx` contains both
   * `band-hero` and `band band-muted` in its variant table, and every page in
   * the app imports `Section`. So every page inherited an entrance and the
   * check could not fail. Proved by reverting the 404 to a bare heading, which
   * it happily accepted.
   *
   * That is a false green of exactly the shape §3.4 keeps recording, and the
   * fix is to stop inferring. A page qualifies if its OWN source carries a band
   * class, or if it renders one of the named entrance COMPONENTS below — a
   * closed list, not a pattern.
   */
  const ENTRANCE_COMPONENTS: Array<[RegExp, string]> = [
    [/<Hero\b/, "components/site/hero.tsx"],
  ];

  /**
   * ONE EXPORTED COMPONENT'S BODY, not the whole file.
   *
   * Three files in this app export two routes each — the services, portfolio
   * and careers pages each hold an index and a detail view. Checking the FILE
   * meant a bare index passed because the detail view further down had a band,
   * which is the second false green this test produced before it was trusted:
   * reverting the portfolio index to a heading on white kept it green, because
   * `PortfolioStoryPage` still had its document header.
   *
   * The slice runs from this component's `export function` to the next one, so
   * a route is judged on the markup it actually renders.
   */
  function componentBody(file: string, exported: string): string {
    const source = read(file);
    const start = source.indexOf(`export function ${exported}(`);
    if (start < 0) return source; // not a function export — judge the file
    const next = source.indexOf("\nexport function ", start + 1);
    return source.slice(start, next < 0 ? undefined : next);
  }

  function hasEntrance({ file, exported }: Routed): boolean {
    const own = componentBody(file, exported);
    if (ENTRANCE.test(own)) return true;
    for (const [rendered, source] of ENTRANCE_COMPONENTS) {
      if (rendered.test(own) && ENTRANCE.test(read(source))) return true;
    }
    return false;
  }

  it("mounts no page component that lacks one", () => {
    const missing: string[] = [];
    for (const [name, routed] of mounted) {
      // The portal is an app behind a sign-in, not a marketing route: it has
      // its own chrome, and §8 is about the pages a stranger reaches.
      if (routed.file.includes("features/portal/")) continue;
      // A document header is a designed entrance of a different kind, declared
      // above with its reason.
      if (DOCUMENT_HEADER[routed.file]) continue;
      if (!hasEntrance(routed)) missing.push(`${name} (${routed.file})`);
    }
    expect(missing).toEqual([]);
  });

  it("keeps a written reason for every document-header route", () => {
    // An exceptions table with empty reasons is a list of things somebody
    // waved through. Same contract as check-motion's exemption list.
    for (const [file, why] of Object.entries(DOCUMENT_HEADER)) {
      expect(why.length).toBeGreaterThan(40);
      // …and the file it names has to exist, so the table cannot rot.
      expect(() => read(file)).not.toThrow();
    }
  });

  it("stages the headline immediately on every marketing entrance", () => {
    /*
     * F-17, generalised. PR 3 measured +691 ms of LCP from a headline that
     * starts at `opacity: 0`, and §8's premise is that every page now opens
     * with one — so the defect is one missing prop away on each of them.
     *
     * The rule is narrow on purpose: it applies to `StagedLines` inside a
     * marketing plate. The article page stages nothing at all (§1.5 exempts
     * long-form, and animating a document's title makes it read as marketing),
     * so it is not caught by this and should not be.
     */
    const unstaged: string[] = [];
    for (const [name, routed] of mounted) {
      const { file } = routed;
      if (file.includes("features/portal/")) continue;
      if (DOCUMENT_HEADER[file]) continue;
      const source = componentBody(file, routed.exported);
      if (!/className="band-hero/.test(source)) continue;
      if (!source.includes("<StagedLines")) {
        unstaged.push(`${name} (${file}) — plate with no staged headline`);
        continue;
      }
      // Every StagedLines inside a page that has a plate must paint at once.
      for (const m of source.matchAll(/<StagedLines([\s\S]{0,120}?)\/>/g)) {
        if (!m[1].includes("paintImmediately")) {
          unstaged.push(`${name} (${file}) — StagedLines without paintImmediately`);
        }
      }
    }
    expect(unstaged).toEqual([]);
  });
});
