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
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const paths = require("./public-web-paths");

/**
 * Hosts that must answer `noindex` and a blanket robots Disallow.
 *
 * `doc/PUBLIC_WEB_PLAN.md` §3.7: a staging copy competing with production in
 * search results is worse than no staging at all. It is the same content under
 * a different name, so a crawler treats it as a duplicate and may rank the
 * rehearsal instead of the real thing — discovered by the tenant when a
 * customer books against a test database.
 *
 * Read once at module load: this is deployment configuration, and a process
 * that needs a different answer is a process that needs restarting anyway.
 */
const NOINDEX_HOSTS = new Set(
  String(config.SEO_NOINDEX_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase().split(":")[0])
    .filter(Boolean),
);

const isNoindexHost = (host) =>
  NOINDEX_HOSTS.has(String(host || "").toLowerCase().split(":")[0]);

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
/**
 * JSON-LD, and why it is built here rather than in the browser.
 *
 * Structured data is read by crawlers that do not run JavaScript — the same
 * readers this whole module exists for. A `<script type="application/ld+json">`
 * appended by React is invisible to every one of them, which makes a
 * client-side implementation of §3.7 look complete and do nothing.
 *
 * ── ESCAPING IS NOT THE SAME PROBLEM AS THE META TAGS ─────────────────────
 *
 * `esc()` above produces HTML-attribute-safe text. Inside a `<script>` block
 * that is both wrong and unsafe: `&amp;` would be printed literally into the
 * JSON, and — the real hazard — a value containing `</script>` would close the
 * block early and everything after it would be parsed as markup. So the payload
 * is JSON.stringify'd and only the one sequence that can break out is escaped.
 * `<!--` gets the same treatment for the same reason.
 */
function ldScript(payload) {
  if (!payload) return null;
  const json = JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return '<script type="application/ld+json">' + json + "</script>";
}

/** Drop null/undefined/empty members so a sparse record does not emit
 *  `"description": null`, which validators flag and which tells a crawler the
 *  field was answered rather than absent. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

const absolute = (origin, url) =>
  !url ? null : /^https?:\/\//i.test(url) ? url : origin + url;

/**
 * The tenant, sitewide. Every public page carries it.
 *
 * `Organization` rather than `LocalBusiness`: a freight forwarder operating
 * through several ports is not one storefront, and claiming an address we do
 * not hold would be worse than claiming none. Name and logo are what branding
 * actually knows.
 */
function organizationLd(branding, origin) {
  const name = (branding && branding.name) || null;
  if (!name) return null;
  return compact({
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url: origin,
    logo: absolute(origin, branding && branding.logoUrl),
  });
}

/**
 * Where this page sits, for anything nested.
 *
 * Emitted only for a DETAIL page, because that is the only place a breadcrumb
 * is true: the index is one level down from home and a two-item trail restating
 * the page's own title is noise a validator will happily accept and no reader
 * benefits from.
 */
function breadcrumbLd(origin, base, trail) {
  if (!trail || trail.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => compact({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: step.path === null ? undefined : origin + paths.joinBase(base, step.path),
    })),
  };
}

/**
 * A vacancy, as Google Jobs reads it.
 *
 * WS4b calls this "not optional — it is what puts a listing into Google Jobs,
 * and the cheapest reach a careers page can buy." The fields below are the ones
 * that decide whether the listing is ACCEPTED: `title`, `description`,
 * `datePosted` and `hiringOrganization` are required, and a posting with no
 * `jobLocation` and no `jobLocationType` is rejected outright.
 *
 * Three judgements worth stating, because each has a wrong version that
 * validates:
 *
 *   · **`description` must be the real text, not the card summary.** Google's
 *     own guidance is the full HTML description; a 200-character teaser is a
 *     posting that looks thin next to every competitor's.
 *   · **A hidden salary emits NO `baseSalary`.** `publicVacancy` omits the
 *     numbers when `salary_hidden` is set, and inferring a band from anything
 *     else would republish exactly what the recruiter chose to withhold — into
 *     the one place it cannot be retracted from.
 *   · **`validThrough` only when the vacancy has a closing date.** Google
 *     removes a posting the moment that date passes, so guessing one would
 *     silently delist a role that is still open.
 *
 * The remote case uses `jobLocationType: "TELECOMMUTE"`, which is the only
 * accepted way to say it; a `jobLocation` of "Remote" is a posting Google places
 * in a town called Remote.
 */
