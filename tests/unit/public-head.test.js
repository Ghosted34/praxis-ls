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

describe("robots.txt", () => {
  test("a workspace host asks not to be indexed at all", () => {
    // There is nothing behind a staff login for a crawler to find, and saying so
    // is cheaper than letting one discover the login wall by crawling into it.
    const txt = head.robots("https://smartls.praxisls.com", false);
    expect(txt).toContain("Disallow: /");
    expect(txt).not.toContain("Allow: /");
    expect(txt).not.toContain("Sitemap:");
  });

  test("a public host allows crawling but keeps tokenised links out of the index", () => {
    const txt = head.robots("https://smartls.cm", true);
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
