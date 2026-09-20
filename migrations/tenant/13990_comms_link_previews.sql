-- ============================================================================
-- TENANT — 13990 Smart Comms link previews: one cached unfurl per URL, keyed on
-- the URL rather than on the message that mentioned it.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
--   comms_link_preview   the card a link renders as: title, description, site,
--                        image, and any playable media handle — plus the state of
--                        the fetch that produced it.
--
-- A bubble with a URL in it used to render the URL. That is honest and
-- unhelpful: the reader cannot tell `https://maersk.com/v/vessel/2` from
-- `https://phishing.example/v/vessel/2` without opening one of them, and the
-- automated blockage notice posted into a DM ends with a 46-character path
-- nobody can read aloud. This table is what lets the bubble say what the page
-- IS before anybody clicks it.
--
-- ── WHY KEYED ON THE URL AND NOT ON THE MESSAGE ────────────────────────────
--
-- The tempting design is a `comms_message_link` child row: one preview per
-- message, written at send. It is rejected for four reasons, and the first two
-- are the ones that decide it:
--
--   · MESSAGES ARE NOT THE ONLY WRITER. `postMessage` has eleven callers today,
--     and a link arrives in a scheduled message that is only expanded at
--     delivery, in a mail mention fan-out, in a reconciliation notice, in an
--     import. Any design that requires each of them to remember to write link
--     rows is a design where the bubble is empty for the callers nobody
--     thought of — which is the orphaned-worker pattern
--     `tests/security/orphan-wiring-sweep.test.js` exists to catch. Keying on
--     the URL means the RENDER path is the only reader and the SEND path only
--     has to say "these URLs are new"; a message is never required to know it
--     contains a link, so a message cannot forget to.
--   · NO BACKFILL. Old threads get live previews the moment this ships, because
--     resolution walks the body text at read time. A per-message row would need
--     a migration that re-reads every `comms_message.body`, or a feature that
--     works only on messages posted after it — and a preview that appears only
--     for new messages reads as a bug in the old ones.
--   · ONE FETCH PER URL, not per message. A client's tracking link pasted nine
--     times in one channel is nine rows and nine page loads against a third
--     party that may rate-limit the tenant. The same URL is one row, unfurled
--     once, and the ninth bubble reuses it — the same argument `thread()` makes
--     for ERP references ("the same invoice quoted three times is one lookup").
--   · RETENTION TRIMS WITHOUT DELETING ANYTHING. A row whose last read was
--     years ago is cache; the message it belongs to still holds the URL. The
--     message-keyed design would have made the card part of the message, which
--     is content — and content in this product is never quietly dropped, for
--     the same reason a soft-deleted message still occupies its place.
--
-- ── WHY THE SNAPSHOT IS KEPT EVEN WHEN A LATER FETCH FAILS ─────────────────
--
-- `last_ok_*` never clears on a failed refresh: a site that is briefly down, or
-- has since blocked crawlers, must not turn a card that was right yesterday into
-- a bare URL today. The refresh stamps `stale_at` instead, which is the
-- difference between "this is what the page said" and "this is what the page
-- says". A preview is a statement about the whole web, which nobody controls, so
-- it is allowed to age — but it is not allowed to lie about being current, which
-- is what the row's own `fetched_at` is for.
--
-- ── WHY NO RAW HTML AND NO ARBITRARY METADATA ──────────────────────────────
--
-- The five columns here are the five a card can render as TEXT or as one
-- `<img>`. `og:video`, `og:audio`, `twitter:player`, every `og:*` key we do not
-- use and the page's HTML are all NOT stored, because a column that can hold an
-- arbitrary string from an untrusted page is a column somebody will eventually
-- put in a `dangerouslySetInnerHTML`. The two `media_*` columns are the single
-- exception, and they are a CHECK-constrained set of four kinds plus an id
-- matching `[A-Za-z0-9_-]{6,64}` — a value that cannot be anything else cannot be
-- smuggled. The iframe those two produce points at a host in a hardcoded
-- allowlist, never at a host read from this table.
--
-- ── WHY NO ACCESS CONTROL ON THE ROW ITSELF ────────────────────────────────
--
-- A preview is public information about a public page, not tenant data: it is
-- what any visitor with the URL would see in a WhatsApp card. So no channel
-- membership gates it, and a second channel in the same tenant pasting the same
-- link reuses the row. What IS gated is the only path that reads it — every
-- thread read asserts membership first (`assertMember` in smartcomm.service.js)
-- — and the image proxy, which requires a valid session for the same reason
-- every other file delivery in this module does: not to protect the picture, but
-- so an attacker cannot use the tenant's server as a free anonymous fetcher of
-- whatever URL they care to hand it.
--
-- ── WHY THERE IS NO SWEEP HERE ─────────────────────────────────────────────
--
-- Rows are small and bounded by the number of DISTINCT URLs the tenant has ever
-- pasted, so growth is not the problem a sweep solves. The real risk is
-- retention: a tenant that clears a channel expects nothing left, and this table
-- is not per-channel. Deleting it with the channel is WRONG (another channel may
-- share the URL); an operator purge is `DELETE FROM comms_link_preview`, which is
-- safe by construction — no message, and nothing outside this table, refers to a
-- row. It is deliberately left as an operation rather than a job: silently
-- deleting cache nobody asked to delete is how a preview feature starts showing
-- stale cards for reasons nobody can reproduce.
--
-- Idempotent throughout: guarded DDL and ON CONFLICT DO NOTHING, so live and
-- sandbox tenant upgrades can safely re-run it.
-- ============================================================================

