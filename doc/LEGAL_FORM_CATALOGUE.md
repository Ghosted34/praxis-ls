# Legal-form catalogue — Phase 1

## Scope

The corporate-entity Legal form control is a closed, country-aware picker. Phase
1 combines:

1. **ISO 20275 / GLEIF Entity Legal Forms v1.6**, released 2026-02-19:
   3,446 active, jurisdiction-bound ELF codes from 129 country codes and more
   than 200 national/subnational jurisdictions.
2. **OHADA supplement** for all 17 member states, because GLEIF v1.6 has no
   Cameroon rows. The supplement covers the common commercial forms, GIE,
   single-member variants, both OHADA cooperative forms, and clearly labelled
   non-separate establishments.

Phase 2's country-by-country African registry audit is intentionally outside this
scope. The UI says so instead of offering invented generic forms when Phase 1 has
no verified data for a selected country.

## Authoritative sources

- GLEIF ISO 20275 list:
  <https://www.gleif.org/en/lei-data/code-lists/iso-20275-entity-legal-forms-code-list>
- Official v1.6 CSV:
  <https://www.gleif.org/lei-data/code-lists/iso-20275-entity-legal-forms-code-list/2026-02-19-elf-code-list-v1.6.csv>
- OHADA commercial companies and GIE:
  <https://www.ohada.org/en/commercial-companies-and-economic-interest-groups/>
- OHADA cooperative societies:
  <https://www.ohada.org/en/cooperative-societies-law/>
- OHADA member states:
  <https://www.ohada.org/en/general-overview/>
- Nigeria CAC Companies Regulations 2021:
  <https://news.cac.gov.ng/wp-content/uploads/2021/01/COMPANIES-REGULATIONS-2021-published.pdf>

The downloaded v1.6 CSV used for this build has SHA-256:

```text
c55edc421e49ce362457f772d6bfa41f5fc63ecaadea74db5735722625506ef4
```

## Updating

Do not hand-edit `packages/shared/data/legal-forms.generated.js`. Download the
next official GLEIF CSV and run:

```bash
python3 scripts/gen/gen-legal-form-catalogue.py /path/to/official-elf.csv
```

Then review source-version metadata, GLEIF changes, Nigerian presentation
overrides, OHADA membership/law changes, catalogue counts, tests, and bundle
size before merging.

## Persistence contract

`corporate_entity.legal_form` remains the printable text used on statutory
output. New selections additionally store:

- `legal_form_code`
- `legal_form_source`
- `legal_form_jurisdiction`

The reference triple is all-or-none and validated against the shared catalogue.
Legacy text-only rows remain valid; ambiguous values are never silently assigned
to a jurisdiction.
