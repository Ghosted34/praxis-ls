"use strict";

/**
 * Smart Comms link previews — the card a URL earns.
 *
 * A message body is plain text, and it stays plain text. Nothing here writes to
 * `comms_message.body`, and no HTML from a remote page is ever stored or sent to a
 * browser: the card is five length-capped STRINGS plus one image reference, and
 * the bubble renders them as text nodes. That is what lets this exist on a
 * product whose message bodies are searchable, exportable and read by eleven
 * different clients (chat, notifications, mail mirrors, certified PDFs) — none of
 * which has to learn anything new.
 *
 * ── THE TWO HALVES, AND WHY THEY ARE SEPARATE ───────────────────────────────
 *
 *   READ  (`previewsFor`, called by `thread()`)  — look up the cache for the URLs
 *         in this page of messages, and return what is there. Never fetches.
 *   WRITE (`unfurl`, called by the worker)       — fetch, parse, store.
 *
 * A read that fetched would make opening a thread as slow as the slowest link in
 * it, and would let one reader's page view become ten outbound requests. So the
 * read marks rows stale and queues work it will not wait for; the next page view
 * gets the fresher card. That is the "hybrid" the design was asked for: the
 * snapshot is taken when a link first appears, the refresh happens in the
 * background, and the reader always sees something immediately or sees nothing at
 * all — never a spinner.
 *
 * ── WHAT IS NEVER FETCHED, AND WHY THAT IS THE INTERESTING RULE ─────────────
 *
 * A link to THIS app. `/workspace/tasks?task=…` and
 * `https://smartls.praxisls.com/operations/files/…` are the two shapes the
 * product itself writes into messages, and sending either to an HTTP client would
 * mean the server authenticating to itself over its public interface to learn
 * something it could read from its own database in one indexed query. So a URL on
 * a host the request's own `Host` header, `APP_BASE_DOMAIN` or
 * `COMMS_LINK_EXTRA_OWN_HOSTS` claims is routed through `entity-route` and
 * resolved as an ERP card. The client navigates in-app; nothing is fetched, and
 * there is no path from a chat message to an internal HTTP request on our own
 * host — which is the SSRF a "link unfurler" most often turns out to be.
 *
 * ── IMAGES ──────────────────────────────────────────────────────────────────
 *
 * `image_url` in the API response is never the remote host: it is our own proxy
 * route, keyed on the LINK's hash. Three separate reasons, all real:
 *
 *   · the reader's browser does not contact the site they only read a link to, so
 *     their IP address, cookies and user agent are not handed over — a preview is
 *     not consent to be tracked
 *   · the CSP can stay `img-src 'self' data: blob: https:` because the image
 *     arrives as a blob from an authenticated fetch, like every gated file in
 *     this module (a plain `<img src>` cannot carry a Bearer token)
 *   · the proxy can only serve an image that OUR OWN unfurl already recorded for a
 *     URL in this tenant's cache — so the endpoint is not a general-purpose fetch
 *     of whatever URL a caller supplies, which is the other way an unfurler
 *     becomes an SSRF
 */

const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const registry = require("../../services/tenant/registry.service");
const { guardedFetch } = require("../../shared/net/guarded-fetch");
const linkTarget = require("../../shared/net/link-target");
const metaTags = require("../../shared/net/meta-tags");
const { linkDetect } = require("@praxis/shared");
const repo = require("./smartcomm.links.repo");
const { enqueue } = require("../../jobs/queue-producer");

/** The queue this feature's work runs on. One queue, not one per URL: the unit of
 *  backpressure is "how fast can we fetch", and that is a worker property. */
const QUEUE = "comms-link-unfurl";

/** The four providers this module will describe as playable. The host is a
 *  literal in the client, never a value from the database, and the id is
 *  `[A-Za-z0-9_-]{6,64}`-constrained by a CHECK — so no page can point a chat
 *  bubble's frame somewhere else. */
const EMBED_HOSTS = Object.freeze({
  YOUTUBE: "https://www.youtube.com/watch?v=",
  VIMEO: "https://vimeo.com/",
  LOOM: "https://www.loom.com/share/",
  MAPS: "https://www.google.com/maps/search/?api=1&query=",
});

const enabled = () => config.COMMS_LINK_PREVIEWS !== false;

