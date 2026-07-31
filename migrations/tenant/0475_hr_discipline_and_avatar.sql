-- ============================================================================
-- TENANT DB — 0475 HR discipline (queries + sanctions) and user profile avatar.
--   • app_user.avatar_ref — self-service profile picture, stored as a /media URL.
--   • hr_query   — disciplinary queries / warning letters issued TO an employee,
--                  which the employee can respond to (self-service).
--   • hr_sanction— disciplinary outcomes (warning/suspension/…); may reference the
--                  query that triggered it.
-- Both are surfaced to the employee under "My HR" and managed by HR (MOD-91).
-- ============================================================================
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS avatar_ref text;

CREATE TABLE IF NOT EXISTS hr_query (
  hr_query_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  subject      text NOT NULL,
  body         text NOT NULL,
  severity     text NOT NULL DEFAULT 'WARNING' CHECK (severity IN ('INFO','WARNING','SERIOUS')),
  status       text NOT NULL DEFAULT 'OPEN'    CHECK (status IN ('OPEN','RESPONDED','CLOSED')),
  response     text,
  responded_at timestamptz,
  due_at       timestamptz,
  issued_by    uuid REFERENCES app_user(user_id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hr_query_employee ON hr_query (employee_id, status);

CREATE TABLE IF NOT EXISTS hr_sanction (
  hr_sanction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employee(employee_id) ON DELETE CASCADE,
  hr_query_id    uuid REFERENCES hr_query(hr_query_id) ON DELETE SET NULL,
  type           text NOT NULL CHECK (type IN ('WARNING','SUSPENSION','DEMOTION','FINE','DISMISSAL')),
  reason         text NOT NULL,
  amount_xaf     numeric(18,2),
  effective_date date NOT NULL DEFAULT current_date,
  end_date       date,
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LIFTED')),
  issued_by      uuid REFERENCES app_user(user_id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hr_sanction_employee ON hr_sanction (employee_id, status);

CREATE TRIGGER trg_hr_query_updated    BEFORE UPDATE ON hr_query    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_hr_sanction_updated BEFORE UPDATE ON hr_sanction FOR EACH ROW EXECUTE FUNCTION set_updated_at();
