-- F6: converted quote requests must reference a real opportunity.
-- Forward-only and idempotent; historical migrations remain immutable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_quote_request_converted_opportunity'
       AND conrelid = 'quote_request'::regclass
  ) THEN
    ALTER TABLE quote_request
      ADD CONSTRAINT fk_quote_request_converted_opportunity
      FOREIGN KEY (converted_opportunity_id)
      REFERENCES opportunity(opportunity_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_quote_request_converted_opportunity
  ON quote_request(converted_opportunity_id)
  WHERE converted_opportunity_id IS NOT NULL;
