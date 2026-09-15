-- Both channels are unbuilt and the flags were never surfaced, so nothing reads
-- these rows. The DOWN below re-seeds them, but re-seeds them DISABLED — a
-- tenant's prior is_enabled value is not recoverable from this migration.
-- DESTRUCTIVE: drops the 'whatsapp' and 'instagram' rows of ai_feature_flag, and any is_enabled state a tenant had set on them.
DELETE FROM ai_feature_flag
WHERE feature_key IN ('whatsapp', 'instagram');


-- DOWN
-- INSERT INTO ai_feature_flag (feature_key, display_name, description, is_enabled)
-- VALUES
--   ('whatsapp',  'WhatsApp channel',   'Outbound/inbound WhatsApp conversations (hidden until enabled).', false),
--   ('instagram', 'Instagram channel',  'Instagram DM conversations (hidden until enabled).',            false)
-- ON CONFLICT (feature_key) DO NOTHING;