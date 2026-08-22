-- ============================================================================
-- TENANT DB — 10785 The QES envelope: one provider document per certified
-- signature, with the lifecycle the provider owns.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §7.3, §7.4.
--
-- ── WHY THERE IS A TABLE AT ALL ────────────────────────────────────────────
-- The provider's document is a SECRET WE CANNOT RECOVER: SignWell does not
-- list "the document for party X" the way our own signing links do. If the
-- webhook is lost and the poll never runs, the counterparty signs on the
-- provider's platform and nothing on this side settles — the chain stalls
-- with no record that anything was sent. The envelope row is the local half
-- of the contract: what was sent, to whom, and where it has got to, so the
-- poll backstop (§7.4 step 6) and the void path (§7.4 step 7) have
-- something to key on.
--
-- ── THE STATUS IS THE PROVIDER'S, MIRRORED ─────────────────────────────────
-- CREATING is the only status this programme decides itself (we called the
-- provider and are waiting for its answer). Every other value is the
-- provider's own state, copied over by the webhook or the poll. There is no
-- status that means "we think it is signed": the document_signature row,
-- written on completion, is the signature. The envelope is the envelope.
--
-- Every pg_constraint lookup is scoped with `conrelid = '…'::regclass` — see
-- 10779's header for the bug that taught this programme why.
--
-- Idempotent. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qes_envelope (
  envelope_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid NOT NULL REFERENCES signature_request(request_id) ON DELETE CASCADE,
  -- The party this envelope settles. A request can carry SEVERAL certified
  -- parties (one override, Q7, plus the chain around it), so the envelope
  -- names the one: the webhook settles it by email match against THIS party,
  -- and the "one in-flight envelope per party" index below keys on it.
  party_id        uuid REFERENCES signature_party(party_id) ON DELETE SET NULL,
  -- Which adapter wrote this row, so a second provider (DocuSign, v2) can
  -- live beside the first without a column rename.
  provider_key    text NOT NULL,
  -- The provider's own document id. NULL until the create call answers.
  provider_ref    text,
  status          text NOT NULL DEFAULT 'CREATING'
                   CHECK (status IN ('CREATING','SENT','COMPLETED','DECLINED','CANCELLED','FAILED')),
  -- The mirrored evidence, vaulted on completion (§7.4). A LINK to the
  -- provider's dashboard is worthless in year seven when the contract has
  -- lapsed; bytes in our vault are not.
  audit_vault_id  uuid REFERENCES document_vault(doc_id),
  signed_vault_id uuid REFERENCES document_vault(doc_id),
  -- What went wrong, in one line the operator can act on. Terminal-state
  -- bookkeeping, not a log: the trail of events is in immutable_ledger.
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One provider document is one envelope. The WHERE clause keeps CREATING rows
-- (no ref yet) out of the index rather than forcing a sentinel value.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qes_provider_ref
  ON qes_envelope(provider_key, provider_ref)
  WHERE provider_ref IS NOT NULL;

-- One IN-FLIGHT envelope per party, enforced by the database for the same
-- reason uq_sigparty_one_override exists: the validator gives the friendly
-- 409, and this is what stays true if a future path forgets to ask. A party
-- whose previous envelope has reached a terminal state (completed, declined,
-- cancelled, failed) may be re-sent — the WHERE clause is the difference
-- between "not double-sent" and "sent exactly once, ever".
CREATE UNIQUE INDEX IF NOT EXISTS uq_qes_active_party
  ON qes_envelope(party_id)
  WHERE party_id IS NOT NULL AND status IN ('CREATING','SENT');

CREATE INDEX IF NOT EXISTS ix_qes_request ON qes_envelope(request_id);
CREATE INDEX IF NOT EXISTS ix_qes_party ON qes_envelope(party_id) WHERE party_id IS NOT NULL;

-- The poll backstop's working set: non-terminal, and old enough to be worth
-- asking the provider about. Partial, so it is empty for a tenant that has
-- never certified anything — which is every tenant until one does.
CREATE INDEX IF NOT EXISTS ix_qes_open ON qes_envelope(status, created_at)
  WHERE status IN ('CREATING','SENT');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_qes_updated' AND tgrelid = 'qes_envelope'::regclass) THEN
    CREATE TRIGGER trg_qes_updated
      BEFORE UPDATE ON qes_envelope
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE qes_envelope IS
  'One provider document per certified signature (doc/SIGNATURE_ENGINEERING_GUIDE.md §7.3). The status is the provider''s state, mirrored; the document_signature row is the signature.';
COMMENT ON COLUMN qes_envelope.provider_ref IS
  'The provider''s document id. NULL until the create call answers; the ledger row that charges this envelope cannot exist without it (10786).';

-- ============================================================================
-- VERIFY
--   SELECT count(*) FROM qes_envelope;                              -- expect 0
--   SELECT indexname FROM pg_indexes WHERE tablename = 'qes_envelope'
--     ORDER BY indexname;   -- expect 5 (pk, provider ref, active party, request, open)
--
-- DOWN
--   -- DESTRUCTIVE: dropping the table drops the local half of every in-flight
--   -- certified signature. The provider's copies keep existing — a webhook
--   -- arriving after this runs is a 404, and the chain settles by hand.
--   DROP TRIGGER IF EXISTS trg_qes_updated ON qes_envelope;
--   DROP TABLE IF EXISTS qes_envelope;
-- ============================================================================
