"use strict";

/**
 * The head of somebody else's page, read as data.
 *
 * A link preview wants five facts from an HTML document: a title, a description,
 * a site name, an image, and an icon. That is all this extracts, and the fact that
 * it is all it extracts is the security property — a parser that returned "all the
 * meta tags" would be a parser somebody eventually renders, and rendering
 * arbitrary markup from an untrusted page is the bug this module exists to avoid.
 * Everything here returns STRINGS, length-capped, resolved to absolute URLs.
 *
 * ── WHY A REGEX AND NOT A PARSER ────────────────────────────────────────────
 *
 * `sanitize-html` is in this repo because HTML has to be *output* safely; a real
 * DOM parser is not, because nothing here needs the tree. Head metadata is flat,
 * single-line-at-a-time, and the five facts survive even if the page around them
 * is malformed — which most pages on the open internet are. Adding `cheerio` to
 * read five attributes would be a dependency, a bundle, and a supply surface for
 * a task a bounded scan does, and a preview is allowed to be wrong about a page
 * whose HTML is broken in a way a browser forgives.
 *
 * Two things ARE stripped first, and both are the ways a page can lie to a
 * scanner that is not a browser:
 *
 *   · `<!-- … -->`  a commented-out `<meta property="og:image" …>` is not a
 *                    declaration, and a site that once had a preview image keeps
 *                    showing one in a chat card forever if comments are scanned
 *   · `<script>` / `<style>`  a document that writes its own metadata at runtime
 *                    is setting it for a browser after JavaScript runs. We do not
 *                    run JavaScript, and pretending otherwise means trusting the
 *                    bytes inside a script tag, which is where an attacker would
 *                    put a fake `og:title` if scanning the raw text were enough.
 *
 * ── THE ORDER IS THE SPEC ───────────────────────────────────────────────────
 *
 * `og:title` before `<title>`, `og:description` before `description` before
 * `twitter:description`, `og:image` before `twitter:image`. Not taste: the `og:`
 * set is what the page's author declared for exactly this purpose, and a fallback
 * only applies when that declaration is absent. `twitter:` comes last because a
 * site with `twitter:image` and no `og:image` is a site whose image is sized for a
 * different card than ours — showing it is better than showing nothing, and worse
 * than showing an `og:image`.
 */

/** The card's own limits, mirrored from the column CHECKs in
 *  `migrations/tenant/13990_comms_link_previews.sql`. Truncating here rather than
 *  letting the database refuse means a page with a 4kB `og:description` still gets
 *  a card with a shorter sentence, instead of no card at all. */
const LIMITS = Object.freeze({ title: 300, description: 600, siteName: 120 });

/** Entities that actually appear in head metadata. A full HTML entity table would
 *  be a dependency; `&nbsp;` inside a title is a spacing bug, and the numeric
 *  forms are what a JSON-escaped feed produces. */
const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  middot: "·",
  bull: "•",
  trade: "™",
  reg: "®",
  copy: "©",
};

function decodeEntities(value) {
  if (!value || value.indexOf("&") === -1) return value || "";
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z][a-z0-9]{1,10});/gi, (all, name) => {
      const hit = NAMED_ENTITIES[name.toLowerCase()];
      return hit === undefined ? all : hit;
    });
}

/** An out-of-range or surrogate code point must not become part of a string that
 *  is later JSON-encoded into a client response — an unpaired surrogate is how a
 *  title turns into `""` at the serializer and looks like a broken row. */
