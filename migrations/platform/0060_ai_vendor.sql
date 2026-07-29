-- Deploy-wide (platform) AI vendor credentials — ONE shared key set every tenant
-- uses. Keys were previously per-tenant (tenant.ai_vendor_credential); they now
-- live here and are managed only from the platform console. The AI runtime reads
-- keys from this table; tenant vendor rows remain for cost/usage metadata only.
CREATE TABLE IF NOT EXISTS ai_vendor_credential (
  credential_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor         text UNIQUE NOT NULL,               -- 'deepseek' | 'embeddings' | 'gemini' | 'groq'
  display_name   text,
  api_key_enc    text,                               -- AES-256-GCM (encryption.service)
  endpoint_url   text,
  default_model  text,
  current_model  text,
  is_active      boolean NOT NULL DEFAULT true,
  last_rotated_at timestamptz,
  last_rotated_by uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ai_vendor_credential (vendor, display_name, endpoint_url, default_model, current_model, is_active) VALUES
  ('deepseek',   'DeepSeek',            'https://api.deepseek.com',                          'deepseek-chat',          'deepseek-chat',          true),
  ('embeddings', 'Embeddings (OpenAI)', 'https://api.openai.com/v1',                         'text-embedding-3-small', 'text-embedding-3-small', true),
  ('gemini',     'Google Gemini',       'https://generativelanguage.googleapis.com/v1beta',  'gemini-1.5-flash',       'gemini-1.5-flash',       true),
  ('groq',       'Groq',                'https://api.groq.com/openai/v1',                    'whisper-large-v3',       'whisper-large-v3',       true)
ON CONFLICT (vendor) DO NOTHING;
