# doc/reference

Read-only reference material. Nothing here is built, deployed, imported or executed.

- `legacy_codebase/` — the PHP system Praxis LS replaces, kept so behaviour
  questions ("what did the old invoice numbering actually do?") can be answered
  from source rather than memory.
- `reference-mock-lovable/` — the original Lovable UI mock the design language
  came from.

---

## Credentials were removed from this tree on 2026-08-04

Audit finding **SEC-C1** (`doc/SECURITY_AUDIT_2026-08-04.md`). This directory was
excluded from the CI secret scan (`':!doc/reference'` in `.github/workflows/ci.yaml`),
so it accumulated real credentials for months with the scanner reporting clean on
every run. The exclusion is gone.

**Removed — three files deleted outright**, because the file existed only to hold
credentials:

- `legacy_codebase/administration/config/db.php`
- `legacy_codebase/public_html/config/db.php`
- `legacy_codebase/public_html/smart-logistics/administration/config/db.php`

**Redacted in place** — the credential was embedded in code worth keeping, so the
value was replaced with `__REMOVED_ROTATE_ME__` and the surrounding logic left intact:

| File | What was there |
|---|---|
| `legacy_codebase/administration/index.php` | inline MySQL host / database / user |
| `legacy_codebase/administration/view/admin/test_smtp_mail.php` | Office 365 SMTP username + password |
| `legacy_codebase/administration/api/praxis/command_engine.php` | Google Gemini API key |
| `legacy_codebase/administration/api/smart_quote_api.php` | Google Gemini API key |
| `legacy_codebase/administration/api/success_story_api.php` | Google Gemini API key ×2 |
| `legacy_codebase/public_html/test_gemini.php` | Google Gemini API key |

### Still outstanding — this is not finished

1. **Rotate every one of them at the provider.** Removing a secret from the working
   tree does not make it secret again. Until the MySQL user's password, the Office 365
   mailbox password and the Gemini keys are rotated, they are live.
2. **The values remain in git history.** Anyone with a clone still has them. A history
   purge (`git filter-repo`) rewrites every commit SHA and invalidates every existing
   clone and open PR, so it is a coordinated team decision rather than a quiet change —
   deliberately not done here. **Rotation makes the history harmless; the purge is
   hygiene, not the fix.** Track it as a follow-up.

### Note on how these were found

The audit cited one file. There were five, plus five Gemini API keys the audit did not
list — and those keys matched the scanner's *existing* `AIza…` pattern the whole time.
They were invisible purely because of the path exclusion. The database and SMTP
credentials matched no pattern at all, so un-excluding the directory alone would still
have passed them clean; the pattern set was widened in the same commit.

Two independent failures, both required. That is worth remembering the next time a
scanner reports clean.
