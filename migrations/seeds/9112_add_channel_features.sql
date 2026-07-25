-- ============================================================================
-- 9112 — Add WhatsApp / Instagram to the PLATFORM feature catalogue so the
-- platform console can gate them (Level-1 entitlement). Previously these two
-- existed only as tenant-side ai_feature_flag rows (0450), which the console had
-- no way to control — so toggling them from the console never reached the tenant
-- screen. Bringing them into feature_catalogue makes them first-class,
-- console-gated features like every other module. MOD-64 = Smart Comms.
--
-- After applying this seed, re-project features for existing tenants
-- (platform console → Tenant → Migrate, or provisioning.projectFeatures(slug))
-- so their feature_state gains the whatsapp/instagram rows.
-- ============================================================================

INSERT INTO platform.feature_catalogue (feature_key, module_key, name, default_state, depends_on) VALUES
 ('whatsapp',  'MOD-64', 'WhatsApp channel',  'off', '{comms}'),
 ('instagram', 'MOD-64', 'Instagram channel', 'off', '{comms}')
ON CONFLICT (feature_key) DO UPDATE SET
  module_key    = EXCLUDED.module_key,
  name          = EXCLUDED.name,
  default_state = EXCLUDED.default_state,
  depends_on    = EXCLUDED.depends_on;

-- Include the two channels in Full + Enterprise plans (Starter stays without).
-- The 9110 SELECT-from-catalogue plan_feature inserts already ran once, so these
-- two rows must be added explicitly here.
INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT p.plan_id, f.feature_key, true
  FROM platform.plan p
  CROSS JOIN (VALUES ('whatsapp'), ('instagram')) AS f(feature_key)
 WHERE p.code IN ('full', 'enterprise')
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;
