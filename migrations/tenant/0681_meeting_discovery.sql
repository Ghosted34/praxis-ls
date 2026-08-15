-- ============================================================================
-- TENANT DB — 0681 Live Meetings: client discovery becomes structured data.
--
-- ── WHAT THE LEGACY DID, AND WHY IT CANNOT BE PORTED AS-IS ──────────────────
--
-- `smart-quote-leads.php` opens a "Supply Chain Diagnostic / Client Discovery
-- Framework" wizard (openMeetingWizard ~1061) that captures a meeting in three
-- named sections — business/operations context, pain points, proposed strategy —
-- and writes them with save_meeting_notes (smart_quote_api.php ~268) into THREE
-- COLUMNS ON THE LEAD: meeting_ops, meeting_pain, meeting_strategy.
--
-- That shape says a lead has exactly one meeting, forever. The second meeting
-- silently overwrites the first — the wizard even pre-loads the lead's existing
-- values into the boxes, so the overwrite looks like a feature. A salesperson
-- who meets a prospect three times over a quarter keeps only the last visit, and
-- the discovery record a proposal is later drafted from is whatever was said the
-- last time somebody opened the modal.
--
-- Here the sections hang off the MEETING, which is where the facts were actually
-- gathered, and the lead reads through to its most recent one. The history stays.
--
-- ── WHY A CHILD TABLE AND NOT THREE COLUMNS ON `meeting` ────────────────────
--
-- Because each section independently carries a capture STATE. A section can be
-- typed, or dictated — and dictation is asynchronous, can be in flight, and can
-- fail. Three columns cannot hold "this one is still transcribing and that one's
-- audio came back empty" without three more columns each, and the failure state
-- is the entire point: F1's definition of done is that a section whose
-- transcription failed is VISIBLY in that state rather than silently empty.
-- The legacy has no such state — processAudio() ~1805 shows a toast and drops
-- the audio on the floor, so a failed dictation is indistinguishable from a
-- section nobody filled in.
--
-- ── WHY THE TRANSCRIPT REFERENCE MOVED ──────────────────────────────────────
--
-- `meeting.transcript_vault_id` has existed since 0350, and
-- meeting.service.js:10 read it FROM THE REQUEST BODY — the caller asserting
-- which vault document is its own transcript, with nothing enqueuing a
-- transcription in the first place. Per-section dictation makes the reference
-- per-section, and only the ai-transcribe worker writes it. The meeting-level
-- column is kept and now means "the latest transcript captured on this meeting",
-- written by the same worker — so it has a defined meaning instead of being a
-- field the client fills in about itself.
--
-- ── PROMPTS ARE DATA ────────────────────────────────────────────────────────
--
-- The legacy prints three scripted probing questions above each box, hard-coded
-- into the modal markup (lines 845-893). They are part of the feature — a blank
-- box gets blank answers — but they are also the kind of thing a sales manager
-- rewrites, so they are rows, seeded `is_system` and editable per tenant. EN and
-- FR both land now, per the settled decision that French columns arrive with the
-- schema even though the language toggle is separate work.
--
-- Idempotent: every DDL statement is IF NOT EXISTS; the seed is guarded per row
-- on (section_key, sort_order), so a re-run inserts nothing and never overwrites
-- a tenant's own wording. Switching a prompt off is `is_active = false`, not a
-- DELETE, so a re-run cannot resurrect one somebody deliberately turned off.
-- ============================================================================

-- ── 1. Where the meeting happened ───────────────────────────────────────────
-- The legacy wizard captures it (meetLocation, line 837) and this schema had
-- nowhere to put it. The meeting DATE is not added: `scheduled_at` already is it.
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS location text;

-- ── 2. The three discovery sections ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_discovery_section (
  meeting_discovery_section_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id       uuid NOT NULL REFERENCES meeting(meeting_id) ON DELETE CASCADE,
  -- Fixed vocabulary. These three ARE the framework; a tenant renames the
  -- labels and rewrites the prompts, but a fourth section would mean a
  -- different diagnostic and a different downstream reader.
  section_key      text NOT NULL CHECK (section_key IN ('OPERATIONS','PAIN_POINTS','STRATEGY')),
  body             text,
  -- EMPTY               nothing captured yet
  -- TYPED               a human typed it
  -- DICTATING           audio accepted, transcription in flight
  -- TRANSCRIBED         the worker landed text here
  -- TRANSCRIPTION_FAILED audio was accepted and did not come back as text
  capture_state    text NOT NULL DEFAULT 'EMPTY'
                     CHECK (capture_state IN ('EMPTY','TYPED','DICTATING','TRANSCRIBED','TRANSCRIPTION_FAILED')),
  dictation_job_id text,
  dictation_error  text,
  -- Written by src/jobs/handlers/ai-transcribe.js. NOT settable by the caller.
  transcript_vault_id uuid REFERENCES document_vault(doc_id),
  audio_seconds    numeric(10,2),
  updated_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- One row per section per meeting: the section IS the identity, so a save is
  -- an upsert and a double-submit cannot produce two "pain points" for one visit.
  CONSTRAINT uq_meeting_discovery_section UNIQUE (meeting_id, section_key)
);

