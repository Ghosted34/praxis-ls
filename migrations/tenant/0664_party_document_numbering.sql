-- ============================================================================
-- TENANT DB — 0664 system numbers for client/supplier KYC documents.
--
-- A client or supplier may receive compliance documents before it is linked to
-- one of the tenant's corporate entities. The existing `doc_sequence` is
-- deliberately keyed by entity_id and therefore cannot allocate a number for
-- that valid onboarding state. Keep the fallback counter tenant-local and
-- separate from statutory/entity document sequences; the numbering service
-- still reads the tenant's configurable scheme for MOD-03-DOC / MOD-04-DOC.
--
-- One sequence per party kind and year gives clients and suppliers independent,
-- concurrency-safe number streams. Existing document_number values are left
-- untouched; only newly-added rows use this counter.
-- ============================================================================

CREATE TABLE IF NOT EXISTS party_document_sequence (
  party_kind  citext NOT NULL CHECK (party_kind IN ('client', 'supplier')),
  year        smallint NOT NULL,
  seq         integer NOT NULL DEFAULT 0 CHECK (seq >= 0),
  PRIMARY KEY (party_kind, year)
);

COMMENT ON TABLE party_document_sequence IS
  'System-generated numbering fallback for client/supplier KYC documents without an entity link.';

-- DOWN
-- DROP TABLE IF EXISTS party_document_sequence;
--
-- Destructive only to future numbering state. Existing client_document and
-- supplier_document rows retain their already-issued document_number values;
-- after a rollback, a tenant must restore this migration before adding another
-- paper/digital KYC document without an entity link.
-- ============================================================================
