"use strict";

/**
 * The `<head>` a crawler and a chat app actually receive.
 *
 * `public-web` assembles its pages in the browser, so a forwarded link — a
 * proposal, a job advert — used to arrive at Slack or WhatsApp as the shell:
 * one generic title and no description. These assert the part that fixes it,
 * without a database: the module's two dependencies are stubbed in the require
 * cache, because what is under test is the string handling, and the database
 * path is already wrapped so that any failure serves the untouched file.
 */

/**
 * `jest.mock`, not `require.cache`.
 *
 * The first version of this file stubbed the two dependencies by writing into
 * `require.cache`, which does nothing under jest: it keeps its own module
 * registry, so the real `registry.service` loaded anyway and dragged in `pg` and
 * the env schema. `jest.mock` is hoisted above the requires and is the only
 * thing that actually intercepts here.
 */
jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveByHost: async () => null,
  withTenantConnection: async () => null,
}));
jest.mock("../../src/config/logger", () => ({
  logger: { warn() {}, info() {}, error() {} },
}));

const head = require("../../src/shared/http/public-head");

const SHELL = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="UTF-8" />',
  "    <title>Praxis</title>",
  '    <meta name="description" content="Freight, customs clearance." />',
  '    <meta property="og:type" content="website" />',
  "  </head>",
  '  <body><div id="root"></div></body>',
  "</html>",
].join("\n");

describe("public head injection", () => {
  const tags = [
    "<title>A proposal · Smart Logistics</title>",
    '<meta name="description" content="Sea freight, Douala to Kribi." />',
  ].join("\n    ");

  test("the shell's own title does not survive alongside the page's", () => {
    // Two <title> elements is a preview card picking one at random.
    const out = head.applyHead(SHELL, tags);
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out).toContain("A proposal · Smart Logistics");
    expect(out).not.toContain("<title>Praxis</title>");
  });

  test("the shell's placeholder description is replaced, not duplicated", () => {
    const out = head.applyHead(SHELL, tags);
    expect(out.match(/name="description"/g)).toHaveLength(1);
    expect(out).toContain("Douala to Kribi");
    expect(out).not.toContain("Freight, customs clearance.");
  });

  test("the tags land inside <head>, before it closes", () => {
    const out = head.applyHead(SHELL, tags);
    expect(out.indexOf("A proposal")).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain('<div id="root">'); // body untouched — this is not SSR
  });

  test("summaries are flattened, stripped of markup, and cut on a word", () => {
    expect(head.summarise("  <p>One  <b>two</b>\nthree </p> ")).toBe("One two three");
    const long = head.summarise("word ".repeat(80), 40);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/\s…$/); // cut at a boundary, not mid-space
  });

  test("summarise tolerates null and undefined", () => {
    expect(head.summarise(null)).toBe("");
    expect(head.summarise(undefined)).toBe("");
  });
});

describe("the base a host serves the site at", () => {
  const paths = require("../../src/shared/http/public-web-paths");

  test("robots names the proposals path THIS host actually serves", () => {
    // The Disallow line was the literal "/public/proposals/" whatever the host
    // served. On a `/site` host, or on a domain the client brought (where the
    // site is at the root), that line names a path that does not exist — so it
    // protects nothing, and the tokenised proposals it was written to keep out
    // of search engines stay crawlable. A rule that is present and wrong is
    // worse than one that is absent, because it reads as covered.
    expect(head.robots("https://x.cm", true, "/public")).toContain(
      "Disallow: /public/proposals/",
    );
    expect(head.robots("https://x.cm", true, "/site")).toContain(
      "Disallow: /site/proposals/",
    );
    expect(head.robots("https://smartls.cm", true, "/")).toContain(
      "Disallow: /proposals/",
    );
    // …and never the doubled slash, which a crawler reads as another host.
    expect(head.robots("https://smartls.cm", true, "/")).not.toContain("//proposals");
  });

  test("joinBase never emits a protocol-relative path at the root", () => {
    expect(paths.joinBase("/site", "/track")).toBe("/site/track");
    expect(paths.joinBase("/", "/track")).toBe("/track");
    expect(paths.joinBase("/", "")).toBe("/");
    expect(paths.joinBase("/site", "")).toBe("/site");
  });

  test("stripBase turns a host's URL into the path the head table matches", () => {
    // The three spellings of the same page, on three kinds of host.
    expect(paths.stripBase("/public/portfolio/x", "/public")).toBe("/portfolio/x");
    expect(paths.stripBase("/site/portfolio/x", "/site")).toBe("/portfolio/x");
    expect(paths.stripBase("/portfolio/x", "/")).toBe("/portfolio/x");
    // The base itself is the home page.
    expect(paths.stripBase("/site", "/site")).toBe("/");
    // Not under the base at all — nothing here describes it.
    expect(paths.stripBase("/login", "/site")).toBeNull();
    // A prefix match that is not a segment boundary is NOT under the base:
    // /sitemap.xml must not read as /site + "map.xml".
    expect(paths.stripBase("/sitemap.xml", "/site")).toBeNull();
  });
});

