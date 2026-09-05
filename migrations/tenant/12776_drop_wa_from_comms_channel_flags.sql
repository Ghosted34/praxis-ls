DELETE FROM ai_feature_flag
WHERE feature_key IN ('whatsapp', 'instagram');


-- D0WN
-- INSERT INTO ai_feature_flag (feature_key, display_name, description, is_enabled)
-- VALUES
--   ('whatsapp',  'WhatsApp channel',   'Outbound/inbound WhatsApp conversations (hidden until enabled).', false),
--   ('instagram', 'Instagram channel',  'Instagram DM conversations (hidden until enabled).',            false)
-- ON CONFLICT (feature_key) DO NOTHING;