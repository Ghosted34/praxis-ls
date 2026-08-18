-- ============================================================================
-- SEED (per tenant schema) — the default GL accounts the posting services fall
-- back to, and a correction to one chart_of_accounts flag.
--
-- NUMBERED 90xx DELIBERATELY. migrator.files partitions this directory by
-- prefix: tenantSeeds /^90/, platformSeeds /^91/. This writes to `setting` and
-- `chart_of_accounts`, both TENANT tables. Ordered after 9000/9001 so the rows
-- it corrects already exist.
--
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- Seven posting call sites carried a hardcoded default account, and TWO of
-- those accounts are not postable:
--
--   treasuryCoa = "521"   cash_request.service.js:128
--                         cost_tracking.service.js:19
--                         regie.service.js (fixed in 9094)
--                         debt.service.js:32,50 + debt.rules.js:8,17
--                         proforma.service.js:19
--                         smart_receivables.service.js:21,42
--   interestCoa = "671"   debt.service.js:50 + debt.rules.js:17
--
-- `journal_line.account_code` is REFERENCES chart_of_accounts(code) (0220:56)
-- and assert_line_valid() (0640:150) RAISES unless the account is_postable. So
-- each of these failed at posting time — the moment money moved — with
-- 'account 521 is not postable (KB §23.3)'.
--
-- They were reachable because every caller's validator makes the override
-- optional (`treasury_coa: z.string().optional()`), and an omitted JSON field
-- arrives as `undefined`, which is precisely what activates a JS default
-- parameter. The broken value therefore applied in the NORMAL case, not an edge
-- case.
--
--
-- ── TWO BUGS, TWO DIFFERENT FIXES ───────────────────────────────────────────
--
-- 521 — the FLAG IS RIGHT, the DEFAULT IS WRONG.
--   9000:77 seeds ('521','52','Banques locales',…,is_postable=false). It is a
--   3-digit grouping and it genuinely has children: 5211 "Banque principale"
--   (9000:126) and 5212 "Banque — compte devises" (9001:90). Marking it postable
--   would break the leaf-only invariant that chart_of_accounts.service.js:40
--   enforces for user-created accounts ("an account with children cannot be
--   postable"). So 521 stays non-postable and the DEFAULT moves to 5211, below.
--
-- 671 — the FLAG IS WRONG.
--   9001 seeds ('671','67','Intérêts des emprunts',…,is_postable=false), but
--   671 has NO children — grep for a row whose parent_code is '671' returns
--   nothing. Its sibling 676 "Pertes de change" IS postable. A childless leaf
--   that nothing can post to is unusable, and loan interest has nowhere else to
--   go, so the flag is corrected here rather than redirecting callers elsewhere.
--
--   Guarded on "still has no children" so that if a tenant later adds 6711/6712
--   sub-accounts, re-running this cannot resurrect a non-leaf as postable.
--
--
-- ── WHY A SETTINGS MAP AND NOT A CORRECTED CONSTANT ─────────────────────────
--
-- Replacing "521" with "5211" in seven files would fix today's failure and
-- reproduce the underlying mistake: it assumes every tenant numbers its chart
-- like the seed. ('finance','accounts') lets a tenant with two banks, or a
-- renumbered plan, say so without a code change — the same rule 9093/9094 apply
-- to the commercial tariff and the régie accounts.
--
-- ON CONFLICT DO NOTHING — a tenant that has already tuned these keeps them.
-- ============================================================================

-- ── 1. Correct the 671 postable flag ────────────────────────────────────────
-- Only if it is still a childless leaf. NOT EXISTS keeps this idempotent AND
-- safe against a tenant that has since created sub-accounts under it.
UPDATE chart_of_accounts
   SET is_postable = true
 WHERE code = '671'
   AND is_postable = false
   AND NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.parent_code = '671');

-- ── 2. The default account map ──────────────────────────────────────────────
--
-- Read by shared/config/finance-accounts.js. Every value here is a POSTABLE
-- leaf — that is the invariant this file exists to restore, so a future edit
-- must re-check it:
--
--   SELECT code, is_postable FROM chart_of_accounts WHERE code IN (...);
--
-- 4731 additionally carries requires_analytic (9001:113), so any line posted to
-- it needs a dossier_id or assert_line_valid rejects the row.
INSERT INTO setting (section, key, value) VALUES
 ('finance', 'accounts', '{
    "treasury":         "5211",
    "cash":             "571",
    "disbursement":     "4731",
    "customer":         "4111",
    "customer_advance": "4191",
    "supplier":         "4011",
    "loan":             "162",
    "loan_interest":    "671",
    "fx_loss":          "676"
  }'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- A tenant provisioned before this file has no 'accounts' key at all, so the
-- INSERT above covers it. This UPDATE is for the reverse case: the key exists
-- (someone created it from the Settings UI) but predates a role added later.
-- `<new> || value` merges right-over-left, so every value the tenant set wins
-- and only genuinely missing roles are filled in.
UPDATE setting
   SET value = '{
    "treasury":         "5211",
    "cash":             "571",
    "disbursement":     "4731",
    "customer":         "4111",
    "customer_advance": "4191",
    "supplier":         "4011",
    "loan":             "162",
    "loan_interest":    "671",
    "fx_loss":          "676"
  }'::jsonb || value
 WHERE section = 'finance' AND key = 'accounts'
   AND NOT (value ? 'treasury');

-- DOWN
-- Reverting the settings row returns the services to their JS fallbacks, which
-- are themselves now correct (5211, not 521), so postings keep working.
-- Reverting the 671 flag re-breaks loan-interest posting and is not advised.
--
--   DELETE FROM setting WHERE section = 'finance' AND key = 'accounts';
--   -- Re-breaks debt.repay:
--   -- UPDATE chart_of_accounts SET is_postable = false WHERE code = '671';