/**
 * The hosts the reader is looking at this app THROUGH, plus the ones the deploy
 * owns. Derived per call rather than cached at boot, because a tenant's custom
 * domain can be added in the platform console without restarting anything, and a
 * link to it is the same page as a link to `<slug>.praxisls.com`.
 */
async function selfHosts(tenantMeta) {
  const hosts = new Set(
    String(config.COMMS_LINK_EXTRA_OWN_HOSTS || "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  if (config.APP_BASE_DOMAIN) hosts.add(String(config.APP_BASE_DOMAIN).toLowerCase());
  if (tenantMeta && tenantMeta.slug) {
    try {
      const origin = await registry.workspaceOrigin(tenantMeta.tenant_id);
      const host = String(origin && origin.host ? origin.host : "").toLowerCase();
      if (host) hosts.add(host);
      const publicBase = await registry.publicSiteBaseUrl(tenantMeta.tenant_id);
      const publicHost = String(publicBase || "").replace(/^https?:\/\//, "").split("/")[0];
      if (publicHost) hosts.add(publicHost.toLowerCase());
    } catch (err) {
      // A tenant with no resolvable origin still gets the base-domain answer,
      // which is the one every deployment has. Logging rather than throwing is
      // the right trade: the failure mode is "a link to our own app gets a
      // generic card", not a broken thread.
      logger.debug({ err }, "link previews: tenant origin unresolved");
    }
  }
  return [...hosts];
}

/**
 * Every link in a message body, resolved to what the client should DO with it.
 *
 * `app` links carry an in-app path; `web` links carry the canonical URL a preview
 * is cached against; `mail` links are `mailto:` and are never fetched.
 */
function linksIn(body, ownHosts) {
  const out = [];
  for (const link of linkDetect.extractLinks(body)) {
    if (link.kind === "web") {
      const asPath = linkDetect.toAppPath(link.href, ownHosts);
      if (asPath) {
        const entity = linkDetect.entityOfPath(asPath);
        out.push({
          kind: "app",
          raw: link.raw,
          path: asPath,
          entity: entity || null,
          label: (entity && entity.label) || null,
        });
        continue;
      }
      out.push({ kind: "web", raw: link.raw, url: link.href });
      continue;
    }
    out.push({
      kind: link.kind,
      raw: link.raw,
      path: link.href,
      url: null,
      entity: link.entity || null,
      label: link.label || null,
    });
  }
  return out;
}

/** The canonical URLs worth a card, from a page of message bodies. */
function collectUrls(messages, ownHosts) {
  const urls = new Set();
  const perMessage = new Map();
  for (const message of messages) {
    const found = linksIn(message.body, ownHosts);
    const web = found.filter((l) => l.kind === "web").map((l) => l.url);
    if (web.length) {
      perMessage.set(message.message_id, web);
      for (const url of web) urls.add(url);
    }
  }
  return { urls: [...urls], perMessage };
}

/**
 * The read path: cards for this page of messages, and the marks that keep them
 * fresh. Never fetches, never throws.
 *
 * Returns `{ byMessage, byUrl }` — ids, not objects, on the message side, so a
 * thread with the same link in nine bubbles ships one card.
 */
async function previewsFor(client, messages, { tenantMeta = null, env = "live" } = {}) {
  const empty = { byMessage: {}, byUrl: {} };
  if (!enabled() || !messages || !messages.length) return empty;
  let own;
  let collected;
  try {
    own = await selfHosts(tenantMeta);
    collected = collectUrls(messages, own);
  } catch (err) {
    logger.warn({ err }, "link previews: collect failed");
    return empty;
  }
  if (!collected.urls.length) return empty;

  let rows = [];
  try {
    rows = await repo.findMany(client, collected.urls);
  } catch (err) {
    // The thread renders without cards. This is the whole reason the preview is a
    // cache read rather than a JOIN in the messages query: a missing table (a
    // tenant that has not run 13990 yet) must degrade, not 500.
    logger.warn({ err }, "link previews: cache read failed");
    return empty;
  }
  const byHash = new Map(rows.map((r) => [r.url_hash, r]));
  const ttlDays = Number(config.COMMS_LINK_TTL_DAYS) || 7;

  const byUrl = {};
  const missing = [];
  const stale = [];
  for (const url of collected.urls) {
    const row = byHash.get(repo.hashUrl(url));
    if (!row) {
      missing.push(url);
      byUrl[url] = { state: "PENDING" };
      continue;
    }
    const pastTtl =
      row.state === "OK" || row.state === "EMPTY"
        ? row.fetched_at && Date.now() - new Date(row.fetched_at).getTime() > ttlDays * 86400000
        : false;
    if (pastTtl || row.state === "PENDING") stale.push(url);
    byUrl[url] = cardOf(row, url);
  }

  const byMessage = {};
  for (const [messageId, urls] of collected.perMessage) {
    byMessage[messageId] = urls;
  }

  // The two writes this path makes, both best-effort, both after the data the
  // reader is waiting for is in hand.
  if (missing.length || stale.length) {
    try {
      if (missing.length) await repo.noteUrls(client, missing);
      if (stale.length) await repo.markStale(client, stale, 15);
    } catch (err) {
      logger.debug({ err }, "link previews: bookkeeping write failed");
    }
    await queueFetch([...new Set([...missing, ...stale])], { tenantMeta, env });
  }

  return { byMessage, byUrl };
}

/**
 * The shape a bubble renders. `image_src` is OUR route, so a client never has to
 * be told the remote URL at all — and a leaked API response cannot hand out a
 * tracking pixel nobody asked for.
 */
function cardOf(row, url) {
  // The link's own cache key, which is ALL the client needs to ask for either
  // picture. Handing it a `link=<hash>` query string to parse back out of
  // `image_src` would work and would couple the client to our routing; one opaque
  // id per card keeps the client free to build the request however it fetches —
  // and a token-carrying blob fetch is how it has to fetch (see the header).
  const linkHash = row.url_hash || repo.hashUrl(url);
  const imageSrc = row.image_url ? `/smartcomm/links/image?link=${linkHash}` : null;
  const iconSrc = row.icon_url ? `/smartcomm/links/image?link=${linkHash}&part=icon` : null;
  const media =
    row.media_kind && row.media_kind !== "NONE" && row.media_id && config.COMMS_LINK_EMBEDS !== false
      ? { kind: row.media_kind, id: row.media_id, open_url: embedUrl(row.media_kind, row.media_id) }
      : null;
  return {
    url,
    state: row.state,
    title: row.title || null,
    description: row.description || null,
    site_name: row.site_name || null,
    link_hash: row.image_url || row.icon_url ? linkHash : null,
    image_src: imageSrc,
    icon_src: iconSrc,
    media: media && { ...media, duration: row.duration_seconds || null, author: row.author_name || null },
    // When the card was last true of the page. The client does not render this by
    // default; it is what a "Preview from 12/03/2026" disclosure would read, and
    // it is in the response so that disclosure is a component and not a change to
    // the API contract.
    fetched_at: row.last_ok_at || row.fetched_at || null,
    stale: !!row.stale_at,
  };
}

function embedUrl(kind, id) {
  const base = EMBED_HOSTS[kind];
  if (!base) return null;
  return `${base}${encodeURIComponent(id)}`;
}

/**
 * The write path. One URL, one fetch, one row.
 *
 * The `state` mapping is the part worth reading, because each value changes what
 * the bubble looks like:
 *
 *   OK           a card with a title and something under it
 *   EMPTY        the page answered and has nothing to say — a bare link, no card
 *   UNREACHABLE  dead or slow — a bare link, plus the retry schedule
 *   REFUSED      the guard said no — a bare link, forever, for the guard's reasons
 *
 * `fetchImpl` exists for the same reason `dns-target.js` injects its resolver: the
 * classification is the part worth asserting, and a test that reaches for a real
 * website is a test that fails on a train. Production never passes it.
 */
async function unfurl(url, { fetchImpl = guardedFetch } = {}) {
  const canonical = linkDetect.normaliseUrl(url);
  if (!canonical) return { url, state: "REFUSED", reason: "not-a-url", error: "not a canonical http(s) URL" };
  const screened = linkTarget.screenUrl(canonical);
  if (!screened.ok) return { url: canonical, state: "REFUSED", reason: screened.reason, error: `screen: ${screened.reason}` };

  const response = await fetchImpl(canonical, {
    maxBytes: Number(config.COMMS_LINK_FETCH_MAX_BYTES) || 262144,
    timeoutMs: Number(config.COMMS_LINK_FETCH_TIMEOUT_MS) || 6000,
    // A head is text; anything else (`application/pdf`, `image/…`, a
    // `application/zip`) is a page we cannot read metadata from, and downloading
    // it would be a fetch of a file for a preview.
    allowContentTypes: ["text/html", "application/xhtml"],
  });
  if (!response.ok) {
    const refused = ["blocked-address", "private-resolver", "port", "protocol", "blocked-host", "credentials"].includes(response.reason);
    return {
      url: canonical,
      state: refused ? "REFUSED" : "UNREACHABLE",
      reason: response.reason,
      error: `fetch: ${response.reason}${response.status ? ` (${response.status})` : ""}`,
    };
  }

  const html = response.body.toString("latin1");
  const head = metaTags.parseHead(html, response.finalUrl);
  const media = metaTags.recogniseMedia(response.finalUrl);
  const card = {
    title: head.title,
    description: head.description,
    siteName: head.siteName,
    imageUrl: head.imageUrl,
    imageWidth: head.imageWidth,
    imageHeight: head.imageHeight,
    iconUrl: head.iconUrl,
    mediaKind: config.COMMS_LINK_EMBEDS === false ? "NONE" : media.kind,
    mediaId: config.COMMS_LINK_EMBEDS === false ? null : media.id,
  };

  // oEmbed, when the URL is one of the four providers we understand. It is worth
  // a second request because it is the only source for DURATION and AUTHOR, and
  // because a YouTube page's own `og:` tags are frequently a login wall while its
  // oEmbed endpoint is a stable public JSON API. Refused or unreachable oEmbed is
  // not a failure of the preview: the card keeps whatever `og:` gave us.
  if (card.mediaKind !== "NONE" && card.mediaId) {
    const enrich = await oEmbed(card.mediaKind, card.mediaId, response.finalUrl, fetchImpl);
    if (enrich) Object.assign(card, enrich);
  }

  // EMPTY rather than OK when the page said nothing. The distinction is only
  // visible as an absent card, and that is exactly the point: "this page has no
  // title, no description and no image" is a TRUE answer about the page, and
  // recording it as OK-with-nulls would make every future read of this URL fetch
  // again to rediscover the same nothing.
  // `iconUrl` is deliberately NOT in this list. When a page declares no icon we
  // synthesize `/favicon.ico` as a guess — counting a guess as evidence would make
  // every page on the internet OK, and EMPTY is the state that stops the next read
  // from queueing a fetch to rediscover the same nothing.
  const says = Boolean(
    card.title || card.description || card.imageUrl || card.duration,
  );
  return { url: canonical, state: says ? "OK" : "EMPTY", ...card };
}

/** The provider's own card data, from a fixed host, over a URL we screened. */
const OEMEBED_ENDPOINTS = {
  YOUTUBE: (id, url) => `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
  VIMEO: (id) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${id}`)}`,
};

async function oEmbed(kind, id, finalUrl, fetchImpl = guardedFetch) {
  const build = OEMEBED_ENDPOINTS[kind];
  if (!build) return null;
  const response = await fetchImpl(build(id, finalUrl), {
    maxBytes: 64 * 1024,
    timeoutMs: Number(config.COMMS_LINK_FETCH_TIMEOUT_MS) || 6000,
    allowContentTypes: ["application/json", "text/javascript"],
  });
  if (!response.ok) return null;
  let payload;
  try {
    payload = JSON.parse(response.body.toString("utf8"));
  } catch {
    return null;
  }
  const title = metaTags.tidy(payload.title, metaTags.LIMITS.title);
  const author = metaTags.tidy(payload.author_name, metaTags.LIMITS.siteName);
  const thumbnail = response.finalUrl && metaTags.resolveUrl(payload.thumbnail_url, response.finalUrl);
  const seconds = Number(payload.duration);
  return {
    ...(title ? { title } : {}),
    ...(author ? { authorName: author } : {}),
    ...(thumbnail ? { imageUrl: thumbnail } : {}),
    ...(Number.isFinite(seconds) && seconds > 0 && seconds < 86400 * 7 ? { duration: Math.round(seconds) } : {}),
  };
}

/**
 * Queue the fetches. Fire-and-forget by design, with one jobId per URL SET so a
 * channel that mentions one link in nine messages — or a reader who opens that
 * thread twelve times — produces one job, not eighty.
 *
 * Without Redis or without a tenant meta (a job needs both to get back to a
 * schema), nothing is queued and nothing is lost: the next read marks the row
 * again, and a deploy with no worker simply keeps showing plain links.
 */
async function queueFetch(urls, { tenantMeta, env } = {}) {
  const list = [...new Set((urls || []).filter(Boolean))];
  if (!list.length || !enabled()) return { queued: 0 };
  if (!tenantMeta) return { queued: 0, skipped: "no tenant context" };
  const jobId = `commslink-${repo.hashUrl(list.slice().sort().join("\n")).slice(0, 20)}`;
  try {
    await enqueue(
      QUEUE,
      "unfurl",
      { tenantMeta, env: env || "live", urls: list.slice(0, 20) },
      // Two attempts, not the producer's default five: this work is a request to
      // a THIRD party that may be down, and the row it failed on already carries a
      // `next_attempt_at` backoff that the next read will use. Queue-level retries
      // on top of row-level backoff is a burst against a site that is not
      // answering, which is how a preview feature gets an IP block.
      { jobId, attempts: 2, backoff: { type: "fixed", delay: 60000 }, removeOnComplete: 200, removeOnFail: 200 },
    );
    return { queued: 1, urls: list.length };
  } catch (err) {
    logger.debug({ err }, "link previews: enqueue failed");
    return { queued: 0, skipped: "queue unavailable" };
  }
}

/**
 * The send path's whole job: remember which URLs this message introduced, and put
 * the fetch on the queue.
 *
 * It writes NOTHING about the message — no link row keyed on `message_id`, no
 * column on `comms_message`. That is deliberate. The message already contains the
 * link, in the sender's own words; a second copy of it in a second table is a
 * second source of truth about what a bubble says, and the two would diverge the
 * first time a message is edited or soft-deleted. What the send path owns is only
 * the TIMING: the row exists and the fetch is queued before anybody reads the
 * thread, which is the difference between "the preview appeared immediately" and
 * "the preview appeared after I scrolled away and back".
 */
async function recordSentLinks(client, { body, tenantMeta = null, env = "live" }) {
  if (!enabled() || !body) return { queued: 0 };
  const own = await selfHosts(tenantMeta);
  const urls = linkDetect
    .webUrls(body)
    // A link to our own app never becomes a fetch target — see the header. It is
    // resolved from the database at render time instead, which is both faster and
    // the only version that respects the reader's permissions.
    .filter((url) => !linkDetect.toAppPath(url, own));
  if (!urls.length) return { queued: 0 };
  const fresh = await repo.noteUrls(client, urls);
  if (!fresh.length) return { queued: 0, skipped: "all already cached" };
  const queued = await queueFetch(fresh, { tenantMeta, env });
  return { queued: queued.queued, urls: fresh.length };
}

/**
 * The worker's unit of work.
 *
 * Sequential by nature — one URL at a time per job — and the delay between fetches
 * of DIFFERENT hosts is the provider's problem, not ours; the attempts cap in
 * `putResult`'s backoff is what stops a dead host from being retried forever.
 */
async function processUrls(client, urls, { fetchImpl } = {}) {
  const out = [];
  for (const url of urls || []) {
    let result;
    try {
      result = await unfurl(url, fetchImpl ? { fetchImpl } : {});
    } catch (err) {
      // `guardedFetch` refuses rather than throwing, so reaching here is an
      // unexpected failure (a parse bug, an OOM-guarded body). UNREACHABLE is the
      // honest state for "we did not get an answer", and it retries.
      result = { url, state: "UNREACHABLE", error: String((err && err.message) || err).slice(0, 400) };
      logger.warn({ err, url }, "link previews: unfurl threw");
    }
    try {
      await repo.putResult(client, url, {
        ...result,
        retryBaseMinutes: Number(config.COMMS_LINK_RETRY_MINUTES) || 15,
        ttlDays: Number(config.COMMS_LINK_TTL_DAYS) || 7,
      });
    } catch (err) {
      logger.warn({ err, url }, "link previews: write failed");
    }
    out.push({ url, state: result.state, reason: result.reason || null });
  }
  return { processed: out.length, results: out };
}

/** Drain what the send path queued and what reads marked stale. */
async function refreshDue(client, limit = 20) {
  const rows = await repo.due(client, limit);
  if (!rows.length) return { processed: 0, results: [] };
  return processUrls(client, rows.map((r) => r.url));
}

/**
 * The image proxy's answer: the bytes of the image this tenant's own cache
 * recorded for this link, or nothing.
 *
 * Note what is NOT here: a URL the caller supplied. The lookup is by the hash of a
 * link, and the image is the one already in the row — so this endpoint cannot be
 * pointed at an internal host, at a neighbour's tracking pixel, or at a 40 MB
 * file. `part=icon` reads the other column of the same row, same guarantee.
 */
async function imageFor(client, linkHash, part = "image", { fetchImpl = guardedFetch } = {}) {
  if (!/^[0-9a-f]{64}$/.test(String(linkHash || ""))) return null;
  const column = part === "icon" ? "icon_url" : "image_url";
  const { rows } = await client.query(
    `SELECT ${column} AS url FROM comms_link_preview WHERE url_hash = $1 AND ${column} IS NOT NULL`,
    [linkHash],
  );
  if (!rows.length) return null;
  const stored = String(rows[0].url || "");
  // A `data:` favicon was screened at write time and is already in our own row:
  // no fetch, no second opinion.
  if (stored.startsWith("data:image/")) {
    const comma = stored.indexOf(",");
    if (comma === -1) return null;
    const meta = stored.slice(5, comma);
    const [mime, enc] = meta.split(";");
    if (enc !== "base64" || !/^image\/(png|jpeg|jpg|gif|webp)$/.test(mime)) return null;
    const buffer = Buffer.from(stored.slice(comma + 1), "base64");
    return buffer.length ? { contentType: mime, buffer } : null;
  }
  const response = await fetchImpl(stored, {
    maxBytes: Number(config.COMMS_LINK_IMAGE_MAX_BYTES) || 2097152,
    timeoutMs: Number(config.COMMS_LINK_FETCH_TIMEOUT_MS) || 6000,
    accept: "image/png,image/jpeg,image/webp,image/gif;q=0.8,*/*;q=0.1",
    allowContentTypes: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"],
  });
  if (!response.ok) return null;
  // The upstream's word is not enough: `allowContentTypes` is what the transport
  // refuses on, and a proxy response is the last place a second opinion belongs.
  // A byte stream served as `image/png` that is actually HTML would be a
  // same-origin document with the reader's token on it.
  const served = String(response.contentType || "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(png|jpeg|jpg|webp|gif|avif)$/.test(served)) return null;
  // SVG and any XML flavour are refused on purpose: an `<svg>` from an untrusted
  // page is a script that runs in the reader's origin, and CSP `img-src` does not
  // save a same-origin `<img>` from it (it does not execute scripts inside an
  // `<img>`, but a data: or same-origin SVG opened directly in a tab is a
  // different story entirely, and a proxy URL is copy-pasteable into a tab).
  if (/svg/.test(response.contentType || "")) return null;
  return { contentType: served, buffer: response.body };
}

/**
 * The synchronous preview the composer asks for while a person is still typing.
 *
 * This is the one place in this feature that fetches on a request path, and it is
 * the one place that may: a HUMAN pressed the keys, the URL is one they typed
 * deliberately rather than one that arrived in somebody else's message, and the
 * cost of waiting is a card appearing half a second later instead of "later". The
 * guard is identical; only the impatience differs.
 */
async function previewNow(url, opts = {}) {
  const result = await unfurl(url, opts);
  if (!result.url) return result;
  return {
    ...result,
    // The client renders this shape, not the row shape, so the composer preview
    // and the finished bubble cannot drift into two designs.
    card: cardOf(
      {
        url_hash: repo.hashUrl(result.url),
        state: result.state,
        title: result.title,
        description: result.description,
        site_name: result.siteName,
        image_url: result.imageUrl,
        icon_url: result.iconUrl,
        media_kind: result.mediaKind,
        media_id: result.mediaId,
        duration_seconds: result.duration || null,
        author_name: result.authorName || null,
        fetched_at: new Date().toISOString(),
        last_ok_at: new Date().toISOString(),
        stale_at: null,
      },
      result.url,
    ),
    open_url: result.url,
  };
}

module.exports = {
  enabled,
  recordSentLinks,
  linksIn,
  previewsFor,
  unfurl,
  processUrls,
  refreshDue,
  queueFetch,
  imageFor,
  previewNow,
  selfHosts,
  cardOf,
  embedUrl,
  EMBED_HOSTS,
  QUEUE,
};
