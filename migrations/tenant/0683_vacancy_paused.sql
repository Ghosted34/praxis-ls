-- ============================================================================
-- TENANT DB — 0683 a vacancy can be paused without losing its link
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- The lifecycle was DRAFT → OPEN → CLOSED, and "stop taking applications for a
-- fortnight" fitted none of them. CLOSED is an ending — it is the `approve`
-- gated transition, and reopening a closed role reads as a new decision.
-- Unpublishing was the only other lever, and it is worse than it looks: the
-- careers link is a token, and re-publishing MINTS A NEW ONE. Every candidate
-- holding the old URL, every job board that scraped it and every WhatsApp
-- forward of it stops working, permanently, because somebody paused for a week.
--
-- PAUSED is the state that was missing: applications stop, the role keeps its
-- token, and resuming restores the SAME public link.
--
-- ── WHY NOTHING PUBLIC NEEDS CHANGING ──────────────────────────────────────
--
-- The two public reads are already `WHERE status = 'OPEN' AND public_token IS
-- NOT NULL` (vacancy.repo). A paused role therefore drops off `/careers` and
-- its own page 404s the moment this lands — the same 404 a closed or unknown
-- token gets, which is deliberate: careers.service says nothing about WHY it
-- said no, so nobody can enumerate which roles exist or when they close.
--
-- ── THE CONSTRAINT, NOT AN ENUM ────────────────────────────────────────────
--
-- `status` has always been text + CHECK here (0360), and this widens that check
-- rather than converting the column: a type change would need every dependent
-- view and every tenant rewritten, to buy nothing this table needs.
-- ============================================================================

-- Dropped and re-added rather than edited, because a CHECK cannot be widened in
-- place. Guarded so the file survives a replay: provision-tenant reruns the set,
-- CI applies it twice on purpose, and a file that fails part way runs again in
-- full after the fix.
ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS vacancy_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vacancy_status_check') THEN
    ALTER TABLE vacancy ADD CONSTRAINT vacancy_status_check
      CHECK (status IN ('DRAFT', 'OPEN', 'PAUSED', 'CLOSED'));
  END IF;
END $$;

COMMENT ON COLUMN vacancy.status IS
  'DRAFT (being written, invisible to candidates) → OPEN (accepting applications; public when public_token is set) → PAUSED (temporarily not accepting, KEEPS its token so resuming restores the same careers link) → CLOSED (ended). Public reads require OPEN.';

-- DOWN
-- UPDATE vacancy SET status = 'CLOSED' WHERE status = 'PAUSED';
-- ALTER TABLE vacancy DROP CONSTRAINT IF EXISTS vacancy_status_check;
-- ALTER TABLE vacancy ADD CONSTRAINT vacancy_status_check
--   CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED'));
--
-- The undo has to decide what a paused role becomes, and CLOSED is the only
-- honest answer: reverting to OPEN would put roles back on the public careers
-- page that somebody deliberately took down. Rolling back therefore ENDS every
-- paused vacancy, and re-pausing them afterwards is manual.
