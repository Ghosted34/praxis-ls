-- ============================================================================
-- 9113 — The Smart Mail feature keys, in the PLATFORM catalogue.
--
-- ── THE DEFECT THIS CLOSES ─────────────────────────────────────────────────
--
-- Migration 10730 seeds fifteen `mail.*` rows into every tenant's
-- `feature_state`, all 'off', `source = 'default'`. Every mail surface is gated
-- on them: `requireFeature` is mounted in FRONT of each router by
-- module-loader.js and has NO bypass — not even for the CEO, who bypasses RBAC.
--
-- NONE of those keys existed in `platform.feature_catalogue`.
--
-- `provisioning.projectFeatures()` iterates the CATALOGUE, so it never touched
-- them. `plans.service.reprojectPlan` does the same. No tenant-side route writes
-- `feature_state` at all. So there was no supported way to turn the mailbox on —
-- not from the console, not from a plan, not from a tenant screen. Q5 says
-- `mail.*` is "all on for Smart Logistics, off for every other tenant"; the
-- first half of that sentence had no mechanism behind it.
--
-- This is 9110's own documented failure mode, a second time. Its header records
-- the first: "nine keys below were flipped 'off' -> 'on' because their modules
-- are built and mounted, and leaving them off made 19 modules unreachable for
-- everyone." Same shape, different fifteen keys.
--
-- ── WHY MOD-64 AND depends_on {comms} ──────────────────────────────────────
--
-- MOD-72 is the RBAC module key the mail routes check; it is not in
-- `platform.module_catalogue`, and `feature_catalogue.module_key` is a foreign
-- key to it. MOD-64 — Smart Comms & Signatures — is where the mailbox belongs
-- anyway, and hanging every key off `comms` matches how 9112 attached WhatsApp
-- and Instagram. Turning Smart Comms off takes the mailbox with it, which is
-- the correct reading of a mailbox that lives inside the comms module.
--
-- ── WHAT default_state MEANS HERE ──────────────────────────────────────────
--
-- 9110 is explicit: `default_state` answers "is this module SHIPPABLE?", not
-- "did the customer buy it?". Plan inclusion is `plan_feature`'s job and
-- per-tenant exceptions are `tenant_feature_override`'s.
--
-- So the twelve keys whose chapters are built, mounted and gated ship 'on', and
-- three ship 'off' for reasons that are not about readiness:
--
--   mail.ai              opt-in, exactly like every other `ai.*` key. It also
--                        depends on `ai.assistant.backend`, which makes §3.3's
--                        rule — "an AI flag is a floor, not a ceiling" —
--                        enforced by the projection rather than only by
--                        `assist.service`.
--   mail.ocr             sends a scanned supplier invoice, bank details and
--                        all, to a vision vendor, and is billed per page. A
--                        tenant opts into that separately from drafting.
--   mail.provider.oauth  Microsoft Graph and Gmail are built and deliberately
--                        gated — the decision was one provider done properly
--                        first, and the one the first tenant runs is cPanel
--                        IMAP/SMTP.
--
-- ── AFTER APPLYING ─────────────────────────────────────────────────────────
--
-- Re-project features for existing tenants (platform console → Tenant → Migrate,
-- or provisioning.projectFeatures(slug)) so their `feature_state` gains these
-- rows. Diagnose any tenant with:
--   node scripts/tenant/feature-report.js --slug=<slug>
-- ============================================================================

INSERT INTO platform.feature_catalogue (feature_key, module_key, name, description, default_state, depends_on) VALUES
 ('mail.core',           'MOD-64', 'Mailbox',                  'Conversations, folders, search and the reading pane.',                     'on',  '{comms}'),
 ('mail.composer',       'MOD-64', 'Composer',                 'Writing, drafts, attachments, slash commands and undo-send.',              'on',  '{mail.core}'),
 ('mail.binding',        'MOD-64', 'Record binding',           'Linking a conversation to a client, supplier or file, and the drawer.',    'on',  '{mail.core}'),
 ('mail.notes',          'MOD-64', 'Internal notes',           'Notes on a thread that are never quoted into a reply.',                    'on',  '{mail.binding}'),
 ('mail.doc_intake',     'MOD-64', 'Document intake',          'Classifying inbound attachments and filing them, after confirmation.',     'on',  '{mail.binding}'),
 ('mail.signatures',     'MOD-64', 'Mail signatures',          'Rendered signature blocks baked into outbound mail.',                      'on',  '{mail.composer}'),
 ('mail.deliverability', 'MOD-64', 'Deliverability',           'SPF, DKIM, DMARC, PTR and blocklist checks on sending domains.',           'on',  '{mail.core}'),
 ('mail.shared_inbox',   'MOD-64', 'Shared inbox',             'Claiming, assignment, work status, soft locks and SLA policies.',          'on',  '{mail.core}'),
 ('mail.followup',       'MOD-64', 'Follow-ups',               'Snoozing a thread and boomerangs that cancel when the client replies.',    'on',  '{mail.core}'),
 ('mail.secure_links',   'MOD-64', 'Secure links',             'Expiring, revocable links to a document instead of a large attachment.',   'on',  '{mail.composer}'),
 ('mail.archive',        'MOD-64', 'Immutable archive',        'The tamper-evident hash chain over every message, and thread visibility.', 'on',  '{mail.core}'),
 ('mail.antispoof',      'MOD-64', 'Sender verification',      'Lookalike-domain detection and the financial-document send block.',        'on',  '{mail.core}'),
 -- Opt-in. See the header.
 ('mail.ai',             'MOD-64', 'Mail AI',                  'Drafting, rewriting, translation and thread summaries in the mailbox.',    'off', '{mail.composer,ai.assistant.backend}'),
 ('mail.ocr',            'MOD-64', 'Attachment extraction',    'Reading fields off scanned invoices, receipts and cheques.',                'off', '{mail.ai}'),
 ('mail.provider.oauth', 'MOD-64', 'Microsoft 365 / Google',   'OAuth mailbox providers. Built and deliberately gated.',                   'off', '{mail.core}')
ON CONFLICT (feature_key) DO UPDATE SET
  module_key    = EXCLUDED.module_key,
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  default_state = EXCLUDED.default_state,
  depends_on    = EXCLUDED.depends_on;

-- Full and Enterprise include everything, as they do in 9110. Those two SELECT
-- straight from the catalogue there, but that ran once — before these rows
-- existed — so they are added explicitly, exactly as 9112 had to.
INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT p.plan_id, f.feature_key, true
  FROM platform.plan p
  CROSS JOIN (VALUES
    ('mail.core'), ('mail.composer'), ('mail.binding'), ('mail.notes'),
    ('mail.doc_intake'), ('mail.signatures'), ('mail.deliverability'),
    ('mail.shared_inbox'), ('mail.followup'), ('mail.secure_links'),
    ('mail.archive'), ('mail.antispoof'), ('mail.ai'), ('mail.ocr'),
    ('mail.provider.oauth')
  ) AS f(feature_key)
 WHERE p.code IN ('full', 'enterprise')
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;

-- Starter gets a working mailbox and nothing that costs a vendor call or
-- implies a team. `comms` and `signatures` are already in Starter (9110), so a
-- mailbox is consistent with what that plan already promises; the shared inbox,
-- the archive and the AI are what the larger plans are for.
INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT p.plan_id, f.feature_key, true
  FROM platform.plan p
  CROSS JOIN (VALUES
    ('mail.core'), ('mail.composer'), ('mail.binding'), ('mail.signatures'),
    ('mail.deliverability')
  ) AS f(feature_key)
 WHERE p.code = 'starter'
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;
