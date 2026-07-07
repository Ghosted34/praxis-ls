-- ============================================================================
-- SEED (per tenant schema) — whitelisted AI action catalogue. These are the
-- typed functions the assistant may PROPOSE; each maps to an executor in
-- src/services/ai/action-registry.js. ai_enabled=true → offered to the model.
-- ============================================================================
INSERT INTO ai_action_catalogue
 (action_key, title, method, route, description, module_key, is_write, payload_schema, required_permission, ai_enabled, requires_confirmation)
VALUES
 ('create_client','Create a client','POST','/api/tenant/clients',
  'Register a new client (customer). Requires a name.','MOD-03',true,
  '{"type":"object","required":["name"],"properties":{"name":{"type":"string"},"niu":{"type":"string"},"rccm":{"type":"string"},"payment_terms_days":{"type":"integer"}}}',
  'master.create',true,true),
 ('create_operations_file','Open an operation file','POST','/api/tenant/operations',
  'Open a new operations file (dossier) for a shipment.','MOD-29',true,
  '{"type":"object","properties":{"client_id":{"type":"string"},"incoterm":{"type":"string"},"pol":{"type":"string"},"pod":{"type":"string"},"bl_mawb":{"type":"string"}}}',
  'operations.create',true,true)
ON CONFLICT (action_key) DO UPDATE SET ai_enabled=EXCLUDED.ai_enabled, payload_schema=EXCLUDED.payload_schema;
