-- ============================================================================
-- 0470 — seed the AI vendor rows so "AI Control → Vendors" isn't an empty
-- dead-end on a fresh tenant (the screen was built to list rows seeded on
-- bootstrap + let you paste each key, but the seed was never written).
--
-- Rows carry endpoint + default model only — NO api_key. An admin sets the key
-- per tenant in the UI (encrypted at rest); until then the runtime falls back to
-- the matching .env key. Vendor ids MUST match what the runtime resolves:
--   embeddings.service → 'embeddings'   (pgvector recall)
--   llm.service PRIMARY → 'deepseek'     (assistant / chat)
--   ai-vision          → 'gemini'        (document vision)
--   ai-transcribe      → 'groq'          (voice-to-text)
-- Idempotent: ON CONFLICT DO NOTHING never clobbers a key already set. Runs per
-- schema (live + sandbox) like every migrations/tenant file.
-- ============================================================================

INSERT INTO ai_vendor_credential (vendor, display_name, endpoint_url, default_model, cost_native_currency) VALUES
  ('embeddings', 'Embeddings (OpenAI)', 'https://api.openai.com/v1',                                'text-embedding-3-small', 'USD'),
  ('deepseek',   'DeepSeek',            'https://api.deepseek.com/v1',                              'deepseek-chat',          'USD'),
  ('gemini',     'Google Gemini',       'https://generativelanguage.googleapis.com/v1beta/openai',  'gemini-1.5-flash',       'USD'),
  ('groq',       'Groq',                'https://api.groq.com/openai/v1',                           'whisper-large-v3',       'USD')
ON CONFLICT (vendor) DO NOTHING;
