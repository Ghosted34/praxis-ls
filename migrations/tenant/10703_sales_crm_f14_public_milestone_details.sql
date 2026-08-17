-- F14: dedicated client-safe tracking copy. Internal cause notes, health and
-- operational attribution are never repurposed as public prose.
ALTER TABLE milestone_instance
  ADD COLUMN IF NOT EXISTS public_location text,
  ADD COLUMN IF NOT EXISTS public_stage_reference text,
  ADD COLUMN IF NOT EXISTS public_progress_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_milestone_public_location_length'
       AND conrelid = 'milestone_instance'::regclass
  ) THEN
    ALTER TABLE milestone_instance ADD CONSTRAINT ck_milestone_public_location_length
      CHECK (public_location IS NULL OR char_length(public_location) <= 200);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_milestone_public_stage_reference_length'
       AND conrelid = 'milestone_instance'::regclass
  ) THEN
    ALTER TABLE milestone_instance ADD CONSTRAINT ck_milestone_public_stage_reference_length
      CHECK (public_stage_reference IS NULL OR char_length(public_stage_reference) <= 120);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_milestone_public_progress_note_length'
       AND conrelid = 'milestone_instance'::regclass
  ) THEN
    ALTER TABLE milestone_instance ADD CONSTRAINT ck_milestone_public_progress_note_length
      CHECK (public_progress_note IS NULL OR char_length(public_progress_note) <= 1000);
  END IF;
END $$;
