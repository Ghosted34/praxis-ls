-- ============================================================================
-- TENANT DB — the signature CARD template.
--
-- WHAT THIS IS. Staff have been generating their email signatures in a
-- standalone HTML tool kept outside the product. That tool draws one specific
-- card — 650 × 325, a three-stop accent bar, a logo panel beside a gradient
-- rule, five icon contact rows and a script motto on a pill. `10765` seeded
-- `smartls_classic` and described it as "the exact layout of the current
-- standalone generator", but what that template actually renders is a plain
-- bordered table: the description was the intent, not the outcome. This is the
-- card itself, rendered by signature.card.js.
--
-- WHY A FOURTH TEMPLATE RATHER THAN A REWRITE OF smartls_classic. Rewriting a
-- seeded row would change what every tenant already on it renders, with no way
-- back short of another migration, and it would break the committed HTML
-- snapshot that pins the classic markup against Outlook, Gmail and Apple Mail.
-- A new row is reversible in one UPDATE and leaves the other three intact.
--
-- WHY IT IS THE DEFAULT. The card is what staff already paste into Outlook by
-- hand. Seeding it as non-default would mean the feature ships and nothing
-- changes until an admin finds a screen they have never had a reason to visit.
--
-- COLOURS ARE NOT IN HERE, ON PURPOSE. `ink`, `glow` and `warm` resolve from
-- the tenant's own appearance settings (signature.palette.js): accent_deep,
-- accent_glow and primary_color respectively, falling back to the Praxis LS
-- palette when a tenant has set none. Pinning hexes here would put one
-- customer's brand on every tenant's outbound mail.
--
-- The four values that ARE pinned are the ones that are not a function of a
-- brand colour: two background tints and the far stop of the warm gradient,
-- hand-picked in the original, plus the two font families. Deriving those lands
-- 1–3/255 away, which is invisible and still not the same file.
-- ============================================================================

INSERT INTO signature_template (
  key, name, description, layout, copy_en, copy_fr,
  scope_kind, scope_value, is_default, is_system, is_active
) VALUES (
  'signature_card',
  'Signature card',
  'The designed 650 × 325 card: accent bar, logo panel, icon contact rows and a script motto. Sent as a PNG with live text beneath it. Colours follow the tenant brand.',
  '{
    "kind": "card",
    "width_px": 650,
    "height_px": 325,
    "show_logo": true,
    "show_motto_bar": true,
    "show_legal": false,
    "surface_color": "#f0f8fd",
    "surface_deep_color": "#e0f2fe",
    "warm_deep_color": "#f97316",
    "font_body": "Montserrat",
    "font_motto": "Brittany Signature"
  }'::jsonb,
  '{
    "motto": "Going Beyond Your Expectations...",
    "disclaimer": "",
    "confidentiality": ""
  }'::jsonb,
  '{
    "motto": "Going Beyond Your Expectations...",
    "disclaimer": "",
    "confidentiality": ""
  }'::jsonb,
  'TENANT', NULL, false, true, true
)
ON CONFLICT (key) DO NOTHING;

-- Hand the TENANT-wide default over, in that order: the unique index
-- ux_signature_template_default allows one default per scope, so the old one
-- has to stand down before the new one stands up.
--
-- DEPARTMENT-scoped defaults are deliberately left alone. Finance is on
-- `formal_legal` because its mail carries legal mentions an auditor may quote,
-- and a prettier card is not a reason to drop them.
UPDATE signature_template
   SET is_default = false, updated_at = now()
 WHERE scope_kind = 'TENANT' AND scope_value IS NULL AND is_default
   AND key <> 'signature_card';

UPDATE signature_template
   SET is_default = true, updated_at = now()
 WHERE key = 'signature_card'
   AND NOT is_default;

-- Clearing the render cache. Nothing of value is lost —
-- `signature_render` is a CACHE, keyed by a `source_hash` over the inputs, and
-- every row in it predates both the card and signatures carrying a logo at all
-- (loadEntity never joined entity_address, and a storage-key logo failed the
-- https-only check, so `show_logo` computed false for every tenant). There is
-- no row here that is still correct. The cost of clearing it is one re-render
-- per person on their next send; the cost of NOT clearing it is that the
-- default template changes and nobody sees it until something unrelated
-- happens to move their hash.
--
-- Sent mail is untouched: a signature is baked into email_message.body_html at
-- send time and stays there, which is the rule §6.3 of the mail guide sets out
-- and the reason this table can be cleared without rewriting history.
-- DESTRUCTIVE: signature_render is a cache — every cached render is stale (new default template, first-ever logo), sent mail untouched.
DELETE FROM signature_render;

-- DOWN
--   UPDATE signature_template SET is_default = false WHERE key = 'signature_card';
--   UPDATE signature_template SET is_default = true
--    WHERE key = 'smartls_classic' AND scope_kind = 'TENANT' AND scope_value IS NULL;
--   DELETE FROM signature_template WHERE key = 'signature_card';
--   DELETE FROM signature_render;
