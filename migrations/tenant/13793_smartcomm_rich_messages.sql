-- ============================================================================
-- TENANT — 13793 Smart Comms grows the four things a chat needs.
--
-- ── WHAT WAS MISSING, AND WHY THE SCHEMA IS ONLY HALF THE ANSWER ───────────
--
-- 0430 already built most of this: `comms_attachment` has existed since then,
-- with a `vault_id` and a `content_type`, and `smartcomm.service.js` has
-- accepted an `attachments[]` array on every posted message since the day it
-- was written. Nothing ever sent one. The composer is a single-line `<Input>`,
-- so the columns sat empty for two years and the thread renderer printed the
-- literal string "(attachment)" for a row that could never exist.
--
-- So this file is not "add attachments". It is the three distinctions 0430 did
-- not draw, each of which turned out to matter more than the storage did.
--
-- ── 1. A PHOTO IN A CHAT IS NOT A DOCUMENT ────────────────────────────────
--
-- `comms_attachment.vault_id` REFERENCES `document_vault`, which means the only
-- place 0430 could put a chat attachment was the vault — the register of things
-- the company must be able to produce on demand, with retention, audit, QES
-- signatures and certified verification hanging off it (MOD-66).
--
-- That is exactly right for a customs declaration somebody drops into an ops
-- channel, and exactly wrong for a photo of a whiteboard. Send every chat image
-- to the vault and within a month the document register is mostly screenshots,
-- and the compliance question "what documents do we hold about this client"
-- stops having a usable answer.
--
-- `comms_media` below is the other half of that split: images, video and voice
-- notes live here, in chat, where they are messages rather than records. Real
-- documents (pdf, xlsx, docx, csv…) keep going to the vault exactly as before,
-- through `document_vault.createDocument`, with the same hashing and the same
-- image-pipeline treatment.
--
-- The split is not a wall. `promoted_vault_id` records the moment somebody
-- decides a chat image WAS a record after all and presses "Save to vault" —
-- and because that promotion goes through the same `createDocument`, the vault
-- row is hashed from the master the pipeline returns, not from the chat bytes.
--
-- ── 2. A VOICE NOTE IS AUDIO *AND* TEXT ───────────────────────────────────
--
-- `certifiedExport` in the service renders every message to one line of a
-- SHA-256'd transcript. A voice note that is only audio renders as "(media)" —
-- so the one message format people reach for when an instruction is urgent is
-- the one format that vanishes from the legal record of the channel, and the
-- one `searchMessages` can never find.
--
-- `transcript` fixes both, and `transcript_status` is a column rather than a
-- nullable string because "not transcribed yet", "there is no provider
-- configured" and "this clip was silence" are three different things to show a
-- user, and collapsing them into NULL means showing the wrong one twice.
--
-- `waveform` holds the peaks the player draws. Computed once on upload rather
-- than in every client that renders the bubble: decoding a clip to draw a bar
-- chart is the kind of work a phone should do zero times, not once per scroll.
--
-- ── 3. AN ERP RECORD IS A REFERENCE, NOT A FILE ───────────────────────────
--
-- "Send me that invoice" has two possible answers and they age differently. The
-- PDF is a snapshot: correct forever about what was true when it was sent, and
-- silently wrong about everything since — a bubble showing UNPAID on an invoice
-- settled last Tuesday. The reference stays true, because it is resolved when
-- it is READ, against the reader's own permissions.
--
-- So `erp_kind` + `erp_id` hold a pointer, never a copy. `erp_label` is the one
-- thing cached, and only as a fallback: a reader who lacks MOD-51 view gets the
-- document number the sender saw, and no amount. Attaching the PDF as well is
-- still available — it is a VAULT attachment, which is what that already is.
--
-- ── IDEMPOTENCY / PARITY ──────────────────────────────────────────────────
--
-- Everything here is IF NOT EXISTS, and the CHECK constraints ride on their own
-- ADD COLUMN rather than a separate ADD CONSTRAINT, so there is no `conname`
-- guard to get wrong across live/sandbox (see 13791 and check-constraint-guards).
-- ============================================================================