-- ── 1. THE CACHE ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS comms_link_preview (
  link_preview_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The canonical form `linkDetect.normaliseUrl` produces: https scheme
  -- explicit, host lowercased, fragment dropped, default port dropped. Storing
  -- the sender's raw text instead would key the cache on the typo, and
  -- `HTTP://Example.COM` and `http://example.com` are the same page as far as a
  -- card is concerned. Bounded because a btree index on an unbounded text column
  -- fails at ~2.7kB, and a URL past that is not a URL anybody can click.
  url               text        NOT NULL,
  url_hash          text        NOT NULL,   -- sha256 hex of url, the unique key

  -- PENDING   nothing has been fetched (row created at send time so a card can
  --           say "generating preview" instead of showing nothing).
  -- OK        the last fetch produced something.
  -- EMPTY     the page exists and says nothing worth a card (no title, no
  --           description, no image). Distinct from UNREACHABLE because the
  --           bubble's job is to be honest: an empty page is still a link to a
  --           real page, and a dead one is a warning.
  -- UNREACHABLE  DNS failed, timed out, 4xx/5xx, or non-HTML. Retried, with a
  --           growing gap, per `attempts`.
  -- REFUSED   the fetch guard said no (private address, blocked port, too many
  --           redirects). TERMINAL for a good reason: retrying a URL the guard
  --           refuses is a way to hammer a host we have decided not to touch.
  state           text        NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','OK','EMPTY','UNREACHABLE','REFUSED')),

  -- What the LAST SUCCESSFUL fetch saw. Never cleared by a failure — see the
  -- header. Lengths are the card's own limit, not the source page's: a 900-word
  -- og:description is not a better card than a 300-word one, and storing the
  -- whole thing would put the difference in a column every render truncates.
  title           text CHECK (title IS NULL OR length(title) <= 300),
  description     text CHECK (description IS NULL OR length(description) <= 600),
  site_name       text CHECK (site_name IS NULL OR length(site_name) <= 120),

  -- The ORIGINAL remote URL. Nothing in this table is ever put straight into an
  -- `<img src>`: the bubble asks the tenant's own image proxy for it, which
  -- re-runs the fetch guard, caps the bytes, refuses non-images, and stops the
  -- reader's IP address and cookies from being handed to the site they merely
  -- read a link to. That indirection is also why an `http://` image can stay in
  -- a row at all without a mixed-content warning.
  image_url       text CHECK (image_url IS NULL OR length(image_url) <= 2048),
  image_width     integer,
  image_height    integer,
  icon_url        text CHECK (icon_url IS NULL OR length(icon_url) <= 2048),

  -- The playable form, when the URL is one of the four services the client can
  -- frame. `media_kind` is a closed set for the reason above: an iframe whose
  -- src is built from a stored value is an open redirect into a frame, so the
  -- value must not be able to be anything else.
  --
  -- NO `og:video` AND NO GENERIC `<video>` TAG — deliberately. A page may name
  -- any MP4 as its `og:video`; framing or autoplaying it turns a link preview
  -- into an unsolicited media player in a work chat, and the bytes come from a
  -- host nobody chose to trust. `media_kind` is only ever set by our own
  -- recogniser for four known hosts, from the URL alone.
  media_kind      text NOT NULL DEFAULT 'NONE'
    CHECK (media_kind IN ('NONE','YOUTUBE','VIMEO','LOOM','MAPS')),
  media_id        text CHECK (media_id IS NULL OR media_id ~ '^[A-Za-z0-9_-]{6,64}$'),
  -- What the provider's own oEmbed endpoint said about the media: how long it is,
  -- and whose it is. Only ever filled for the four recognised kinds, from a FIXED
  -- provider host, and bounded so a hostile `author_name` cannot become a wide
  -- string in a bubble. A duration is the one field that changes whether a person
  -- taps — "0:41" they will watch at their desk, "38:12" they will save for later.
  duration_seconds integer CHECK (duration_seconds IS NULL OR (duration_seconds > 0 AND duration_seconds < 604800)),
  author_name     text CHECK (author_name IS NULL OR length(author_name) <= 120),

  -- Hygiene for the queue and for the reader's copy.
  --   fetched_at      when the last fetch finished, success or not
  --   last_ok_at      when the columns above last described the page; NULL = never
  --   stale_at        set by a read that found the row past its TTL, cleared by the
  --                   refresh that followed. The bubble renders the card either way;
  --                   this is the flag that says "ask again", not a rendering state
  --   next_attempt_at not before when another fetch may be tried (retry backoff,
  --                   and the thing that stops a dead host being fetched on every
  --                   page view of a popular thread)
  --   attempts        consecutive failures, reset by a success
  fetched_at      timestamptz,
  last_ok_at      timestamptz,
  stale_at        timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts        smallint    NOT NULL DEFAULT 0,
  last_error      text        CHECK (last_error IS NULL OR length(last_error) <= 400),

  -- The first message that made us care about this URL, and the last time a read
  -- asked for it. `first_seen_at` is provenance for operators ("why is this in my
  -- cache?") and nothing else; no product decision reads it.
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per URL. `url_hash` rather than `url` because the unique index has to
-- fit in a btree page for the ON CONFLICT the writer uses, and hashing makes the
-- index size independent of how long a tenant's links are. Lookups hash the
-- candidate first, so the read path never needs a `WHERE url = $1` at all.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comms_link_preview_url
  ON comms_link_preview (url_hash);

-- The queue's own question: "which URLs are due to be fetched?" — PENDING rows
-- waiting for their first attempt and UNREACHABLE ones whose backoff has
-- elapsed. Partial, because the overwhelming majority of rows are OK and will
-- never be re-fetched on this index's schedule.
CREATE INDEX IF NOT EXISTS ix_comms_link_preview_due
  ON comms_link_preview (next_attempt_at)
  WHERE state IN ('PENDING','UNREACHABLE');

-- The stale-while-revalidate poke: reads mark rows and a worker drains the marks.
CREATE INDEX IF NOT EXISTS ix_comms_link_preview_stale
  ON comms_link_preview (stale_at)
  WHERE stale_at IS NOT NULL;

COMMENT ON TABLE comms_link_preview IS
  'Cached Open Graph unfurl per URL, for Smart Comms link cards. Keyed on the canonical URL, not on a message: resolution walks the message body at read time. The five visible fields are from the last SUCCESSFUL fetch and survive later failures; state/stale_at/next_attempt_at drive refresh and retry backoff. image_url/icon_url are fetched only through the tenant''s own proxy, never by the browser.';
COMMENT ON COLUMN comms_link_preview.state IS
  'PENDING (never fetched), OK, EMPTY (fetched, nothing worth a card), UNREACHABLE (DNS/timeout/non-HTML; retried with backoff), REFUSED (blocked by the fetch guard; terminal).';
COMMENT ON COLUMN comms_link_preview.duration_seconds IS
  'Provider-declared length in whole seconds (oEmbed). Never inferred, never from og: tags, and bounded by CHECK to under a week so a hostile value cannot be a number anybody divides by.';
COMMENT ON COLUMN comms_link_preview.media_kind IS
  'Playable form recognised from the URL by our own allowlisted recogniser (YouTube/Vimeo/Loom/Maps) — never from page metadata, which an arbitrary host controls.';
COMMENT ON COLUMN comms_link_preview.stale_at IS
  'Set when a read found the row past its TTL, cleared when the refresh lands. A non-null value does not mean the card is wrong; it means it may be, and that another fetch is queued.';

-- ============================================================================
-- VERIFY
--   SELECT to_regclass('comms_link_preview');                  -- not null
--   -- one row per canonical URL
--   INSERT INTO comms_link_preview (url_hash, url) VALUES ('h1','https://a.example/x');
--   INSERT INTO comms_link_preview (url_hash, url) VALUES ('h1','https://a.example/x')
--     ON CONFLICT (url_hash) DO NOTHING;                        -- still 1 row
--   -- an arbitrary media host cannot be smuggled in
--   INSERT INTO comms_link_preview (url_hash, url, media_kind) VALUES ('h2','x','EVIL');
--     -- expects 23514 on comms_link_preview.media_kind CHECK
--   INSERT INTO comms_link_preview (url_hash, url, media_kind, media_id)
--     VALUES ('h3','x','YOUTUBE','"><script>alert(1)</script>');
--     -- expects 23514 on comms_link_preview.media_id CHECK
--   -- a failed refresh keeps the last good card
--   UPDATE comms_link_preview SET title='Kept', last_ok_at=now(), state='OK' WHERE url_hash='h1';
--   UPDATE comms_link_preview SET state='UNREACHABLE', attempts=1, fetched_at=now() WHERE url_hash='h1';
--   SELECT title FROM comms_link_preview WHERE url_hash='h1';        -- 'Kept'
--
-- DOWN
--   DROP TABLE IF EXISTS comms_link_preview;
--   -- Every link in every thread stops being a card and goes back to being the
--   -- text the sender wrote. No message loses anything: the URL lives in
--   -- comms_message.body, which this table only ever reads.
-- ============================================================================
