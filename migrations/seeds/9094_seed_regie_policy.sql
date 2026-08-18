-- ============================================================================
-- SEED (per tenant schema) — régie d'avance accounts, journals and policy
-- switches (MOD-49, KB §6.8), plus the write-off expense account the KB names
-- and the chart of accounts does not have.
--
-- NUMBERED 90xx DELIBERATELY. `migrator.files` partitions this directory by
-- prefix: tenantSeeds /^90/, platformSeeds /^91/. This writes to `setting` and
-- `chart_of_accounts`, both TENANT tables; as 91xx it would fail outright
-- against the platform DB. Ordered after 9000/9001 so the CoA parents exist.
--
--
-- ── PART 1. THE WRITE-OFF ACCOUNT DOES NOT EXIST ────────────────────────────
--
-- KB §6.8 step 5: "hold as a query — write off to 658 or recover from the
-- holder". `grep -rn "658" migrations/` returns ONE hit, and it is a longitude
-- in the geo catalogue (0675:75). Neither 658 nor its 2-digit heading 65 is
-- seeded by 9000 or 9001.
--
-- `journal_line.account_code` is `REFERENCES chart_of_accounts(code)` (0220:56)
-- and `assert_line_valid()` (0640:142) additionally RAISEs unless the account
-- `is_postable`. So a write-off posting to 658 would have failed twice over:
-- once on the FK, once on the trigger. The plan's Landing A could not have run
-- as written, and no test would have caught it because nothing posts to 658
-- today.
--
-- Added here rather than in 9001 because 9001 has already been applied by every
-- provisioned tenant; `schema_migration` records it by sha256 (migrator.js:151),
-- so editing it in place would be flagged by check-schema-drift as content
-- drift and would never re-run. A new file is the only additive route.
--
-- SYSCOHADA: class 6 heading 65 is "Autres charges" — sundry operating charges
-- — and 658 its "charges diverses" leaf. That is the correct home for an
-- unrecoverable advance: it is an operating loss of the period, not a financial
-- charge (67) and not a personnel cost (66).
--
--
-- ── PART 2. THE DEFAULT TREASURY ACCOUNT IS NOT POSTABLE ────────────────────
--
-- Every service in the costing set defaults its treasury leg to '521':
--
--   regie.service.js:22        treasuryCoa = "521"
--   cash_request.service.js:128 treasuryCoa = "521"
--   cost_tracking.service.js:19 treasuryCoa = "521"
--
-- 9000:77 seeds ('521','52','Banques locales',…,is_postable=FALSE) — it is a
-- 3-digit GROUPING, and the postable leaf beneath it is 5211 "Banque
-- principale" (9000:126). 9001:38 re-lists 521 but is `ON CONFLICT DO NOTHING`
-- and runs second, so 9000's row is the one that survives.
--
-- Therefore `assert_line_valid` raises 'account 521 is not postable (KB §23.3)'
-- on ANY régie issue that does not override the default — which the controller
-- never does (regie.controller.js:12-19 passes no treasury_coa). Régie issuance
-- is broken today for that reason alone, independently of the missing
-- retirement path.
--
-- The default below is therefore '5211', the postable leaf, NOT '521'. The JS
-- literals in the services are left as-is by this seed; the régie service now
-- reads these settings first, so the literal is unreachable for régie. The two
-- other services still carry the broken default and are flagged in the plan
-- (Landing C) rather than changed here, because touching cash_request and
-- cost_tracking postings is outside Landing A.
--
-- 571 by contrast IS postable (9000:79, is_postable=true) so CASH_RETURN needs
-- no substitution. 581, 4211 and 4731 are all postable and correct.
--
-- ON CONFLICT DO NOTHING throughout — a tenant that has already tuned its
-- accounts keeps them, matching 9050 and 9093.
-- ============================================================================