-- ── 3. Reading the discovery set back ───────────────────────────────────────
-- "The latest discovery set for a lead" is the read a later feature (F4,
-- proposal generation) makes, so the ordering it uses gets an index rather than
-- a sort over every meeting the lead ever had.
CREATE INDEX IF NOT EXISTS ix_meeting_lead_recent
  ON meeting (lead_id, scheduled_at DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_meeting_client_recent
  ON meeting (client_id, scheduled_at DESC NULLS LAST, created_at DESC);

-- ── 4. The probing questions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_discovery_prompt (
  meeting_discovery_prompt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key  text NOT NULL CHECK (section_key IN ('OPERATIONS','PAIN_POINTS','STRATEGY')),
  prompt_en    text NOT NULL,
  prompt_fr    text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  -- TRUE for the nine shipped questions. A tenant may edit or deactivate them;
  -- the flag is what tells this migration it has already seeded.
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mdp_section
  ON meeting_discovery_prompt (section_key, sort_order);

-- The seed's guard, as a constraint rather than a convention. PARTIAL, on
-- is_system: the nine shipped questions occupy one slot each and a re-run
-- cannot double them, while a tenant remains free to add their own tenth at
-- any sort order without colliding with ours.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mdp_system_seed
  ON meeting_discovery_prompt (section_key, sort_order) WHERE is_system;

-- ── 5. Seed: the nine questions, verbatim from the legacy modal ─────────────
-- Dollar-quoted so the French apostrophes need no escaping.
INSERT INTO meeting_discovery_prompt (section_key, prompt_en, prompt_fr, sort_order, is_system)
SELECT v.section_key, v.prompt_en, v.prompt_fr, v.sort_order, true
  FROM (VALUES
    ('OPERATIONS', 1,
      $q$What is the core nature of your imported/exported goods (perishables, heavy equipment, standard retail)?$q$,
      $q$Quelle est la nature de vos marchandises importées/exportées (denrées périssables, équipements lourds, produits de détail) ?$q$),
    ('OPERATIONS', 2,
      $q$What are your average monthly container/tonnage volumes?$q$,
      $q$Quels sont vos volumes mensuels moyens (conteneurs / tonnage) ?$q$),
    ('OPERATIONS', 3,
      $q$Who are your primary end-users, and how critical is delivery timing to your revenue?$q$,
      $q$Qui sont vos clients finaux, et quelle est l'importance des délais de livraison pour votre chiffre d'affaires ?$q$),
    ('PAIN_POINTS', 1,
      $q$Where are you experiencing the highest cost leakages (demurrage, storage, customs penalties)?$q$,
      $q$Où subissez-vous les plus fortes pertes financières (surestaries, stockage, pénalités douanières) ?$q$),
    ('PAIN_POINTS', 2,
      $q$Do you currently lack real-time visibility over your shipments?$q$,
      $q$Manquez-vous aujourd'hui de visibilité en temps réel sur vos expéditions ?$q$),
    ('PAIN_POINTS', 3,
      $q$What specific regulatory or customs hurdles are delaying your supply chain?$q$,
      $q$Quels obstacles réglementaires ou douaniers ralentissent votre chaîne logistique ?$q$),
    ('STRATEGY', 1,
      $q$If we can guarantee 72-hour customs clearance, how does that impact your bottom line?$q$,
      $q$Si nous garantissons un dédouanement en 72 heures, quel en serait l'impact sur vos résultats ?$q$),
    ('STRATEGY', 2,
      $q$Would a dedicated transport fleet and an independent account manager solve your cash flow issues?$q$,
      $q$Une flotte de transport dédiée et un gestionnaire de compte indépendant résoudraient-ils vos problèmes de trésorerie ?$q$),
    ('STRATEGY', 3,
      $q$What specific KPIs must we hit for you to consider this partnership a success?$q$,
      $q$Quels indicateurs précis devons-nous atteindre pour que ce partenariat soit un succès à vos yeux ?$q$)
  ) AS v(section_key, sort_order, prompt_en, prompt_fr)
 WHERE NOT EXISTS (
   SELECT 1 FROM meeting_discovery_prompt p
    WHERE p.is_system AND p.section_key = v.section_key AND p.sort_order = v.sort_order
 )
    ON CONFLICT (section_key, sort_order) WHERE is_system DO NOTHING;

-- DOWN
-- The sections hold captured client discovery — read what would be lost first:
--   SELECT COUNT(*) FROM meeting_discovery_section WHERE COALESCE(body,'') <> '';
--
-- DROP INDEX IF EXISTS uq_mdp_system_seed;
-- DROP TABLE IF EXISTS meeting_discovery_prompt;
-- DROP TABLE IF EXISTS meeting_discovery_section;
-- DROP INDEX IF EXISTS ix_meeting_client_recent;
-- DROP INDEX IF EXISTS ix_meeting_lead_recent;
-- ALTER TABLE meeting DROP COLUMN IF EXISTS location;
