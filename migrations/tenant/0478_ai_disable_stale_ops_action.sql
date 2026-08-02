-- ============================================================================
-- Fix the stale AI action seed. Early seed 9040 inserted `create_operations_file`
-- into ai_action_catalogue, but the vetted executor (action-registry.js) and the
-- manifest both key this capability as `open_dossier`. So `create_operations_file`
-- was advertised to the model with NO executor behind it — confirming it errored
-- with "no executor registered". The manifest sync now provides `open_dossier`,
-- so disable the orphan row on tenants that were provisioned before this fix.
-- (Disable, not delete, to preserve any ai_action_run history that references it.)
-- ============================================================================
UPDATE ai_action_catalogue
   SET ai_enabled = false
 WHERE action_key = 'create_operations_file';
