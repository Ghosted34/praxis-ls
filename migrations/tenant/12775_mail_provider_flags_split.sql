-- ============================================================================
-- 12775 — split the OAuth mailbox flag per provider
--
-- `mail.provider.oauth` (10730) gates Microsoft 365 and Google Workspace as one
-- switch. That was right while both were out of scope together, and is wrong now
-- that they are ready at different times.
--
-- Microsoft is ready and needed: Exchange Online removed Basic auth for IMAP and
-- POP in 2022 and retired it for SMTP AUTH on 30 April 2026, so OAuth is the ONLY
-- way a Microsoft 365 tenant can connect a mailbox at all. Google is not ready on
-- the same clock — its restricted mail scopes need a security assessment that
-- runs for weeks. Coupling them delays Microsoft for no benefit.
--
-- Both new keys seed `off`. The umbrella key stays and still works: the service
-- enables a provider when EITHER its own key or `mail.provider.oauth` is on, so
-- nothing that is switched on today changes behaviour, and the console can turn
-- Microsoft on by itself.
--
-- Reversible: dropping the two rows restores the single-switch behaviour exactly.
-- ============================================================================

INSERT INTO feature_state (feature_key, state, source) VALUES
  ('mail.provider.microsoft', 'off', 'default'),
  ('mail.provider.google',    'off', 'default')
ON CONFLICT (feature_key) DO NOTHING;

-- DOWN
--
-- Both rows are additive, so the undo is a delete and the umbrella key takes
-- over again exactly as it did before this ran — assertProviderEnabled accepts
-- EITHER the per-provider flag or `mail.provider.oauth`, so removing these
-- leaves the single-switch behaviour intact rather than locking anyone out.
--
-- Worth knowing at 3am: if a tenant had switched Microsoft on through the new
-- key alone, this turns their mailbox connections off until the umbrella key is
-- set. Check `feature_state` before running it.
--
-- DELETE FROM feature_state
--  WHERE feature_key IN ('mail.provider.microsoft', 'mail.provider.google');
