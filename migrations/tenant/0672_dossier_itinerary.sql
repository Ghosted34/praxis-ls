-- 0672 — optional, service-type-driven dossier itinerary legs.
-- A dossier may have zero legs (legacy/non-movement) or a tailored sequence.
CREATE TABLE IF NOT EXISTS dossier_itinerary_leg (
  itinerary_leg_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id uuid NOT NULL REFERENCES dossier(dossier_id) ON DELETE CASCADE,
  seq numeric(10,4) NOT NULL,
  leg_type text NOT NULL CHECK (leg_type IN ('PICKUP','MAIN_CARRIAGE','CUSTOMS','INLAND_TRANSIT','WAREHOUSE','FINAL_DELIVERY','OTHER')),
  mode text NOT NULL DEFAULT 'OTHER' CHECK (mode IN ('AIR','SEA','LAND','OTHER')),
  origin text,
  destination text,
  origin_place_id uuid REFERENCES geo_place(geo_place_id),
  destination_place_id uuid REFERENCES geo_place(geo_place_id),
  planned_departure date,
  planned_arrival date,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','IN_PROGRESS','COMPLETED','BLOCKED','CANCELLED')),
  provider_id uuid REFERENCES rate_provider(rate_provider_id),
  notes text,
  is_optional boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dossier_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_itinerary_leg_dossier ON dossier_itinerary_leg (dossier_id, seq);

-- DOWN
-- DROP INDEX IF EXISTS ix_itinerary_leg_dossier;
-- DROP TABLE IF EXISTS dossier_itinerary_leg;
