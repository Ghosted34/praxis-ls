-- ============================================================================
-- TENANT — 13794 Smart Comms grows the four things a chat needs.
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
-- Everything here is IF NOT EXISTS. `comms_media` is a NEW table, so it carries
-- its CHECKs and foreign keys inline and there is no separate ADD CONSTRAINT to
-- guard wrongly on `conname` (see 13791 and check-constraint-guards).
--
-- `comms_attachment` already exists, and for that reason gains PLAIN columns
-- only — no CHECK, no foreign key. That is not a style choice; a constraint on
-- a pre-existing table added above 13791 aborts provisioning a new tenant. The
-- full reasoning sits directly above those ALTERs, where somebody about to add
-- one will read it.
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
--
-- ── WHY THERE IS NO CHECK AND NO FOREIGN KEY ON THESE FIVE COLUMNS ────────
--
-- Because a constraint added to a PRE-EXISTING table by any migration numbered
-- above 13791 breaks provisioning a brand-new tenant, and this is the first
-- migration since 13791 to try. It cost a red `migrations` job to find, so the
-- reasoning is recorded here rather than left to be rediscovered:
--
--   `provisioning.service.js` migrates `for (const schema of ["live",
--   "sandbox"])` — every file against live, THEN every file against sandbox.
--   13791 repairs sandbox by mirroring the constraints it finds in live. By the
--   time it runs in the SANDBOX pass, live is already at the head of the
--   migration list, so it sees this file's constraints; but sandbox is only at
--   13791, so `comms_attachment` has none of the columns below yet. 13791
--   guards that the TABLE exists in the target and not that the COLUMN does,
--   and its exception handler catches check_violation and
--   foreign_key_violation — not undefined_column. So it aborts:
--
--     Failed applying tenant/13791_sandbox_constraint_repair.sql [sandbox]:
--       column "attachment_kind" does not exist
--
-- 13791 cannot be edited to fix this, and that is deliberate rather than an
-- oversight — its own header explains why: `contentDrift` compares each applied
-- file's sha256 against the ledger, so editing a file that has already run
-- reports every tenant in the fleet as content-drifted and turns a real alarm
-- into permanent noise. A later migration cannot help either, since 13791 fails
-- before one could run.
--
-- So the rule is: above 13791, a NEW table may carry any constraint it likes
-- (13791 skips a table absent from the target, which is why everything on
-- `comms_media` above is fully constrained), and an EXISTING table may only
-- gain plain columns. That is what these five are.
--
-- WHAT ENFORCES THEM INSTEAD. Both rules live on the only write path there is.
-- `attachment_kind` is written solely by `attachmentRow` in
-- smartcomm.service.js, which maps every descriptor onto exactly one of the
-- three literals and cannot emit a fourth, and the request is enum-checked by
-- `attachment` in smartcomm.validator.js before it gets there. `media_id` is
-- only ever a `media_id` this module just handed the client from
-- `POST /channels/:id/media`. What is genuinely lost is ON DELETE CASCADE, and
-- nothing deletes a `comms_media` row today — when something does, it must
-- clear the attachments pointing at it.
--
-- DEFAULT 'VAULT' is the honest default and is safe here: a column default is
-- not a constraint, and 13791 copies only contype 'c' and 'f'. Every row that
-- exists today got there through a vault_id, so the backfill is the default
-- doing its job.
ALTER TABLE comms_attachment ADD COLUMN IF NOT EXISTS attachment_kind text NOT NULL DEFAULT 'VAULT';
ALTER TABLE comms_attachment ADD COLUMN IF NOT EXISTS media_id uuid;
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
--   INSERT INTO comms_media (group_id, kind, storage_path, content_type)
--        VALUES ('<a real group_id>', 'GIF', 'k', 'image/gif');  -- expect: check violation
--
--   -- comms_attachment deliberately has NO check on attachment_kind — see the
--   -- note above the ALTERs. The database accepts a fourth value; the service
--   -- and the validator are what refuse it:
--   SELECT conname FROM pg_constraint c
--     JOIN pg_class t ON t.oid = c.conrelid
--    WHERE t.relname = 'comms_attachment' AND c.contype IN ('c','f');
--     -- expect only the constraints 0430 created, none naming attachment_kind
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
--   -- (no constraints to drop on comms_attachment — see the note above the ALTERs)
--   DROP INDEX IF EXISTS ix_comms_media_group;
--   DROP TABLE IF EXISTS comms_media;
-- ============================================================================
