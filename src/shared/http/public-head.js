"use strict";

/**
 * What a crawler and a chat app see.
 *
 * `public-web/` assembles its pages in the browser, so anything that does not run
 * JavaScript — Slack, WhatsApp, LinkedIn, Bing — receives the shell:
 * `<title>Praxis</title>` and an empty `<div id="root">`. A forwarded proposal
 * link, which is the most-shared URL this product produces, arrives as a blank
 * grey card carrying the vendor's name rather than the tenant's.
 *
 * This module fixes the half that needs no rendering engine: the `<head>`. The
 * server already answers these paths with `index.html`; it now answers with an
 * `index.html` whose title, description, canonical and Open Graph tags describe
 * the actual page. The body is still empty, so this is not SSR and does not
 * pretend to be — but a preview card and a search result are built from the head,
 * and the head was what was missing.
 *
 * WHY A DATABASE READ IS SAFE HERE. Only for HTML navigations (assets never
 * reach this), only for the three paths in ROUTES, memoised per host+path, and
 * wrapped so that ANY failure serves the untouched shell. A page without preview
 * tags is a poor card; a page that 500s because the registry hiccuped is a broken
 * site. The fallback is always the file.
 */

const fs = require("fs");
const path = require("path");
const registry = require("../../services/tenant/registry.service");
const { logger } = require("../../config/logger");
const paths = require("./public-web-paths");

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map();

function memo(key, produce) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
  return Promise.resolve(produce()).then((value) => {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + TTL_MS });
    return value;
  });
}

/** Drop a host's memoised heads — called when its registry row changes. */
function invalidateHost(host) {
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(String(host) + " ")) cache.delete(k);
  }
}