describe("robots.txt", () => {
  test("a workspace host asks not to be indexed at all", () => {
    // There is nothing behind a staff login for a crawler to find, and saying so
    // is cheaper than letting one discover the login wall by crawling into it.
    const txt = head.robots("https://smartls.praxisls.com", false, "/public");
    expect(txt).toContain("Disallow: /");
    expect(txt).not.toContain("Allow: /");
    expect(txt).not.toContain("Sitemap:");
  });

  test("a public host allows crawling but keeps tokenised links out of the index", () => {
    const txt = head.robots("https://smartls.cm", true, "/public");
    expect(txt).toContain("Allow: /");
    // Shared deliberately with one recipient; reachable by link, not by search.
    expect(txt).toContain("Disallow: /public/proposals/");
    expect(txt).toContain("Disallow: /portal/");
    expect(txt).toContain("Sitemap: https://smartls.cm/sitemap.xml");
  });
});

describe("cache invalidation", () => {
  test("a host's memoised heads can be dropped", () => {
    // Without this, a domain that just changed what it serves keeps describing
    // itself the old way for five minutes.
    expect(() => head.invalidateHost("smartls.cm")).not.toThrow();
  });
});

/**
 * ── THE SITEMAP AND THE ROUTER MUST AGREE ─────────────────────────────────
 *
 * §9.1's `/about` shipped in the header nav, the footer and `router.tsx`, and
 * NOT in the sitemap. Nothing failed: a crawler simply finds the page last, or
 * by following a link, and the one page a procurement officer searches for by
 * company name is the one that ranks worst.
 *
 * It was caught by the final pass (§9.6) reading the two files side by side —
 * which is not a thing anybody should have to remember to do. So the router's
 * own nav table is READ here and every entry in it must be in
 * `SITEMAP_ROUTES`.
 *
 * ── THE DERIVATION IS WHERE THIS GOES WRONG, SO IT IS ASSERTED FIRST ──────
 *
 * F-24: a test of this shape reports on a set it derived, and three times in
 * PR 4 the derivation was the bug rather than the assertion. The first case
 * below fails if the parse finds nothing, so an empty set cannot read as a
 * clean pass.
 */
describe("the sitemap covers every route the site's own nav offers", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const head = require("../../src/shared/http/public-head");
  const paths = require("../../src/shared/http/public-web-paths");

  const NAV_FILE = join(__dirname, "../../public-web/src/components/site/site-header.tsx");

  /** `{ to: p("/services"), … }` — every entry of the header's NAV table. */
  function navRoutes() {
    const src = readFileSync(NAV_FILE, "utf8");
    const table = src.slice(src.indexOf("const NAV = ["), src.indexOf("] as const;"));
    return [...table.matchAll(/p\("([^"]+)"\)/g)].map((m) => m[1]);
  }

  test("finds the nav table, so this cannot pass by reading nothing", () => {
    expect(navRoutes().length).toBeGreaterThanOrEqual(5);
  });

  test("every nav destination is in the sitemap", () => {
    const missing = navRoutes().filter((r) => !head.SITEMAP_ROUTES.includes(r));
    expect(missing).toEqual([]);
  });

  test("the sitemap lists the home page and no duplicates", () => {
    expect(head.SITEMAP_ROUTES).toContain("");
    expect(new Set(head.SITEMAP_ROUTES).size).toBe(head.SITEMAP_ROUTES.length);
  });

  test("every sitemap route joins its base without a protocol-relative path", () => {
    // "//about" is read by a crawler as the HOST `about` — a different site.
    for (const base of ["/public", "/site", "/"]) {
      for (const route of head.SITEMAP_ROUTES) {
        expect(paths.joinBase(base, route)).not.toMatch(/^\/\//);
      }
    }
  });
});