-- ── 1. The 65 heading and the 658 leaf ──────────────────────────────────────
INSERT INTO chart_of_accounts (code,parent_code,label_fr,label_en,class,normal_balance,is_postable,requires_analytic) VALUES
  ('65',NULL,'Autres charges','Other operating charges',6,'D',false,false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO chart_of_accounts (code,parent_code,label_fr,label_en,class,normal_balance,is_postable,requires_analytic) VALUES
  ('658','65','Charges diverses','Sundry charges',6,'D',true,false)
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE chart_of_accounts IS
  'SYSCOHADA working plan. Seeded by 9000/9001; 9070 adds 5711, 9080 adds 27/275 and 60xx leaves, 9094 adds 65/658 (régie write-off).';

-- ── 2. Régie accounts, journals and policy ──────────────────────────────────
--
-- Extends the SAME ('finance','regie') key 9050:19 already seeds with
-- {"policy_window_days":7}. `setting` is UNIQUE(section,key) so this cannot
-- insert a second row; on an existing tenant the INSERT is skipped and the
-- UPDATE below fills in only the keys that are absent.
INSERT INTO setting (section, key, value) VALUES
 ('finance', 'regie', '{
    "policy_window_days": 7,
    "accounts": {
      "regie":             "581",
      "treasury":          "5211",
      "cash":              "571",
      "holder_receivable": "4211",
      "dossier_mandant":   "4731",
      "write_off":         "658"
    },
    "journals": { "issue": "BQ", "retire": "OD", "age": "OD" },
    "require_proof_for_receipt": true,
    "allow_partial_justification": false,
    "warn_before_window_days": 2
  }'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- A tenant provisioned before this file has the 9050 row: {"policy_window_days":7}
-- and nothing else. `||` merges right-over-left, so writing (new || existing)
-- adds every missing key while leaving ANY value the tenant already set —
-- including policy_window_days — exactly as it was. Re-running is a no-op.
UPDATE setting
   SET value = '{
    "accounts": {
      "regie":             "581",
      "treasury":          "5211",
      "cash":              "571",
      "holder_receivable": "4211",
      "dossier_mandant":   "4731",
      "write_off":         "658"
    },
    "journals": { "issue": "BQ", "retire": "OD", "age": "OD" },
    "require_proof_for_receipt": true,
    "allow_partial_justification": false,
    "warn_before_window_days": 2
  }'::jsonb || value
 WHERE section = 'finance' AND key = 'regie'
   AND NOT (value ? 'accounts');

-- ── 3. Régie as a first-class approvable event ──────────────────────────────
--
-- `regie.events.js:3` emits 'regie.issued', and `grep -rn "'regie.issued'"
-- migrations/` returns NOTHING — it was never a seeded event_type. event_log
-- keys are free-form citext so the emit succeeds silently, but `workflow` binds
-- to `event_type_id` (0120:22), so an event type that does not exist CANNOT
-- carry an approval chain. Régie was structurally unroutable: a 50,000 XAF
-- advance and a 50,000,000 XAF advance took the identical path, gated only by a
-- flat requirePermission('MOD-49','create').
--
-- Seeding these makes `executor.start` able to find a workflow for them. It does
-- NOT itself create one — see the note on 0469 below — so behaviour is unchanged
-- until a tenant binds a chain, which is the point: the capability becomes
-- configurable rather than mandatory.
--
-- is_approvable:
--   regie.issued     true  — the advance a tenant may want a second signature on
--   regie.write_off  true  — writing money off to 658 is the highest-stakes act
--                            in the module and the one most worth a threshold
--   regie.retired    false — recording a receipt against money already issued is
--                            bookkeeping, not a decision; gating it would stall
--                            the very justification the module exists to collect
--   regie.queried    false — raising a query is a flag, not an approval
INSERT INTO event_type (key, module_key, name, description, is_security_critical, is_approvable) VALUES
 ('regie.issued',    'MOD-49', 'Régie advance issued',      'Cash advance issued to a holder (Dr 581 / Cr treasury). KB §6.8 step 1.', false, true),
 ('regie.retired',   'MOD-49', 'Régie advance retired',     'Receipt or cash return recorded against an advance. KB §6.8 steps 2-3.',  false, false),
 ('regie.queried',   'MOD-49', 'Régie advance queried',     'Advance held as a query pending justification. KB §6.8 step 5.',          false, false),
 ('regie.write_off', 'MOD-49', 'Régie advance written off', 'Unrecoverable advance written off to sundry charges. KB §6.8 step 5.',    false, true),
 ('regie.unaged',    'MOD-49', 'Régie aging reversed',      'Aging reclassification reversed after late justification.',               false, false)
ON CONFLICT (key) DO NOTHING;

-- DELIBERATELY NOT SEEDING A DEFAULT WORKFLOW.
--
-- 0469_default_workflows.sql binds a single-step APPROVE chain to six events. It
-- would be easy to add régie to that list and it is the wrong default: a régie
-- advance is petty operational cash drawn several times a week, and making every
-- one wait on an approver would make the common case slower than it is today for
-- no correctness gain — the money has already left the bank when the advance is
-- recorded. `executor.start` returns { autoApproved: true, reason: "no_workflow" }
-- and LOGS it (executor.js:110-115), so the absence is visible rather than
-- silent, and a tenant that wants a 5M-XAF threshold adds one workflow row with
-- min_amount_xaf set. Configurable, not mandatory.

-- DOWN
-- Reference/config seed. Removing the settings keys reverts the régie service to
-- its JS fallbacks — which post to a NON-POSTABLE 521 and a NON-EXISTENT 658,
-- i.e. back to broken. Dropping 658 orphans any write-off already posted to it
-- (the journal_line FK will refuse while rows exist, which is the correct
-- outcome).
--
--   DELETE FROM event_type WHERE key IN ('regie.issued','regie.retired','regie.queried','regie.write_off','regie.unaged');
--   -- 658 / 65: only if no journal_line references them.
--   DELETE FROM chart_of_accounts WHERE code = '658';
--   DELETE FROM chart_of_accounts WHERE code = '65';