function jobPostingLd(v, origin, branding) {
  if (!v || !v.title) return null;
  const name = (branding && branding.name) || null;

  const remote = String(v.work_mode || "").toUpperCase() === "REMOTE";
  const address = compact({
    "@type": "PostalAddress",
    addressLocality: v.location_city,
    addressRegion: v.location_state,
    addressCountry: v.location_country,
  });
  // More than just the "@type" key means at least one real component.
  const hasAddress = Object.keys(address).length > 1;

  const salary =
    !v.salary_hidden && (v.salary_min || v.salary_max)
      ? compact({
          "@type": "MonetaryAmount",
          currency: v.salary_currency || null,
          value: compact({
            "@type": "QuantitativeValue",
            minValue: v.salary_min ? Number(v.salary_min) : null,
            maxValue: v.salary_max ? Number(v.salary_max) : null,
            unitText: "MONTH",
          }),
        })
      : null;

  return compact({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: v.title,
    // The full description, not the card's summary.
    description: v.description || null,
    datePosted: v.published_at || null,
    validThrough: v.closes_on || null,
    employmentType: v.employment_type || null,
    hiringOrganization: name
      ? compact({
          "@type": "Organization",
          name,
          sameAs: origin,
          logo: absolute(origin, branding && branding.logoUrl),
        })
      : null,
    jobLocationType: remote ? "TELECOMMUTE" : null,
    jobLocation: hasAddress
      ? compact({ "@type": "Place", address })
      : null,
    baseSalary: salary,
    skills: Array.isArray(v.skills_required) && v.skills_required.length
      ? v.skills_required.join(", ")
      : null,
    experienceRequirements:
      v.experience_years_min === null || v.experience_years_min === undefined
        ? null
        : compact({
            "@type": "OccupationalExperienceRequirements",
            monthsOfExperience: Number(v.experience_years_min) * 12,
          }),
  });
}

/**
 * An article, for a reader that never runs the app.
 *
 * `datePublished` is the field WS5 exists to add: their site has no date on a
 * card, no `article:published_time`, and `og:type` of `website` — so a knowledge
 * hub with five pieces looks the same age forever, and a crawler has nothing to
 * rank recency on.
 *
 * `author` is a `Person` and not a string, because the name comes from a staff
 * record rather than from a translation key. Absent when the article is
 * unattributed — an author who has left sets the FK null, and inventing "Staff"
 * would be a byline nobody wrote.
 */
