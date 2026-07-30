-- Platform catalogue entry for the HR Discipline module (queries + sanctions).
-- Idempotent so it can re-run; makes MOD-71 appear in the permission grant matrix
-- so HR managers can be granted it (the CEO bypasses grants entirely).
INSERT INTO platform.module_catalogue (module_key, group_key, name, sort_order, is_core) VALUES
 ('MOD-71','hr','HR Discipline (Queries & Sanctions)',28,false)
ON CONFLICT (module_key) DO NOTHING;