const esc = (s) =>
  String(s === null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** One line of text, no markup, trimmed to what a card will actually show. */
function summarise(input, max = 200) {
  const flat = String(input || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

async function withTenant(host, fn) {
  const meta = await registry.resolveByHost(host);
  if (!meta || meta.status !== "LIVE") return null;
  // LIVE schema, always: these pages are the shop window, and a sandbox row has
  // no business being described to a crawler. Mirrors `req.tenantDbIn("live")`,
  // which every public route already pins itself to.
  return registry.withTenantConnection(meta, "live", fn);
}

/**
 * Each entry turns a path into `{ title, description, image }`, or null when the
 * record is not published — in which case the shell's own defaults stand rather
 * than a card describing a page the reader cannot open.
 *
 * The patterns are BASE-RELATIVE — `/portfolio/:slug`, not
 * `/public/portfolio/:slug` — and `headFor` strips the host's base before
 * matching. They were absolute once, which meant a tenant who renamed the prefix
 * to `/site`, or brought their own domain (where the site is served at the
 * root), silently lost every link preview: the regex stopped matching and every
 * page fell back to the shell's generic title. Nothing errored; the cards just
 * went blank.
 */
const ROUTES = [
  {
    test: /^\/proposals\/([^/]+)\/?$/,
    load: (client, token) =>
      require("../../modules/sales/proposal_public/proposal_public.service").get(
        client,
        decodeURIComponent(token),
      ),
    shape: (doc) =>
      !doc
        ? null
        : {
            title: doc.title || doc.doc_number || null,
            description: summarise(doc.summary || doc.intro),
          },
  },
  {
    test: /^\/careers\/([^/]+)\/?$/,
    load: (client, token) =>
      require("../../modules/hr/careers/careers.service").findByToken(
        client,
        decodeURIComponent(token),
      ),
    shape: (v) =>
      !v
        ? null
        : {
            title: v.title || null,
            description: summarise(v.summary || v.description),
          },
  },
  {
    test: /^\/portfolio\/([^/]+)\/?$/,
    load: (client, slug) =>
      require("../../modules/sales/portfolio_public/portfolio_public.service").get(
        client,
        decodeURIComponent(slug),
      ),
    shape: (s) =>
      !s
        ? null
        : {
            title: s.title || null,
            description: summarise(s.summary || s.body),
            image: s.cover_url || null,
          },
  },
];

async function headFor(host, urlPath, origin, base) {
  const branding = await withTenant(host, (client) =>
    require("../../modules/branding/branding.service").getBranding(client),
  ).catch(() => null);
  const name = (branding && branding.name) || "Praxis";

  // The path as the ROUTES table sees it: with this host's base removed, so
  // `/site/portfolio/x`, `/public/portfolio/x` and (on the tenant's own domain)
  // `/portfolio/x` all reach the same entry. null means the path is not under
  // the base at all, and nothing here describes it.
  const rel = paths.stripBase(urlPath, base);

  let page = null;
  for (const r of ROUTES) {
    const m = rel === null ? null : r.test.exec(rel);
    if (!m) continue;
    page = await withTenant(host, (client) => r.load(client, m[1]))
      .then((row) => r.shape(row))
      .catch(() => null);
    break;
  }

  const title = page && page.title ? page.title + " · " + name : name;
  const description = (page && page.description) || null;
  const image = (page && page.image) || (branding && branding.logoUrl) || null;
  const canonical = origin + urlPath;

  const tags = [
    // The marketing prefix this host is configured for. The app reads it at boot
    // (lib/base-path.ts) and builds every link from it, so the prefix is a
    // per-tenant setting rather than a constant compiled into the bundle. It
    // rides in the head because the head is already being rewritten per request
    // for the tags below — one pass, no extra request, and no build-time
    // variable that could disagree with the database.
    '<meta name="praxis:public-base" content="' + esc(base || paths.DEFAULT_BASE) + '" />',
    "<title>" + esc(title) + "</title>",
    '<link rel="canonical" href="' + esc(canonical) + '" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="' + esc(name) + '" />',
    '<meta property="og:title" content="' + esc(title) + '" />',
    '<meta property="og:url" content="' + esc(canonical) + '" />',
    '<meta name="twitter:card" content="' +
      (image ? "summary_large_image" : "summary") +
      '" />',
  ];
  if (description) {
    tags.push('<meta name="description" content="' + esc(description) + '" />');
    tags.push('<meta property="og:description" content="' + esc(description) + '" />');
  }
  if (image) {
    // Absolute, because a card is rendered by a server elsewhere that has no idea
    // what this page's origin was.
    const abs = /^https?:\/\//i.test(image) ? image : origin + image;
    tags.push('<meta property="og:image" content="' + esc(abs) + '" />');
  }
  return tags.join("\n    ");
}

/**
 * Replace the shell's own title and description with the page's.
 *
 * Removed rather than duplicated: two titles is a card that picks one at random.
 */
function applyHead(html, tags) {
  return html
    .replace(/\s*<title>[\s\S]*?<\/title>/i, "")
    .replace(/\s*<meta\s+name="description"[^>]*>/i, "")
    .replace(/\s*<meta\s+property="og:type"[^>]*>/i, "")
    // The shell ships this one with the default in it; two would be read as one
    // at random by `querySelector`, and the stale one usually wins.
    .replace(/\s*<meta\s+name="praxis:public-base"[^>]*>/i, "")
    .replace("</head>", "  " + tags + "\n  </head>");
}

function robots(origin, servesPublic, base) {
  if (!servesPublic) {
    // A workspace host has nothing a crawler should index, and saying so is
    // cheaper than letting one discover a login wall by crawling into it.
    return "User-agent: *\nDisallow: /\n";
  }
  return [
    "User-agent: *",
    "Allow: /",
    // Tokenised documents are shared deliberately, with one recipient. They stay
    // reachable by anyone holding the link — that is the point — but they should
    // not accumulate in a search index.
    //
    // Built from THIS host's base, not the literal "/public": a Disallow line
    // naming a path the host does not serve protects nothing, and the paths that
    // needed protecting stay open. That is the failure this file is otherwise
    // full of guards against.
    "Disallow: " + paths.joinBase(base, "/proposals/"),
    "Disallow: /portal/",
    "",
    "Sitemap: " + origin + "/sitemap.xml",
    "",
  ].join("\n");
}

async function sitemap(host, origin, base) {
  // `joinBase` and not `base + …`: on a host the site owns, the base is "/"
  // and naive concatenation emits "//track" — a URL a crawler treats as a
  // protocol-relative address, i.e. a different site.
  const at = (rest) => paths.joinBase(base, rest);
  const fixed = [at(""), at("/track"), at("/services"), at("/portfolio"), at("/careers")];
  const rows = await withTenant(host, async (client) => {
    const services = require("../../modules/operations/service_type_web_public/service_type_web_public.service");
    const portfolio = require("../../modules/sales/portfolio_public/portfolio_public.service");
    const careers = require("../../modules/hr/careers/careers.service");
    const out = [];
    // Each section is independent: a tenant with no case notes should still get a
    // sitemap of their services, not a 500.
    const sections = [
      [() => services.list(client), (r) => at("/services/" + encodeURIComponent(r.slug_en || r.slug_fr || ""))],
      [() => portfolio.list(client), (r) => at("/portfolio/" + encodeURIComponent(r.slug || ""))],
      [() => careers.list(client), (r) => at("/careers/" + encodeURIComponent(r.public_token || r.token || ""))],
    ];
    for (const [read, make] of sections) {
      try {
        const list = await read();
        for (const r of Array.isArray(list) ? list : []) {
          const u = make(r);
          if (u && !u.endsWith("/")) out.push(u);
        }
      } catch (err) {
        logger.warn({ err, host }, "sitemap section failed - omitted");
      }
    }
    return out;
  }).catch(() => []);

  const all = fixed.concat(rows || []);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ]
    .concat(all.map((u) => "  <url><loc>" + esc(origin + u) + "</loc></url>"))
    .concat(["</urlset>", ""])
    .join("\n");
}

/**
 * `res.sendFile`'s replacement for HTML navigations.
 *
 * Everything here is best-effort: on any failure `next()` runs and the plain file
 * is sent, which is exactly the behaviour that existed before this module.
 */
function makeHtmlSender(publicWebDir) {
  const indexPath = path.join(publicWebDir, "index.html");
  let cachedHtml = null;
  const readIndex = () => {
    if (cachedHtml === null) cachedHtml = fs.readFileSync(indexPath, "utf8");
    return cachedHtml;
  };

  return async function sendHtml(req, res, next) {
    try {
      const host = String(req.headers.host || "").toLowerCase().split(":")[0];
      const origin = req.protocol + "://" + req.headers.host;
      const base = req.publicBase || "/public";
      const tags = await memo(host + " " + base + " " + req.path, () =>
        headFor(host, req.path, origin, base),
      );
      res.type("html").send(applyHead(readIndex(), tags));
    } catch (err) {
      logger.warn({ err, path: req.path }, "head injection failed - serving the shell");
      return next();
    }
  };
}

module.exports = {
  makeHtmlSender,
  robots,
  sitemap,
  invalidateHost,
  applyHead,
  summarise,
};
