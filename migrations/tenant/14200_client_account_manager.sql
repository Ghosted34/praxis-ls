-- ============================================================================
-- TENANT DB — 14200 A client's account manager: the person on the team who
-- looks after a client, and the first one their messages reach (client portal
-- redesign, PR 3).
--
-- Owner decision 2 of 12: a client's message reaches the ACCOUNT MANAGER and
-- the owners of the shipment it is about (its operations and sales owners);
-- when none of them can be reached, operations and whoever holds the Client
-- inbox permission (MOD-64C, seeds 90997/9136); and the MD always.
--
-- ── THE COLUMN ALREADY EXISTED, AND NOTHING COULD SET IT ────────────────────
--
-- `client_master.relationship_manager_user_id` arrived in 0511 with the rich
-- party master: a login, a foreign key to app_user, accepted by the shared
-- client schema and listed in party_field_config — and read by nothing and
-- writable from no screen. It is exactly the account manager. PR 3 gives it a
-- control (the employee picker, limited to people with a login — assignment
-- targets a login, as the picker's own header says), an endpoint that checks
-- the login is active and records who assigned whom, and a reader: the
-- routing of a client's message, and the Client inbox's "Mine".
--
-- A second table would have been a second answer to the same question, and
-- the one the client record's own field disagreed with.
--
-- So this migration adds only what the new reader needs: the index behind
-- "the clients I look after", and a comment that says what the column is for.
-- ============================================================================

CREATE INDEX IF NOT EXISTS ix_client_master_relationship_manager
  ON client_master (relationship_manager_user_id)
  WHERE relationship_manager_user_id IS NOT NULL;

COMMENT ON COLUMN client_master.relationship_manager_user_id IS
  'The client''s account manager (PR 3, 14200): the login a client''s portal message reaches first, with the owners of the shipment it is about. Set from the employee picker through PUT /clients/:id/account-manager, which requires an ACTIVE login.';

-- DOWN
-- Additive: an index and a comment.
--
--   DROP INDEX IF EXISTS ix_client_master_relationship_manager;
--   COMMENT ON COLUMN client_master.relationship_manager_user_id IS NULL;
