-- 0694 Sales CRM F11/F12 — structured case studies and public portfolio.
ALTER TABLE success_story ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE success_story ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES client_master(client_id);
ALTER TABLE success_story ADD COLUMN IF NOT EXISTS service_category text;
ALTER TABLE success_story ADD COLUMN IF NOT EXISTS headline text;
ALTER TABLE success_story ADD COLUMN IF NOT EXISTS executive_summary text;
ALTER TABLE success_story ADD COLUMN IF NOT EXISTS operations_execution text;
ALTER TABLE success_story ADD COLUMN IF NOT EXISTS kpis jsonb NOT NULL DEFAULT '[]';
ALTER TABLE success_story ADD COLUMN IF NOT EXISTS cover_vault_id uuid REFERENCES document_vault(doc_id);
ALTER TABLE success_story ADD COLUMN IF NOT EXISTS client_logo_vault_id uuid REFERENCES document_vault(doc_id);
ALTER TABLE success_story ADD COLUMN IF NOT EXISTS gallery_vault_ids uuid[] NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS ux_success_story_slug ON success_story(slug) WHERE slug IS NOT NULL;
CREATE TABLE IF NOT EXISTS success_story_dossier (
  success_story_id uuid NOT NULL REFERENCES success_story(success_story_id) ON DELETE CASCADE,
  dossier_id uuid NOT NULL REFERENCES dossier(dossier_id),
  PRIMARY KEY(success_story_id,dossier_id)
);
INSERT INTO success_story_dossier(success_story_id,dossier_id) SELECT success_story_id,dossier_id FROM success_story WHERE dossier_id IS NOT NULL ON CONFLICT DO NOTHING;
-- DOWN (export stories and media references first)
-- DROP TABLE IF EXISTS success_story_dossier;
-- DROP INDEX IF EXISTS ux_success_story_slug;