function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  if (code >= 0xd800 && code <= 0xdfff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Collapse the whitespace a page puts inside a `content` attribute, and the
 *  line-wrapping indentation of a hand-written head. */
function tidy(value, limit) {
  const cleaned = decodeEntities(String(value || ""))
    // Control characters are stripped because a `content` attribute can carry a
    // raw NUL or a stray form feed from a copy-pasted spec sheet, and both are
    // invisible in a card while being entirely visible to a log line or a CSV
    // export downstream. The lint rule assumes a control match is a parser bug;
    // here the control characters ARE the input being defended against.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

/**
 * Every `<meta>` and `<title>`/`<link rel=icon>` fact in a document.
 *
 * Returns the raw field map, with `content` values still un-truncated and URLs
 * unresolved, so `parseHead` (rendering) and a caller that wants `og:type` can
 * both read it without a second scan.
 */
function scanHead(html) {
  let text = String(html || "");
  // Only the head. A body that repeats the meta tags (a page scraped into its own
  // markup, a CMS preview inside a wrapper) must not outvote the declaration.
  const headEnd = text.toLowerCase().indexOf("</head>");
  if (headEnd !== -1) text = text.slice(0, headEnd);
  text = text
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    // `[^>]*` on the CLOSING tag is load-bearing, and it is what CodeQL is
    // insisting on here: `</script >`, `</script\n>` and even `</script foo>` are
    // all valid ways to END a script element for a real HTML parser, so a scrub
    // that matches only `</script>` leaves the element's contents in the text we
    // then read declarations from — which is exactly the smuggling this pass
    // exists to close. Same for style. `[^>]*` rather than `\s*` because the
    // tolerance is the browser's, not ours to narrow.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style[^>]*>/gi, " ");

  const fields = new Map();
  const META = /<meta\b([^>]*)>/gi;
  for (const match of text.matchAll(META)) {
    const attrs = match[1];
    const key =
      /\bproperty\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs) ||
      /\bname\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
    if (!key) continue;
    const name = (key[2] || key[3] || key[4] || "").trim().toLowerCase();
    if (!name) continue;
    const contentMatch =
      /\bcontent\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
    // An empty `content` is stored as null rather than skipped, so a page that
    // repeats a property (a CMS writing `og:image` twice, the first one still
    // templated) loses the empty declaration to the real one instead of to
    // whichever came first. An empty `og:image` does NOT suppress the `twitter:`
    // fallback below: "I declared this one empty" is not the same statement as
    // "no image for this page", and the fallback is what Slack and WhatsApp do.
    const content = contentMatch
      ? (contentMatch[2] ?? contentMatch[3] ?? contentMatch[4] ?? "").trim()
      : null;
    if (!fields.has(name) || fields.get(name) === null) {
      fields.set(name, content && content.length ? content : null);
    }
  }

  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  const links = [];
  for (const match of text.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1];
    const rel = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
    const relValue = ((rel && (rel[2] || rel[3] || rel[4])) || "").toLowerCase();
    const hrefValue = (href && (href[2] || href[3] || href[4])) || "";
    if (hrefValue && /(?:^|\s)(?:icon|shortcut|apple-touch-icon)(?:\s|$)/.test(relValue)) {
      links.push({ rel: relValue, href: hrefValue });
    }
  }

  return { fields, title: title ? title[1] : null, icons: links };
}

/** Absolute http(s) URL or null. A `data:` favicon is accepted ONLY when it is a
 *  small image — a favicon is the one head URL worth reading from a data URI, and
 *  an unbounded one is a 2 MB string in a JSON response. */
