-- ============================================================================
-- TENANT DB — 13776 A retired mailbox must not hold its address hostage.
--
-- `email_connection` has carried `UNIQUE (email_address, provider)` since 0483,
-- when a connection was only ever a live transport and the only way to stop
-- using one was to leave it connected. Every mailbox rule written since is
-- scoped to LIVE rows — 10723's one-personal-per-user index, 10724's one
-- mailbox per catalogue slot — because 10723 made ARCHIVED a status rather than
-- a delete, precisely so a retired mailbox keeps its mail without keeping its
-- claims. This one constraint never got the same treatment, and it is the one
-- that decides whether an address can be used at all.
--
-- ── WHAT IT BREAKS ──────────────────────────────────────────────────────────
--
-- Retiring or disconnecting a mailbox does not free its address, so:
--
--   · `mail.service.disconnect` documents itself as the answer for "somebody
--     who mistyped an address into the wizard" and "somebody who has just
--     rotated a cPanel password". Both then retype the address and are refused.
--   · 10723's header states the intent outright — "a successor must be able to
--     connect their own mailbox at the same address without first destroying
--     the predecessor's" — and this constraint is what stops them.
--   · The refusal surfaces as the error handler's generic 23505 sentence, "A
--     record with these values already exists", which names neither the address
--     nor the retired mailbox holding it. There is no UI that lists archived
--     mailboxes by default and no action anywhere that releases the address, so
--     the dead end is total: the tenant cannot fix it from the product.
--
-- ── WHY A PARTIAL INDEX AND NOT A LOOSER RULE ───────────────────────────────
--
-- The rule itself is right — two LIVE connections to one address would double
-- every inbound message and leave `ensureDefaultConnection` picking between
-- them. What was wrong is the population it ranges over. Excluding ARCHIVED
-- makes it agree with every other uniqueness rule on this table, and keeps the
-- guarantee where it matters: at most one live connection per address.
--
-- Nothing does `ON CONFLICT (email_address, provider)`, so no upsert depends on
-- this being a named table constraint rather than an index.
-- ============================================================================

-- DESTRUCTIVE: drops UNIQUE (email_address, provider) from 0483, replaced on the
-- next statement by the same rule scoped to live rows. Strictly widens what is
-- accepted — no existing row can violate the replacement — so it cannot fail on
-- data and loses nothing. Named explicitly because the auto-generated
-- constraint name is the one Postgres assigns to that UNIQUE.
ALTER TABLE email_connection
  DROP CONSTRAINT IF EXISTS email_connection_email_address_provider_key;

CREATE UNIQUE INDEX IF NOT EXISTS ux_email_connection_address_live
  ON email_connection (email_address, provider)
  WHERE status <> 'ARCHIVED';

COMMENT ON INDEX ux_email_connection_address_live IS
  'At most one LIVE connection per address+provider. Archived mailboxes keep their mail but release the address, so it can be reconnected — see 10723 on why ARCHIVED is a status and not a delete.';

-- DOWN
--   DROP INDEX IF EXISTS ux_email_connection_address_live;
--   -- Restoring 0483's constraint can FAIL where the fix has been used: an
--   -- address reconnected after its predecessor was archived is exactly the
--   -- state the old constraint refuses. Archive or remove the duplicates first,
--   -- deciding by hand which connection is the live one.
--   ALTER TABLE email_connection
--     ADD CONSTRAINT email_connection_email_address_provider_key
--     UNIQUE (email_address, provider);
