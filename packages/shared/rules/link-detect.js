"use strict";

/**
 * What in a message body is a link, and where does it go?
 *
 * ── WHY THIS IS IN packages/shared AND NOT IN EITHER SIDE ──────────────────
 *
 * Two copies of a link detector is two copies that disagree, and the disagreement
 * is always visible in the same place: the server decides which URLs to spend a
 * fetch on and what to store, the browser decides what is clickable, and a
 * message whose link the client cannot see is a message where nothing is
 * clickable at all. The route half has been down this road already — see
 * `rules/entity-route.js`, whose header is a post-mortem about exactly that.
 *
 * ── WHAT COUNTS AS A LINK, AND WHAT DELIBERATELY DOES NOT ──────────────────
 *
 * A scheme (`https://…`), a `www.` host, an email address, or a path into this
 * app (`/workspace/tasks?task=…`, which is what the task-blockage notice writes).
 *
 * A bare `example.com` is NOT detected, even though it usually means a website.
 * The reason is what else it matches: `e.g.`, `doc.pdf`, `v1.2`, `192.168.1.1`,
 * `Slas.2026`. Every one of those is ordinary freight-office prose, and a
 * product that underlines half of a sentence as a hyperlink teaches people that
 * the underline is decoration. Requiring `www.` or a scheme is what WhatsApp and
 * Slack settled on for the same reason.
 *
 * Trailing punctuation is peeled off the end of a candidate, because a link at
 * the end of a sentence is normally followed by one. The closing bracket is the
 * interesting case: `see https://en.wikipedia.org/wiki/Freight_(rail)` ends in a
 * `)` that is PART of the URL, so a bracket is peeled only when it has no opener
 * anywhere in the candidate — which is also why `[` and `{` are peeled
 * unconditionally, since a URL never contains an unclosed one.
 *
 * ── THE TEXT NEVER CHANGES ─────────────────────────────────────────────────
 *
 * Everything here is a READ-ONLY annotation of an existing body: offsets into
 * the sender's own characters, plus a resolved destination. The body stored in
 * `comms_message.body` stays exactly what was typed, so search, drafts,
 * notifications and certified exports keep working, and a message written
 * before this file existed renders with live previews rather than being frozen
 * at whatever its sender saw.
 */

const entityRoute = require("./entity-route");

/** One link per five characters of body is already more than a real message
 *  contains; the cap is a bound on pathological input, not a UX decision. */
const MAX_LINKS = 24;

/** Schemes we will make clickable. Anything else (`javascript:`, `data:`,
 *  `file:`) is refused here rather than filtered later, and `data:` in
 *  particular must never reach an `href`: `data:text/html,<script>…` is a
 *  clickable same-origin document. */
const WEB_SCHEMES = ["http:", "https:"];