-- ── The chat-media store ───────────────────────────────────────────────────
-- Deliberately NOT document_vault. See §1 above.
CREATE TABLE IF NOT EXISTS comms_media (
  media_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          uuid NOT NULL REFERENCES comms_group(group_id) ON DELETE CASCADE,
  uploaded_by       uuid REFERENCES app_user(user_id),
  kind              text NOT NULL CHECK (kind IN ('IMAGE','AUDIO','VIDEO')),
  storage_path      text NOT NULL,
  content_type      text NOT NULL,
  size_bytes        bigint NOT NULL DEFAULT 0,
  original_name     text,
  -- Intrinsic dimensions, so a bubble can reserve the right box BEFORE the
  -- image arrives. Without them every incoming photo reflows the thread and
  -- throws away the reader's scroll position.
  width             integer,
  height            integer,
  duration_ms       integer,
  -- Peaks 0..100, one per render bucket. jsonb rather than integer[] because
  -- this is opaque display data the API hands straight to the client.
  waveform          jsonb,
  is_voice_note     boolean NOT NULL DEFAULT false,
  transcript        text,
  transcript_status text NOT NULL DEFAULT 'NONE'
                      CHECK (transcript_status IN ('NONE','PENDING','DONE','FAILED','UNAVAILABLE')),
  -- Set when somebody promotes this to a real document. See §1.
  promoted_vault_id uuid REFERENCES document_vault(doc_id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- The thread reads media by channel in time order, and the certified export
-- walks the same path.
CREATE INDEX IF NOT EXISTS ix_comms_media_group ON comms_media(group_id, created_at);

-- ── comms_attachment learns what it is pointing at ─────────────────────────
-- DEFAULT 'VAULT' is the honest default: every row that exists today got there
-- through a vault_id, so the backfill is the default value doing its job.
ALTER TABLE comms_attachment ADD COLUMN IF NOT EXISTS attachment_kind text NOT NULL DEFAULT 'VAULT'
  CHECK (attachment_kind IN ('VAULT','MEDIA','ERP'));
ALTER TABLE comms_attachment ADD COLUMN IF NOT EXISTS media_id uuid REFERENCES comms_media(media_id) ON DELETE CASCADE;
ALTER TABLE comms_attachment ADD COLUMN IF NOT EXISTS erp_kind text;
ALTER TABLE comms_attachment ADD COLUMN IF NOT EXISTS erp_id uuid;
-- Cached ONLY as the fallback caption for a reader without rights on the
-- record. Never the source of anything a permitted reader sees — see §3.
ALTER TABLE comms_attachment ADD COLUMN IF NOT EXISTS erp_label text;
-- Every thread read fans out from message ids to their attachments.
CREATE INDEX IF NOT EXISTS ix_comms_attachment_message ON comms_attachment(message_id, created_at);

-- ── Reactions get their lookup ─────────────────────────────────────────────
-- `listReactions` groups by message_id on every thread render. The primary key
-- is (message_id, user_id, emoji), which already leads on message_id, so this
-- is belt-and-braces for the aggregate — added because the thread read is now
-- reactions + attachments + media for fifty messages at a time rather than the
-- bare message rows it was.
CREATE INDEX IF NOT EXISTS ix_comms_reaction_message ON comms_reaction(message_id);

-- ── VERIFY ─────────────────────────────────────────────────────────────────
--   SELECT n.nspname, c.relname
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE c.relname = 'comms_media';
--     -- expect two rows (live + sandbox)
--
--   SELECT attachment_kind FROM comms_attachment LIMIT 1;   -- expect 'VAULT'
--   INSERT INTO comms_attachment (message_id, attachment_kind)
--        VALUES ('<a real message_id>', 'PHOTO');           -- expect: check violation
--   INSERT INTO comms_media (group_id, kind, storage_path, content_type)
--        VALUES ('<a real group_id>', 'GIF', 'k', 'image/gif');  -- expect: check violation
--
-- DOWN
--   -- Additive. Dropping these loses every chat image, every voice note and
--   -- every ERP reference posted since this ran; messages, their text and
--   -- their vault attachments are untouched, and the thread falls back to the
--   -- text-only rendering this migration found. Anything promoted to the vault
--   -- survives in document_vault on its own row.
--   DROP INDEX IF EXISTS ix_comms_reaction_message;
--   DROP INDEX IF EXISTS ix_comms_attachment_message;
--   ALTER TABLE comms_attachment DROP COLUMN IF EXISTS erp_label;
--   ALTER TABLE comms_attachment DROP COLUMN IF EXISTS erp_id;
--   ALTER TABLE comms_attachment DROP COLUMN IF EXISTS erp_kind;
--   ALTER TABLE comms_attachment DROP COLUMN IF EXISTS media_id;
--   ALTER TABLE comms_attachment DROP COLUMN IF EXISTS attachment_kind;
--   DROP INDEX IF EXISTS ix_comms_media_group;
--   DROP TABLE IF EXISTS comms_media;
-- ============================================================================