function articleLd(a, origin, branding, canonical) {
  if (!a || !a.title) return null;
  const name = (branding && branding.name) || null;
  return compact({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description || null,
    datePublished: a.published_at || null,
    image: absolute(origin, a.image),
    mainEntityOfPage: canonical,
    author: a.author
      ? compact({ "@type": "Person", name: a.author.name, jobTitle: a.author.title })
      : null,
    publisher: name
      ? compact({
          "@type": "Organization",
          name,
          logo: absolute(origin, branding && branding.logoUrl),
        })
      : null,
    keywords: Array.isArray(a.tags) && a.tags.length ? a.tags.join(", ") : null,
  });
}

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
            trail: [
              { name: "Careers", path: "/careers" },
              { name: v.title || "Vacancy", path: null },
            ],
            ld: (origin, branding) => jobPostingLd(v, origin, branding),
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
            trail: [
              { name: "Success stories", path: "/portfolio" },
              { name: s.title || "Story", path: null },
            ],
          },
  },
  {
    test: /^\/insights\/([^/]+)\/?$/,
    load: (client, slug) =>
      require("../../modules/content/insight/insight.service").getPublic(
        client,
        decodeURIComponent(slug),
      ),
    // `getPublic` THROWS a 404 for an unpublished or unknown slug rather than
    // returning null, and `headFor` catches it — so a draft falls back to the
    // shell's generic title instead of describing a page nobody can open.
    shape: (a) => {
      if (!a) return null;
      // FR first: the tenant is Cameroonian and French is the default. The head
      // is one document and cannot be bilingual, so it describes the article in
      // the language it was primarily written in.
      const title = a.title_fr || a.title_en || null;
      const description = summarise(a.excerpt_fr || a.excerpt_en || a.body_fr || a.body_en);
      return {
        title,
        description,
        image: a.cover_id ? "/api/tenant/public/insights/media/" + a.cover_id : null,
        trail: [
          { name: "Insights", path: "/insights" },
          { name: title || "Article", path: null },
        ],
        ld: (origin, branding, canonical) =>
          articleLd(
            {
              title,
              description,
              published_at: a.published_at,
              image: a.cover_id ? "/api/tenant/public/insights/media/" + a.cover_id : null,
              author: a.author,
              tags: a.tags,
            },
            origin,
            branding,
            canonical,
          ),
        // The one page on this site where og:type is genuinely `article`.
        ogType: "article",
        publishedTime: a.published_at || null,
      };
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
  const noindex = isNoindexHost(host);

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
    '<meta property="og:type" content="' + esc((page && page.ogType) || "website") + '" />',
    '<meta property="og:site_name" content="' + esc(name) + '" />',
    '<meta property="og:title" content="' + esc(title) + '" />',
    '<meta property="og:url" content="' + esc(canonical) + '" />',
    '<meta name="twitter:card" content="' +
      (image ? "summary_large_image" : "summary") +
      '" />',
  ];
  if (noindex) {
    // `noindex, nofollow` and not merely a robots.txt Disallow: a Disallow
    // stops a crawler READING the page but not INDEXING a URL it found linked
    // elsewhere, which is how a staging host ends up in results as a bare title
    // with no snippet. The meta tag is the one that removes it, and it is
    // emitted first so a truncating reader sees it.
    tags.unshift('<meta name="robots" content="noindex, nofollow" />');
  }
  if (page && page.publishedTime) {
    // The tag a reader's feed and a crawler both use to date the piece. Only
    // meaningful alongside og:type=article, which is why it rides with it.
    tags.push('<meta property="article:published_time" content="' + esc(page.publishedTime) + '" />');
  }
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

  // Structured data (§3.7). Skipped entirely on a noindex host: emitting rich
  // results markup on a page we are asking not to be indexed is at best wasted
  // bytes and at worst a staging vacancy in Google Jobs.
  if (!noindex) {
    const graphs = [organizationLd(branding, origin)];
    if (page && typeof page.ld === "function") graphs.push(page.ld(origin, branding, canonical));
    if (page && page.trail) graphs.push(breadcrumbLd(origin, base, page.trail));
    for (const g of graphs) {
      const script = ldScript(g);
      if (script) tags.push(script);
    }
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

function robots(origin, servesPublic, base, host) {
  if (isNoindexHost(host)) {
    // The rehearsal. Nothing here should be crawled, and the meta tag in the
    // head is what actually removes an already-indexed URL — this is the
    // cheaper half that stops the crawl in the first place.
    return "User-agent: *\nDisallow: /\n";
  }
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
  // `/quote` is in here because it is a conversion page with its own route
  // now, not a hash on the home page — a form somebody can be sent a link to is
  // a form a crawler should know exists.
  const fixed = [at(""), at("/track"), at("/quote"), at("/services"), at("/portfolio"), at("/careers"), at("/insights")];
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
      // Published articles only — listPublic filters, and an unpublished slug in
      // a sitemap is an invitation to crawl a 404.
      [
        async () => (await require("../../modules/content/insight/insight.service")
          .listPublic(client, { page: 1, perPage: 500 })).articles,
        (r) => at("/insights/" + encodeURIComponent(r.slug_fr || r.slug_en || "")),
      ],
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
  // Exported for the tests, which assert the structured data directly rather
  // than by parsing it back out of a `<head>` string.
  isNoindexHost,
  organizationLd,
  jobPostingLd,
  articleLd,
  breadcrumbLd,
  ldScript,
};
