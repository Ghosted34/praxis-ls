-- ============================================================================
-- TENANT DB — 10741 Seeded signature templates (PR-2).
--
-- Three system templates. `smartls_classic` is the day-one default so nothing
-- visibly changes for staff already using the standalone generator. Finance
-- gets `formal_legal` because invoices and payment chases are the mail that
-- an auditor will quote.
--
-- Seeded rows are is_system = true: editable, not deletable.
-- ============================================================================

INSERT INTO signature_template (
  key, name, description, layout, copy_en, copy_fr,
  scope_kind, scope_value, is_default, is_system, is_active
) VALUES
(
  'smartls_classic',
  'Smart LS Classic',
  'Logo panel, name in brand colour, contact lines, address, motto bar. The layout everyone already uses.',
  '{
    "kind": "classic",
    "width_px": 650,
    "height_px": 325,
    "brand_color": "#0f4c81",
    "accent_color": "#c9a227",
    "show_logo": true,
    "show_motto_bar": true,
    "show_legal": false
  }'::jsonb,
  '{
    "motto": "Moving cargo. Moving Africa.",
    "disclaimer": "",
    "confidentiality": "This message is intended only for the named recipient and may contain confidential information."
  }'::jsonb,
  '{
    "motto": "Faire bouger le fret. Faire bouger l''Afrique.",
    "disclaimer": "",
    "confidentiality": "Ce message est destiné uniquement au destinataire nommé et peut contenir des informations confidentielles."
  }'::jsonb,
  'TENANT', NULL, true, true, true
),
(
  'compact',
  'Compact',
  'Three lines, no logo panel. For high-volume operational mail and mobile signatures.',
  '{
    "kind": "compact",
    "width_px": 650,
    "height_px": 120,
    "brand_color": "#0f4c81",
    "accent_color": "#c9a227",
    "show_logo": false,
    "show_motto_bar": false,
    "show_legal": false
  }'::jsonb,
  '{
    "motto": "",
    "disclaimer": "",
    "confidentiality": ""
  }'::jsonb,
  '{
    "motto": "",
    "disclaimer": "",
    "confidentiality": ""
  }'::jsonb,
  'TENANT', NULL, false, true, true
),
(
  'formal_legal',
  'Formal / legal',
  'Classic plus legal mentions (legal form, capital, RCCM, NIU) and a confidentiality notice. Default for Finance.',
  '{
    "kind": "formal",
    "width_px": 650,
    "height_px": 380,
    "brand_color": "#0f4c81",
    "accent_color": "#c9a227",
    "show_logo": true,
    "show_motto_bar": true,
    "show_legal": true
  }'::jsonb,
  '{
    "motto": "Moving cargo. Moving Africa.",
    "disclaimer": "",
    "confidentiality": "This message is intended only for the named recipient and may contain confidential information. If you received it in error, please delete it and notify the sender."
  }'::jsonb,
  '{
    "motto": "Faire bouger le fret. Faire bouger l''Afrique.",
    "disclaimer": "",
    "confidentiality": "Ce message est destiné uniquement au destinataire nommé et peut contenir des informations confidentielles. Si vous l''avez reçu par erreur, veuillez le supprimer et en informer l''expéditeur."
  }'::jsonb,
  'DEPARTMENT', 'Finance', true, true, true
)
ON CONFLICT (key) DO NOTHING;

-- Department defaults that are not Finance still point at classic. They are
-- scoped so an admin can change one department without touching the others.
INSERT INTO signature_template (
  key, name, description, layout, copy_en, copy_fr,
  scope_kind, scope_value, is_default, is_system, is_active
)
SELECT
  'smartls_classic_' || d.key,
  'Classic — ' || d.label,
  'Department default pointing at the classic layout.',
  t.layout, t.copy_en, t.copy_fr,
  'DEPARTMENT', d.label, true, true, true
FROM (VALUES
  ('operations', 'Operations'),
  ('sales',      'Sales'),
  ('hr',         'HR'),
  ('support',    'Customer Support')
) AS d(key, label)
CROSS JOIN signature_template t
WHERE t.key = 'smartls_classic'
ON CONFLICT (key) DO NOTHING;

-- DOWN
--   DELETE FROM signature_template WHERE is_system;