const SCHEME_URL =
  /https?:\/\/[^\s<>"'`]+/gi;

/** An email address. Deliberately narrower than RFC 5322: the local part is what
 *  people actually type, and the domain half must end in a letter so a trailing
 *  `.` from the sentence cannot be read as part of the address. */
/**
 * The address rules, as CHARACTER SETS rather than as one pattern.
 *
 * A regex like `[A-Za-z0-9._%+-]+@…` is what CodeQL's ReDoS query flags, and its
 * objection is fair even though nothing here explodes exponentially: the engine
 * re-tries the run at every start position, so a body that happens to be ten
 * thousand `%%%-ish` characters is quadratic work — and a chat message is attacker
 * sized input by definition. `findEmails` below walks each `@` instead: one pass,
 * and the acceptance rules are the same ones the pattern had (local part from the
 * character set, at least two dot-separated host labels, a final label of 2–24
 * LETTERS so the `.` that ends the sentence is not part of the address).
 */
const LOCAL_CHARS = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._%+-".split(""));
const HOST_CHARS = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-".split(""));
const isLetter = (ch) => ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z";
const TLD_MIN = 2;
const TLD_MAX = 24;

/** `www.` is only a host when the bit after it looks like one: `www.` on its own
 *  (a truncated paste) is not worth a red squiggle. */
const WWW_URL =
  /(?:^|[\s(])www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+[^\s<>"'`]*/g;

/** A path into this app, as written by `entity-route`'s producers: root-relative,
 *  no host. Matched with a query string allowed, because the two `?task=`-style
 *  routes are the common case. */
const APP_PATH =
  /(?:^|[\s([{])\/[A-Za-z0-9][A-Za-z0-9\-/_]*(?:\?[A-Za-z0-9\-._~%=&+#]*)?/g;

/** Sentence punctuation that is never the last character of a real URL. Brackets
 *  are NOT in here — they are counted, separately, for the reason in `peelTail`.
 *  A Set and a backward loop rather than `/[…]+$/`, for the ReDoS reason recorded
 *  on `LOCAL_CHARS`: an anchored `+` class is re-tried at every start position. */
const SOFT_TRAILING = new Set([",", ".", ";", ":", "!", "?", '"', "·", "»", "\u201d", "\u2019"]);
const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);

/** Drop trailing characters while `test` approves them, in ONE pass. */
function trimEndWhile(text, test) {
  let end = text.length;
  while (end > 0 && test(text[end - 1])) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}

/**
 * Peel sentence punctuation off the tail of a candidate, in one loop so "…"
 * followed by ")" followed by "." peels all three.
 *
 * Brackets are handled by COUNT, not by the character class. `…/Freight_(rail)`
 * ends in a `)` that belongs to the URL, and `(https://a.example/x)` ends in one
 * that does not — the difference is whether anything opened it. Getting this
 * wrong in the first direction is the classic linkifier bug, and it eats the last
 * characters of the most link-shaped URLs people paste (Wikipedia, Amazon, any
 * URL with a query array).
 */
/**
 * Every address in `body`, left to right, by walking from each `@`.
 * Returns `{ raw, start }` so the caller can keep the offsets it already uses.
 */
function findEmails(body) {
  const out = [];
  let at = body.indexOf("@");
  while (at !== -1) {
    let start = at;
    while (start > 0 && LOCAL_CHARS.has(body[start - 1])) start -= 1;
    const local = at - start;
    let end = at + 1;
    let labels = 0;
    let lastLabel = 0;
    let lastLabelLetters = 0;
    while (end < body.length) {
      const ch = body[end];
      if (ch === ".") {
        // A dot only joins two labels. If nothing followed it — `a@b.`, or the
        // period that ends a sentence — the host ENDED before the dot, which is why
        // `write ops@c.example.` is the address `ops@c.example` and not the nine
        // characters with a full stop on the end. `lastLabel` is deliberately not
        // reset on this path: the label before the dot is the one to test.
        if (lastLabel === 0 || !HOST_CHARS.has(body[end + 1] || "")) break;
        labels += 1;
        lastLabel = 0;
        lastLabelLetters = 0;
        end += 1;
        continue;
      }
      if (!HOST_CHARS.has(ch)) break;
      lastLabel += 1;
      if (isLetter(ch)) lastLabelLetters += 1;
      end += 1;
    }
    const hasFinalLabel = lastLabel > 0;
    if (hasFinalLabel) labels += 1;
    const tldLength = hasFinalLabel ? lastLabel : 0;
    const tldIsLetters = hasFinalLabel && lastLabelLetters === lastLabel;
    if (local > 0 && labels >= 2 && tldLength >= TLD_MIN && tldLength <= TLD_MAX && tldIsLetters) {
      out.push({ raw: body.slice(start, end), start });
    } else {
      // Nothing valid here; the next `@` is the only place an address can start.
      end = at + 1;
    }
    at = body.indexOf("@", end);
  }
  return out;
}

function peelTail(candidate) {
  let text = String(candidate || "");
  for (let guard = 0; guard < 8; guard += 1) {
    const before = text;
    let trimmed = trimEndWhile(text, (ch) => SOFT_TRAILING.has(ch));
    let opens = 0;
    let closes = 0;
    for (const ch of trimmed) {
      if (OPENERS.has(ch)) opens += 1;
      else if (CLOSERS.has(ch)) closes += 1;
    }
    // Only an UNMATCHED closer is sentence punctuation. A URL that has lost its
    // opener inside the candidate (`(https://…/x)` after the leading `(` was
    // consumed as a separator) is exactly this case.
    if (closes > opens) trimmed = trimEndWhile(trimmed, (ch) => CLOSERS.has(ch));
    // An opener with no closer is not a URL character either — `[` and `{` never
    // appear unbalanced in a legal URL, so a trailing one is a mis-paste.
    if (trimmed && OPENERS.has(trimmed[trimmed.length - 1])) trimmed = trimmed.slice(0, -1);
    if (trimmed === before) break;
    text = trimmed;
  }
  return text;
}

/**
 * The canonical form of a URL for CACHING and DEDUPLICATION.
 *
 * Not a normalisation for display — the bubble always shows what the sender
 * wrote. Two messages pasting `HTTP://Example.COM/a` and `https://example.com/a/`
 * should cost one fetch and one row, and they should not be unfurled twice against
 * a rate-limited site. The choices, and their limits:
 *
 *   · the fragment is dropped — nothing server-side can see inside `#`
 *   · a trailing slash on a bare path ("/" and "") is not treated as a
 *     different page; on `/docs/` versus `/docs` it IS, because some servers
 *     answer those differently and guessing would merge two real pages
 *   · the query is kept verbatim, in order. Sorting it would merge URLs that
 *     differ by repeated keys (`?tag=a&tag=b`), and the tracking parameters worth
 *     dropping (`utm_*`) are exactly the ones a site uses to count clicks we are
 *     about to make anyway — removing them changes what the publisher sees, so
 *     they stay, and the note lives in the fetcher's header instead.
 */
function normaliseUrl(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  if (!WEB_SCHEMES.includes(url.protocol)) return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  if (url.protocol === "https:" && url.port === "443") url.port = "";
  if (url.protocol === "http:" && url.port === "80") url.port = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return url.toString();
}

/** The label a chip carries for an in-app record. Keys are `entity-route` types;
 *  the client puts these through `tr()`, so they are English surface copy, not
 *  internal identifiers. A type missing here is not an error: the caller falls
 *  back to showing the path, which is what the product did before any of this. */
const APP_LABEL = {
  lead: "Lead",
  quote_request: "Quote request",
  dossier: "File",
  transit_order: "Transit order",
  delivery_note: "Delivery note",
  costing: "Costing",
  cash_request: "Cash request",
  corporate_entity: "Company",
  treasury_account: "Treasury account",
  insight_article: "Article",
  email_thread: "Mail thread",
  support_ticket: "Support ticket",
  task: "Task",
  calendar_event: "Calendar event",
};

/**
 * Every link in a message body, in the order they appear.
 *
 * Returns `{ start, end, raw, kind, href, entity }` per hit:
 *   kind "web"   `href` is the absolute URL to open in a new tab
 *   kind "app"   `href` is the path to navigate to IN the SPA, and `entity` is
 *                `{ type, id }` when the path names one record — which is what
 *                lets a bubble show "Task" instead of a UUID and lets the server
 *                resolve a live card without fetching anything
 *   kind "mail"  `href` is the `mailto:` for the address
 *
 * `start`/`end` index the INPUT string, so a renderer slices text out of the body
 * without re-finding anything.
 */
function extractLinks(text) {
  const body = String(text == null ? "" : text);
  if (!body) return [];
  const found = [];

  const push = (raw, start, kind, extra = {}) => {
    if (!raw) return;
    const href = extra.href || raw;
    found.push({ start, end: start + raw.length, raw, kind, href, ...extra });
  };

  for (const match of body.matchAll(SCHEME_URL)) {
    // The regex starts AT the scheme (no leading separator group, unlike the
    // `www.` and app-path patterns below), so the offset is the match's own
    // index. Getting this wrong does not throw: it makes `end` land past the next
    // link, and the overlap filter then silently drops every URL after the first
    // — which is exactly the kind of bug an offsets test catches and a
    // "does it render a link" test does not.
    const at = match.index + match[0].indexOf("http");
    const candidate = peelTail(match[0].slice(match[0].indexOf("http")));
    if (!candidate) continue;
    const norm = normaliseUrl(candidate);
    if (!norm) continue;
    push(candidate, at, "web", { href: norm });
  }

  for (const match of body.matchAll(WWW_URL)) {
    const whole = match[0];
    const offset = whole.indexOf("www.");
    const candidate = peelTail(whole.slice(offset));
    if (candidate.length < 6) continue; // `www.` + at least `x.y`
    const norm = normaliseUrl(`https://${candidate}`);
    if (!norm) continue;
    push(candidate, match.index + offset, "web", { href: norm });
  }

  for (const at of findEmails(body)) {
    // Skip an address that is inside an already-found URL: `mailto:` on the
    // `user@host` half of `https://user@host/` would be two overlapping links in
    // one word, and the host part is not anybody's mailbox.
    if (found.some((f) => at.start >= f.start && at.start < f.end)) continue;
    push(at.raw, at.start, "mail", { href: `mailto:${at.raw}` });
  }

  for (const match of body.matchAll(APP_PATH)) {
    const whole = match[0];
    const offset = whole.indexOf("/");
    const candidate = peelTail(whole.slice(offset));
    // Only a path this app's route table actually recognises becomes a link.
    // That is a stricter test than "starts with a word that is an area", and it
    // is the one worth paying for: an unrecognised path still renders as text,
    // rather than as a click that lands on the dashboard.
    const parsed = entityRoute.parseUrl(candidate);
    if (!parsed) continue;
    if (found.some((f) => match.index + offset >= f.start && match.index + offset < f.end)) continue;
    push(candidate, match.index + offset, "app", {
      href: candidate,
      entity: parsed,
      label: APP_LABEL[parsed.type] || null,
    });
  }

  return found
    .sort((a, b) => a.start - b.start)
    // Overlaps cannot happen by construction (each pattern is disjoint), but a
    // second pass over the same characters is the kind of bug a linkifier is
    // remembered for, so the renderer is protected from it regardless.
    .filter((link, index, all) => index === 0 || link.start >= all[index - 1].end)
    .slice(0, MAX_LINKS);
}

/** The distinct web URLs in a body, canonicalised, in first-seen order. This is
 *  what the unfurl queue is fed — one fetch per URL, not per mention. */
function webUrls(text) {
  const out = [];
  const seen = new Set();
  for (const link of extractLinks(text)) {
    if (link.kind !== "web") continue;
    if (seen.has(link.href)) continue;
    seen.add(link.href);
    out.push(link.href);
  }
  return out;
}

/**
 * Does this absolute URL point at OUR OWN app, and if so at what path?
 *
 * `selfHosts` comes from the caller, because only the caller knows what it is
 * being looked at through: the browser has `location.hostname`, the API has the
 * request's `Host` plus `APP_BASE_DOMAIN` and every tenant custom domain. A link
 * to `https://smartls.praxisls.com/operations/files/<id>` is the same page as
 * `/operations/files/<id>`, and opening it in a new tab instead of in the SPA
 * costs a full reload, a fresh auth round trip, and — on a tenant's own domain,
 * where the ERP is not even served — a sign-in wall where the reader expected
 * their file.
 *
 * Returns the path (with its query) for a host the caller claims, and null for
 * anyone else's. Matching is on the host, not on a string prefix of the URL: a
 * page whose href reads `https://praxisls.com.evil.test/x` is somebody else's
 * page, and treating it as ours would send the reader off-site while telling them
 * they were staying in the app.
 */
function toAppPath(href, selfHosts) {
  const hosts = (selfHosts || []).map((h) => String(h).toLowerCase()).filter(Boolean);
  if (!hosts.length) return null;
  let url;
  try {
    url = new URL(String(href).trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = String(url.hostname || "").toLowerCase().replace(/\.$/, "");
  if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  const path = `${url.pathname}${url.search}`;
  return path === "" ? "/" : path;
}

/**
 * The record a bare in-app path names, without re-scanning it for links.
 *
 * A separate entry point because a caller that ALREADY has a path (the server,
 * converting `https://tenant.example/operations/files/<id>` into the record it
 * points at) must not run the whole extractor over it just to ask the route
 * table a question the table can answer directly.
 */
function entityOfPath(path) {
  const parsed = entityRoute.parseUrl(path);
  return parsed ? { ...parsed, label: APP_LABEL[parsed.type] || null } : null;
}

/** The records an in-app link points at, for live card resolution. */
function entityRefs(text) {
  const out = [];
  const seen = new Set();
  for (const link of extractLinks(text)) {
    if (link.kind !== "app" || !link.entity) continue;
    const ref = `${link.entity.type}:${link.entity.id}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out;
}

module.exports = {
  MAX_LINKS,
  APP_LABEL,
  toAppPath,
  entityOfPath,
  extractLinks,
  normaliseUrl,
  webUrls,
  entityRefs,
  peelTail,
};
