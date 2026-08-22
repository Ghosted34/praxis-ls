-- ============================================================================
-- TENANT DB — 12744 AI vendors: give the seeded providers a price.
--
-- WHAT WAS WRONG
--
-- AI Control → Usage counted tokens correctly and then reported "0.00" for
-- every call and "0.00" for the period total. Nothing was broken in the
-- counting: 0470 seeded the four vendor rows with endpoint + model + currency
-- and left `cost_per_1k_input_tokens`, `cost_per_1k_output_tokens` and
-- `cost_per_audio_minute` on their DEFAULT 0. `governance.recordUsage` prices a
-- call as tokens × those rates, so the ledger was faithfully recording zero ×
-- 300k tokens. The vendor edit modal offered no pricing inputs either, so an
-- operator could not correct it from the UI — the number could only ever be 0.
--
-- WHAT THIS SEEDS
--
-- List prices in USD per 1k tokens (the vendors publish per 1M — divided by
-- 1000 here), for the exact model each row was seeded pointing at:
--
--   deepseek    deepseek-chat            $0.27 / $1.10  per 1M in/out
--   embeddings  text-embedding-3-small   $0.02          per 1M in
--   gemini      gemini-1.5-flash         $0.075 / $0.30 per 1M in/out
--   groq        whisper-large-v3         $0.111         per audio hour
--
-- These are a STARTING POINT, not a contract. Vendor list prices move, tiers
-- and cache discounts apply, and a tenant re-pointing a vendor row at a bigger
-- model must re-price it — which is why the same PR adds the three rate fields
-- to the vendor modal in AI Control → Vendors. Treat the numbers here the way
-- you treat a seeded tax rate: right on the day it shipped, the operator's to
-- maintain thereafter.
--
-- WHY THE `= 0` GUARD
--
-- Only rows still carrying all three zeros are touched — a row an operator has
-- already priced is left exactly as it is, on this run and on every re-run.
-- That is what makes the file idempotent AND safe to ship to tenants who have
-- already fixed their own pricing by hand.
--
-- Costs are per 1k tokens in `cost_native_currency` (USD on all four rows).
-- `governance.recordUsage` converts native → the tenant's base currency
-- through MOD-08's fx_rate_daily at write time; it does NOT assume 1:1.
-- ============================================================================

UPDATE ai_vendor_credential SET
  cost_per_1k_input_tokens  = 0.000270,
  cost_per_1k_output_tokens = 0.001100,
  cost_native_currency      = COALESCE(cost_native_currency, 'USD')
WHERE vendor = 'deepseek'
  AND cost_per_1k_input_tokens = 0
  AND cost_per_1k_output_tokens = 0
  AND cost_per_audio_minute = 0;

UPDATE ai_vendor_credential SET
  cost_per_1k_input_tokens  = 0.000020,
  cost_native_currency      = COALESCE(cost_native_currency, 'USD')
WHERE vendor = 'embeddings'
  AND cost_per_1k_input_tokens = 0
  AND cost_per_1k_output_tokens = 0
  AND cost_per_audio_minute = 0;

UPDATE ai_vendor_credential SET
  cost_per_1k_input_tokens  = 0.000075,
  cost_per_1k_output_tokens = 0.000300,
  cost_native_currency      = COALESCE(cost_native_currency, 'USD')
WHERE vendor = 'gemini'
  AND cost_per_1k_input_tokens = 0
  AND cost_per_1k_output_tokens = 0
  AND cost_per_audio_minute = 0;

-- Whisper bills by audio length, not tokens: $0.111/hour → /60 per minute.
UPDATE ai_vendor_credential SET
  cost_per_audio_minute = 0.001850,
  cost_native_currency  = COALESCE(cost_native_currency, 'USD')
WHERE vendor = 'groq'
  AND cost_per_1k_input_tokens = 0
  AND cost_per_1k_output_tokens = 0
  AND cost_per_audio_minute = 0;

COMMENT ON COLUMN ai_vendor_credential.cost_per_1k_input_tokens IS
  'List price per 1000 input tokens in cost_native_currency. Seeded in 12744 for the model each vendor row shipped pointing at; maintained by the operator in AI Control -> Vendors thereafter. governance.recordUsage converts native -> base currency via fx_rate_daily.';

-- DOWN
--   -- Restores the pre-12744 state (all-zero rates = "unpriced"). Only undo
--   -- this on a tenant that has NOT since hand-edited its rates; the guard
--   -- above cannot tell a seeded value from an operator's identical one.
--   UPDATE ai_vendor_credential SET cost_per_1k_input_tokens = 0, cost_per_1k_output_tokens = 0, cost_per_audio_minute = 0
--     WHERE vendor IN ('deepseek','embeddings','gemini','groq');
