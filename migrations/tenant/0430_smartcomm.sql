-- ============================================================================
-- TENANT DB — 0430 Smart Comms depth (PRD §11.5 / kickoff §11.16).
-- Corporate WhatsApp-style: channels + members (presence/read/pin/mute),
-- messages (edit/delete/delivery/reply), reactions, stars, attachments, drafts,
-- quick replies. NO WhatsApp/Instagram APIs (formal corporate comms); phone/
-- email are wa.me/tel:/mailto links on the client. Clients can access via a
-- CLIENT channel (client_id scope). Chats are auditable + certified-exportable.
-- ============================================================================

-- Channels (extend comms_group) --------------------------------------------
ALTER TABLE comms_group ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED'));
ALTER TABLE comms_group ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES client_master(client_id);   -- CLIENT thread scope
ALTER TABLE comms_group ADD COLUMN IF NOT EXISTS topic text;
ALTER TABLE comms_group ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_user(user_id);
ALTER TABLE comms_group ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Messages (extend comms_message) ------------------------------------------
ALTER TABLE comms_message ADD COLUMN IF NOT EXISTS reply_to_message_id uuid REFERENCES comms_message(message_id);
ALTER TABLE comms_message ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE comms_message ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE comms_message ADD COLUMN IF NOT EXISTS delivery text NOT NULL DEFAULT 'SENT' CHECK (delivery IN ('SENT','DELIVERED','READ'));
CREATE INDEX IF NOT EXISTS ix_comms_message_group ON comms_message(group_id, created_at);

-- Members: who's in a channel + their per-channel state ----------------------
CREATE TABLE IF NOT EXISTS comms_member (
  group_id       uuid NOT NULL REFERENCES comms_group(group_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  member_role    text NOT NULL DEFAULT 'MEMBER' CHECK (member_role IN ('OWNER','ADMIN','MEMBER')),
  is_pinned      boolean NOT NULL DEFAULT false,   -- pinned in the member's channel list
  is_muted       boolean NOT NULL DEFAULT false,
  last_read_at   timestamptz,                      -- read receipts / unread counts
  last_seen_at   timestamptz,                      -- presence
  joined_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- Reactions + stars ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS comms_reaction (
  message_id     uuid NOT NULL REFERENCES comms_message(message_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  emoji          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS comms_star (
  message_id     uuid NOT NULL REFERENCES comms_message(message_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- Attachments (multiple media per message; each < 10MB, stored in the vault) --
CREATE TABLE IF NOT EXISTS comms_attachment (
  attachment_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     uuid NOT NULL REFERENCES comms_message(message_id) ON DELETE CASCADE,
  vault_id       uuid REFERENCES document_vault(doc_id),
  filename       text,
  content_type   text,
  size_bytes     bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Per-channel per-user draft -------------------------------------------------
CREATE TABLE IF NOT EXISTS comms_draft (
  group_id       uuid NOT NULL REFERENCES comms_group(group_id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  body           text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- Quick replies (canned messages; personal when owner set, else shared) -------
CREATE TABLE IF NOT EXISTS comms_quick_reply (
  quick_reply_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid REFERENCES app_user(user_id),   -- NULL = tenant-shared
  label          text NOT NULL,
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_comms_group_updated BEFORE UPDATE ON comms_group FOR EACH ROW EXECUTE FUNCTION set_updated_at();
