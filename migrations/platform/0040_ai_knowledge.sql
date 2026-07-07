-- ============================================================================
-- PLATFORM DB — 0040 GLOBAL AI knowledge corpus (non-tenant, shared, read-only)
-- Holds the codebase, the platform schema cards, and the domain docs (OHADA KB,
-- PRD, RBAC). Tenant business data lives in each tenant DB's own ai_* tables
-- (migration tenant/0400). See doc/AI_KNOWLEDGE.md §1.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector (idempotent)

-- Where a piece of knowledge came from (for incremental re-index + provenance).
CREATE TABLE platform.ai_source (
  ai_source_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('codebase','platform_schema','doc','other')),
  ref              text NOT NULL,                    -- 'src/server.js' | 'doc/OHADA_KB.md' | 'platform.tenant'
  title            text,
  last_indexed_at  timestamptz,
  content_hash     text,                             -- skip re-index when unchanged
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref)
);

CREATE TABLE platform.ai_document (
  ai_document_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_source_id     uuid REFERENCES platform.ai_source(ai_source_id) ON DELETE CASCADE,
  kind             text NOT NULL,                    -- mirrors source kind
  ref              text NOT NULL,
  title            text,
  language         char(2),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_pai_document_source ON platform.ai_document(ai_source_id);

CREATE TABLE platform.ai_chunk (
  ai_chunk_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_document_id   uuid NOT NULL REFERENCES platform.ai_document(ai_document_id) ON DELETE CASCADE,
  chunk_no         integer NOT NULL,
  content          text NOT NULL,
  content_hash     text NOT NULL,                    -- idempotent re-embed
  embedding        vector(1536),
  token_count      integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ai_document_id, chunk_no)
);
CREATE INDEX ix_pai_chunk_doc ON platform.ai_chunk(ai_document_id);
CREATE INDEX ix_pai_chunk_hash ON platform.ai_chunk(content_hash);
CREATE INDEX ix_pai_chunk_embedding ON platform.ai_chunk
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
