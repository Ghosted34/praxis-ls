-- ============================================================================
-- PLATFORM DB — 0110 the primary chat vendor is a choice, not a constant
--
-- Until now which AI vendor answered first was two lines in
-- `src/services/ai/llm.service.js` (`PRIMARY = "deepseek"`,
-- `FALLBACK = "gemini"`), so switching the deployment from DeepSeek to Gemini
-- meant a code change, a test update and a deploy. Everything else about the
-- vendors — key, endpoint, model, active — was already the platform's to set
-- in the console; the ORDER was the one thing it could not touch.
--
-- `is_chat_primary` marks the row the runtime tries first. `llm.service.
-- resolveChain` reads it on every call and puts that vendor at the head of the
-- chain with the default chain behind it as the fallback, so choosing Gemini
-- makes DeepSeek the fallback rather than leaving nothing behind it (audit B2).
-- No flagged row means the code default — exactly what every deployment ran
-- on before this file.
--
-- ONE primary, enforced by the database. A partial unique index over the TRUE
-- rows is the constraint "at most one row is primary" stated directly; two
-- flagged rows would make the runtime's choice depend on scan order.
--
-- DeepSeek is flagged as the incumbent so the console shows the primary the
-- fleet is actually on from the first render, not "none chosen" while every
-- turn still goes to DeepSeek. Guarded on no row being flagged yet, so a
-- re-run — or a deployment that chose before this file was applied — is not
-- overridden.
--
-- ── THE GEMINI ROW REPAIR ─────────────────────────────────────────────────
--
-- 0060 seeded `gemini` pointing at `…/v1beta` — Google's NATIVE endpoint, which
-- does not speak /chat/completions. `llm.service.looksLikeNativeGemini` has
-- flagged exactly this shape since audit B2 ("resolves but every call fails"),
-- and the tenant seed (0470) already carries the compat gateway `…/v1beta/
-- openai`; the platform seed, which is the one the runtime reads, never got
-- the same correction. As the FALLBACK that meant a DeepSeek outage degraded
-- to the stub instead of to Gemini. As a PRIMARY — which this file makes
-- possible with one click — it would mean every call fails. So the row is
-- repaired here, where the click is introduced.
--
-- The model is moved off `gemini-1.5-flash`, which Google has shut down; the
-- replacement is `gemini-2.5-flash` — a stable (GA) model with no shutdown
-- date announced, the same family (flash) and role (fast, cheap, vision-
-- capable) the seed intended. Vision (`vision.service`) reads the SAME row's
-- model and key through the Google SDK, not the endpoint, so this fixes CV
-- reading and document OCR on a stock deployment too.
--
-- Both repairs rewrite ONLY the exact seeded values. An operator who set a
-- different endpoint or model in the console made a decision, and a migration
-- that reverses a decision is a regression with a filename. 0060 itself is
-- not edited: it is applied and ledgered by sha256, and an edited applied
-- file is a fleet-wide content-drift alarm that repairs nothing.
--
-- Prices: `tenant/12744` seeded per-token prices for `gemini-1.5-flash`; the
-- 2.5 line is priced differently and the operator re-prices the row in
-- AI Control → Vendors. Not done here — a price guessed in a migration is a
-- wrong cost ledger with a filename.
-- ============================================================================

ALTER TABLE ai_vendor_credential
  ADD COLUMN IF NOT EXISTS is_chat_primary boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ai_vendor_credential.is_chat_primary IS
  'The one chat vendor llm.service tries first (Platform Console → Integrations → AI providers → Use as primary). At most one row TRUE (ux_ai_vendor_credential_chat_primary). None flagged = the code default (deepseek).';

CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_vendor_credential_chat_primary
  ON ai_vendor_credential (is_chat_primary)
  WHERE is_chat_primary;

-- The incumbent. Only when nothing is flagged yet (idempotent, and never
-- overrides a choice already made).
UPDATE ai_vendor_credential
   SET is_chat_primary = true
 WHERE vendor = 'deepseek'
   AND NOT EXISTS (SELECT 1 FROM ai_vendor_credential WHERE is_chat_primary);

-- Gemini: the OpenAI-compatible gateway, not the native API. Exact seeded
-- value only (trailing slash tolerated).
UPDATE ai_vendor_credential
   SET endpoint_url = 'https://generativelanguage.googleapis.com/v1beta/openai',
       updated_at   = now()
 WHERE vendor = 'gemini'
   AND rtrim(endpoint_url, '/') = 'https://generativelanguage.googleapis.com/v1beta';

-- Gemini: off the shut-down 1.5 line. Exact seeded values only.
UPDATE ai_vendor_credential
   SET default_model = 'gemini-2.5-flash',
       current_model = CASE
                         WHEN current_model IS NULL
                           OR current_model IN ('gemini-1.5-flash', 'gemini-1.5-pro')
                         THEN 'gemini-2.5-flash'
                         ELSE current_model
                       END,
       updated_at    = now()
 WHERE vendor = 'gemini'
   AND default_model IN ('gemini-1.5-flash', 'gemini-1.5-pro');

-- DOWN
-- DROP INDEX IF EXISTS ux_ai_vendor_credential_chat_primary;
-- ALTER TABLE ai_vendor_credential DROP COLUMN IF EXISTS is_chat_primary;
-- The Gemini endpoint/model repair is not reversed: the values it replaced
-- were a dead endpoint and a shut-down model.