function resolveUrl(value, baseUrl, { allowDataImage = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (allowDataImage && /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(raw)) {
    return raw.length <= 64 * 1024 ? raw : null;
  }
  try {
    const url = new URL(decodeEntities(raw), baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * The five facts a card renders, plus the image's own declared size.
 *
 * `baseUrl` is the FINAL url after redirects — a relative `og:image` belongs to
 * the page that answered, not to the short link the sender pasted.
 */
function parseHead(html, baseUrl) {
  const { fields, title, icons } = scanHead(html);
  const get = (key) => fields.get(key) || null;

  const pageTitle = tidy(title, LIMITS.title);
  const card = {
    title:
      tidy(get("og:title"), LIMITS.title) ||
      tidy(get("twitter:title"), LIMITS.title) ||
      pageTitle,
    description:
      tidy(get("og:description"), LIMITS.description) ||
      tidy(get("description"), LIMITS.description) ||
      tidy(get("twitter:description"), LIMITS.description) ||
      // `og:site_name` on its own, with no title, is a page that told us who it
      // is and nothing else. Better than the URL, and honest about being thin.
      (pageTitle ? null : tidy(get("og:site_name"), LIMITS.siteName)),
    siteName:
      tidy(get("og:site_name"), LIMITS.siteName) ||
      safeHostname(baseUrl),
    imageUrl:
      resolveUrl(get("og:image"), baseUrl) ||
      resolveUrl(get("og:image:url"), baseUrl) ||
      resolveUrl(get("twitter:image"), baseUrl) ||
      resolveUrl(get("twitter:image:src"), baseUrl),
    imageWidth: positiveInt(get("og:image:width")),
    imageHeight: positiveInt(get("og:image:height")),
    iconUrl:
      resolveUrl(icons[0] && icons[0].href, baseUrl, { allowDataImage: true }) ||
      resolveUrl("/favicon.ico", baseUrl),
    // Kept for the one decision the card makes from it: `og:type: website`
    // versus a page that declared nothing. Not rendered, and not stored.
    ogType: tidy(get("og:type"), 40),
  };
  return card;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function positiveInt(value) {
  const n = Number(String(value || "").trim());
  return Number.isFinite(n) && n > 0 && n <= 10000 ? Math.trunc(n) : null;
}

/**
 * Is this URL one of the four services whose content we will frame?
 *
 * The answer is derived from the URL and NOTHING ELSE — never from `og:video`,
 * `twitter:player` or any other field a page controls, because that is how a page
 * named "Invoice" gets to put an arbitrary frame inside a work chat. An
 * unrecognised host is a link, and a link is enough.
 *
 * `media_id` is the only thing that travels with the kind, and it is constrained
 * to `[A-Za-z0-9_-]{6,64}` so the client can paste it into a template whose host
 * is a literal. A video id is exactly that shape for all four services; anything
 * else is not a video id and is dropped rather than sanitised.
 */
function recogniseMedia(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || ""));
  } catch {
    return { kind: "NONE", id: null };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "NONE", id: null };
  }
  const host = String(url.hostname || "").toLowerCase().replace(/^www\./, "");
  const path = url.pathname;
  const id = (value) =>
    value && /^[A-Za-z0-9_-]{6,64}$/.test(value) ? value : null;

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    const short = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(path);
    const candidate = (short && short[1]) || v;
    // A playlist id is `PL…` and opens a playlist, not a video; framing it is a
    // different promise than the sender made, so only plain video ids count.
    const kind = /^([A-Za-z0-9_-]{11})$/.test(candidate || "") ? "YOUTUBE" : "NONE";
    return { kind, id: kind === "YOUTUBE" ? candidate : null };
  }
  if (host === "youtu.be") {
    const candidate = /^\/([A-Za-z0-9_-]{11})/.exec(path)?.[1];
    return candidate ? { kind: "YOUTUBE", id: candidate } : { kind: "NONE", id: null };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const candidate =
      /^\/(?:video\/)?(\d{6,20})/.exec(path)?.[1] ||
      url.searchParams.get("clip_id") ||
      null;
    const value = id(candidate);
    return value ? { kind: "VIMEO", id: value } : { kind: "NONE", id: null };
  }
  if (host === "loom.com" || host === "www.loom.com") {
    const candidate = /^\/share\/([0-9a-f-]{30,40})/i.exec(path)?.[1];
    const value = candidate ? candidate.replace(/-/g, "").slice(0, 64) : null;
    return value && /^[0-9a-f]{24,40}$/i.test(value)
      ? { kind: "LOOM", id: value }
      : { kind: "NONE", id: null };
  }
  if (host === "google.com" || host === "maps.google.com" || host === "goo.gl.maps") {
    // Only a search/place URL with a query we can hand to the embed endpoint. The
    // query text itself is never composed into a src here — the client builds the
    // frame URL, against a literal host, from `id`, which it URL-encodes.
    const q =
      url.searchParams.get("q") ||
      /^\/maps\/place\/([^/]+)/.exec(path)?.[1] ||
      /^\/maps\/search\/([^/]+)/.exec(path)?.[1] ||
      null;
    if (!q) return { kind: "NONE", id: null };
    const value = id(decodeEntities(q).replace(/\+/g, " ").replace(/[^A-Za-z0-9_-]/g, "-"));
    return value ? { kind: "MAPS", id: value } : { kind: "NONE", id: null };
  }
  return { kind: "NONE", id: null };
}

module.exports = {
  LIMITS,
  scanHead,
  parseHead,
  recogniseMedia,
  decodeEntities,
  resolveUrl,
  tidy,
};
