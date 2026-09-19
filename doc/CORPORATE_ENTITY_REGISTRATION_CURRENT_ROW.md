# Corporate entity registration current-row rule

**Status:** normative follow-up contract for `entity_registration` consumers

**Scope:** statutory registrations only; `entity_tax_registration` uses its own `is_active` / `deregistered_on` state.

A registration array is history, not an ordered lifecycle. No consumer may treat the first or last row as current.

For each `(entity, country, registration kind)`:

1. A unique row marked `is_primary=true` is the selected current row.
2. If no row is primary, exactly one row for that key may be selected; two or more rows are ambiguous and no row is current.
3. `verified=true` is a trust gate, not a selector. `expires_on` is an eligibility/alert gate, not a selector. An unverified or expired selected row stays selected and must not cause an automatic fallback to another row.
4. Replacement is explicit: create the replacement, verify it through the approval action, then mark it primary. The previous row remains as history. Setting the new primary uses the existing same-country demotion transaction; no array reorder has meaning.

Consumer rules:

- **Letterhead:** render a selected row only when it is verified and unexpired as of the render date. Omit an ambiguous, unverified, or expired fact rather than substituting another row.
- **Readiness:** each jurisdiction-required registration kind needs an unambiguous selected row that is verified and unexpired. Otherwise report the concrete missing/unverified/expired finding.
- **Expiry/renewals:** monitor the selected row even after it expires; expiry must not promote a different row. Ambiguity is a data-quality finding.
- **Admin/API serialization:** return all rows with `is_primary`, `verified`, `verified_by`, `verified_at`, and expiry data. The client may label only the selected row as current.

This rule does not add a registration lifecycle column. Any future superseded/deregistered model must replace this contract explicitly rather than changing selection through SQL or array ordering.
