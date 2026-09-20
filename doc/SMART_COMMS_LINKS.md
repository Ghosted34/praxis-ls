# Smart Comms link previews

A URL in a chat message becomes a card: the page's title, a line of its own
description, its site name and its picture — and the link stays clickable. The
feature exists so that a reader can tell what a link IS before deciding to open
it, which is the only thing that makes an auto-posted notice ("Blockage on
"Hold the meeting" … `/workspace/tasks?task=4f873a78-…`") readable on a phone.

## What the reader sees

| The link | What the bubble shows |
|---|---|
| `https://maersk.com/vessel/1` | card: title, description, site, thumbnail, "Open" |
| `https://youtu.be/dQw4w9WgXcQ` | card + provider name, runtime, "Watch on YouTube" |
| `/workspace/tasks?task=<uuid>` | a labelled chip (**Task**) that navigates inside the app |
| `https://smartls.praxisls.com/operations/files/<id>` | the same chip — it is our own page, and we already know what is on it |
| a URL with nothing cached yet | the plain link, and a card a moment later |
| `www.b.example/quote/9` | plain link (no scheme typed → still clickable, never unfurled as a different URL than the one shown) |

Rules the UI keeps:

- **A card only ever appears for `state = OK`.** `PENDING`, `EMPTY`, `UNREACHABLE`
  and `REFUSED` render nothing but the link. A preview that failed must look like
  a link, not like an error: the reader did nothing wrong and cannot act on our
  fetch problem.
- **The composer previews a link while it is being typed** — the one place that
  waits on the third party, because a person standing at the input with a pasted
  URL is exactly the moment "is this the page I meant" is worth answering. It asks
  once per URL, 700ms after the keystrokes stop, and never for a draft that was
  merely restored (opening a chat is not a question about a link).
- **In a thread, cards appear on the next read, not by push.** There is no realtime
  nudge for a finished preview, deliberately: a card that pops into a settled
  thread while somebody is typing moves the text under their thumb.
- An outside link keeps its **address visible**. A prettified label is how
  `https://maersk.com.example/steal` passes.
- External links open in a new tab with `rel="noopener noreferrer"`, so the
  destination does not learn the reader's session and cannot claim `window.opener`.

## Two write paths, one read path

The metadata model is a **snapshot that refreshes**, not a live fetch:

1. **Send** (`recordSentLinks`, after the message commits): extract the URLs,
   create the rows, enqueue one `comms-link-unfurl` job carrying them. The send
   never waits on a web request — a slow site cannot make sending slow.
2. **Read** (`previewsFor`, inside `thread()`): one indexed query for every URL in
   the page's bodies. A row that is past `COMMS_LINK_TTL_DAYS` is stamped
   `stale_at` and queued. **The read path never fetches.**
3. **Worker**: fetch, parse, store; on failure, back off and keep the last good
   card (`putResult` COALESCEs onto the previous values, so a site that is briefly
   down does not blank a correct card).
4. **Sweep** (`comms-link-unfurl-scheduler`, every `COMMS_LINK_SWEEP_INTERVAL_MS`):
   one drain job per live tenant (and per sandbox, where one exists) for rows that
   were created and never fetched, or marked stale. This is what makes the feature
   self-healing after a Redis flush or a deploy where the producer had no queue.

The consequence worth stating plainly: **old threads work.** Nothing is stored per
message, so every message that has ever been posted gets a card as soon as it is
read — no backfill job, no "only messages sent after the feature" cliff.

## What counts as a link

`packages/shared/rules/link-detect.js` (shared, because the client must linkify the
same characters the server unfurled):

- `scheme://…` and `www.…` become web URLs; bare domains do **not** (`e.g.`,
  `doc.pdf`, `v1.2`, `192.168.1.1` are all text, and a heuristic that guesses the
  difference in a work chat eventually guesses wrong about a payment link).
- Trailing sentence punctuation is peeled, brackets are peeled by count (so
  `https://en.wikipedia.org/wiki/Freight_(rail)` survives); a comma or closing
  quote after a URL is outside it.
- Query strings and ports are kept — `?task=<uuid>` is the link.
- `mailto:` becomes a mail link. `data:`, `javascript:` and `file:` become nothing:
  plain text, exactly as typed.
- At most `MAX_LINKS = 24` per message, and a message that mentions many links
  shows three cards. More is not a preview, it is a wall.

An app path (`/workspace/tasks?task=…`, `/finance/invoices/<id>`, …) is not a web
URL and is never fetched. `entity-route.parseUrl` recognises it, the bubble renders
a chip, and `<Link>` navigates in the SPA. The kinds that get a **live card** are
the five the ERP card service resolves (`erp.resolveMany`) plus a file/dossier;
task and calendar links get a labelled chip and in-app navigation only.

## The response contract

`GET /smartcomm/threads/:channelId` gains two things, both optional:

```
{
  messages: [ { …, link_urls: ["https://a.example/x"] } ],
  links:    { "https://a.example/x": { …card… } }
}
```

`links` is keyed by the **canonical URL** (the same normalisation the cache uses),
so a URL pasted in nine messages is one card. `link_urls` is the message's own
ordered list. A missing `links` object means an older server or the feature
switched off — the client then renders plain links, and nothing looks broken.

A card:

```
{ url, state, title, description, site_name,
  image_src, icon_src, link_hash,
  media: { kind, id, open_url, duration, author } | null,
  fetched_at, stale }
```

`image_src` is **always** our own route (`/smartcomm/links/image?link=<hash>&part=image`)
and never the remote URL: the browser is not told where the picture came from.
`link_hash` is the cache key, handed out so the client can ask for that picture
without being able to ask for anybody else's page.

## States

| State | Meaning | Next fetch | Rendered |
|---|---|---|---|
| `PENDING` | row exists, nothing fetched yet | now | no |
| `OK` | last fetch produced something | after TTL | yes |
| `EMPTY` | the page says nothing about itself | after TTL | no |
| `UNREACHABLE` | DNS, timeout, 4xx/5xx, non-HTML | backoff: `COMMS_LINK_RETRY_MINUTES`, doubling to ~8× | no |
| `REFUSED` | the guard declined it | never (terminal) | no |

`EMPTY` is separate from `UNREACHABLE` because they are different sentences about
the world — "a real page with nothing on it" versus "we could not get there" — and
only the second should be retried soon. `REFUSED` never retries: hammering a host
we have decided not to contact is not a cache policy, and the row that says
`REFUSED` is the audit trail of that decision.

## The fetch guard

`src/shared/net/link-target.js` + `src/shared/net/guarded-fetch.js`. Everything the
server fetches on a message's behalf goes through these, and:

- only `http`/`https` on the ports a browser would use;
- a URL with `user:password@` is refused outright;
- the host is resolved **once**, every returned address is screened, and the
  connection is pinned to that address — so DNS rebinding between the check and
  the connect cannot swap in `127.0.0.1`;
- blocked addresses: loopback, RFC1918, link-local (which includes
  `169.254.169.254`, the cloud metadata service), `fc00::/7`, `fe80::/10`,
  CGNAT `100.64.0.0/10` (Tailscale), IPv4-mapped IPv6 (`::ffff:127.0.0.1`),
  Teredo, and single-label names (`postgres`, `redis`, `localhost`) which are how
  a container network is reached;
- **redirects are re-screened per hop**, one hop at a time, up to a fixed hop
  count, and the fetch does not follow them with a fresh `Location` blindly;
- no cookies, no `Authorization`, no tenant identity is forwarded;
- the body is capped (`COMMS_LINK_FETCH_MAX_BYTES` for HTML, `…_IMAGE_MAX_BYTES`
  for a picture) and the stream is destroyed the moment the cap is crossed — a
  truncated read is an ANSWER, not a failure, because everything a card needs is
  in the first kilobytes of a page by construction;
- `Accept-Encoding: identity`: this module has no decompressor, and a gzip'd head
  parsed with a regex is a preview of nothing on exactly the sites worth
  previewing;
- content type must be HTML (or JSON, for oEmbed) / a raster image.

`og:video`, `og:audio`, `twitter:player` and every other un-requested `og:*` key
are **not read at all**. A page may name any host as its video source; that is not
a reason for this server to fetch it.

Images go through the same guard a second time when the reader asks for them,
because the URL being served was written by the site being previewed, not by us —
and because an `<img>` that only the browser fetches would leak the reader's IP
and cookies to that site, and be blocked as mixed content if it were `http://`.
SVG (and any XML) is refused by the proxy: an SVG from an untrusted host is a
script with a picture on it, and it would be served from our origin.

## Media cards, and why there is no iframe

YouTube, Vimeo, Loom and Google Maps links get a slightly different card: provider
name, runtime and author (from the provider's own oEmbed endpoint, on a hardcoded
host), and one button that opens the provider in a new tab.

They are **not** framed. The Content-Security-Policy in `src/server.js` sets
`frame-src 'self' blob:` and `tests/unit/csp-blob-media.test.js` asserts that as a
security property. Narrowing it for a chat preview would trade a fixed,
audited policy for a per-message one decided by whoever posted the link. If inline
playback is ever wanted, the seam exists and is small: `buildCspDirectives` +
`COMMS_LINK_EMBEDS` + `EMBED_HOSTS` in the links service, plus that test. The
media `id` is CHECK-constrained to `[A-Za-z0-9_-]{6,64}` in the database, so even
then the frame URL is built from a literal host and a value that cannot be
anything else.

## Configuration

| Key | Default | Why an operator touches it |
|---|---|---|
| `COMMS_LINK_PREVIEWS` | `true` | the whole feature's kill switch |
| `COMMS_LINK_FETCH_TIMEOUT_MS` | `6000` | one attempt, one address |
| `COMMS_LINK_FETCH_MAX_BYTES` | `262144` | HTML cap |
| `COMMS_LINK_IMAGE_MAX_BYTES` | `2097152` | picture cap |
| `COMMS_LINK_TTL_DAYS` | `7` | when a card is refreshed in the background |
| `COMMS_LINK_RETRY_MINUTES` | `15` | first retry delay after a failure |
| `COMMS_LINK_EMBEDS` | `true` | the provider card for media links |
| `COMMS_LINK_SWEEP_INTERVAL_MS` | `900000` | `0` disables the backstop sweep |
| `COMMS_LINK_EXTRA_OWN_HOSTS` | — | hosts to treat as ours (never fetched) |

`COMMS_LINK_PREVIEWS` is env rather than a tenant setting on purpose: what it
switches off is an **outbound HTTP request the server makes on behalf of a chat
message**. A data-residency review, an air-gapped deploy, or an incident involving
a host that is being scraped all need an operator-level switch, and links must
still work when it is off — they are simply not previewed.

## Data model

`migrations/tenant/13990_comms_link_previews.sql` → `comms_link_preview`, one row
per **canonical URL** (`url_hash` = sha256, unique), holding the five rendered
fields plus the fetch's own state. Keyed on the URL rather than the message for
four reasons, all of which keep paying rent:

1. a message never has to know it contains a link, so no caller of `postMessage`
   (there are eleven today) can forget to write anything;
2. no backfill;
3. one fetch per URL however many bubbles share it;
4. retention trims cache without touching content — a card is not part of a
   message, and message content in this product is never quietly dropped.

To purge: `DELETE FROM comms_link_preview`. Nothing refers to a row; every thread
then falls back to plain links until the URLs are read again. It is an operator
action rather than a scheduled job deliberately — silently deleting cache nobody
asked about is how a preview feature starts showing stale cards for reasons nobody
can reproduce.

## Testing

- `tests/unit/shared-link-detect.test.js` — the tokenizer: what becomes a link,
  what is peeled, and that the offsets index the sender's characters for every kind
  (a wrong offset silently eats the next link).
- `tests/unit/smartcomm-links.test.js` — the guard's refusals, the `<head>` parser,
  state mapping, the read path never fetching, own-host skipping, the image
  proxy's refusals, and the kill switch. `guardedFetch` is tested against a real
  loopback socket that must **not** be reached.
- `client/src/features/comms/chat/message-links.test.tsx` — what becomes clickable,
  `javascript:` not becoming an `<a>`, the four non-OK states rendering nothing, the
  three-card cap, and a picture loaded only through the proxy.
- `client/src/features/comms/team-chat.test.tsx` — the reveal and preview plumbing
  the page owns.

The migration has never been run against a database in this branch's CI job; its
header carries the VERIFY and DOWN blocks for whoever applies it.
