# Document Templates — Build Plan

**Goal.** Design and build every document the system generates (see the inventory
in §5) as a **QR-verifiable PDF**, each rendered from a shared, on-brand template
kit, and each **customizable + live-previewable by the tenant from the UI**
("beautify + preview" is a first-class feature, not an afterthought).

_Drafted 2026-07-27 (session 15). **Phases 0–4 built — all 34 templates (session 15).**_

> **Phase 4 (session 15).** ✅ The final 8 designed: **payslip** (statutory
> earnings/deductions + net), **employment contract** (parties + numbered articles +
> signature; generate-draft/replace-with-signed per §9.4), **GRN** (received lines +
> QA), **trip sheet** (vehicle/driver/route + odometer out/in/distance), **work
> order** (parts + labour + cost), **cycle-count sheet** (expected/counted/variance),
> **dunning letter** (overdue list + body), and **certified comms export**
> (chain-of-custody hash + messages). **All 34 templates render clean; registry
> eslint clean.** Every one flows through the same kit + per-entity config + Studio +
> vault pipeline. Remaining is integration polish only: real-record `load()` +
> auto-generate wiring for the Phase 2/4 docs (invoice exemplar + reports done), a
> Studio params form for live report preview, and pixel-exact DSF once referenced.

> **Phase 3 (session 15).** ✅ All **10 reports + 3 tax filings** registered as
> templates with a **generic branded statement renderer** (`registry.js`
> `reportBuild`/`autoBlocks`: arrays → tables, nested objects → sections, scalars →
> a key/value summary) + representative `sampleData`, so they preview + beautify in
> the Studio like any doc. Real, parameterised report PDFs generate via
> **`POST /reports/run/:key/pdf`** (`report.controller.runPdf` → producer →
> `template.service.renderPdfFromData` → vaulted PDF), RBAC-masked by the producer.
> **26 templates render clean.** ✅ **Bespoke statutory forms:** the **TVA return**
> and **CNPS/DIPE** now have faithful hand-built layouts (official section names,
> statutory rates 19.25% / 4.2%+4.2% / 7% / injury, 750k ceiling, employee schedule
>
> - récapitulatif) reading both the live producer output and the sample via field
>   fallbacks — refine to pixel-exact against the DGI/CNPS master PDFs when available.
>   **DSF** stays on the generic renderer (large annual multi-schedule form — awaits a
>   reference). _Later:_ a params form in the Studio for live report preview (today
>   reports preview from sample). Two bugs fixed in testing: Studio config now stores
>   under section **`document_template_config`** (the legacy `document_template`
>   section has a name-required validator), and the receipt loader uses
>   **`payment_receipt`** with a defensive `records()`.

> **Phase 2 + follow-ups (session 15, same day).** ✅ **Phase 2** — the 7
> operations/procurement templates designed in the registry (purchase order,
> supplier invoice [COPY watermark], purchase request, delivery note [no-prices],
> transit order [carrier/route + cargo], cash request, régie advance). **13
> templates render clean.** ✅ Real-record **loaders for all 6 Phase-1 docs**
> (invoice family + quotation + receipt + proposal) and the picker `records()`.
> ✅ **Auto-generate-on-issue mechanism**: the `pdf` worker job now builds HTML
> in-worker from `{docType, recordId}` via the registry + saved config
> (`src/jobs/handlers/pdf-render.js`), a fire-and-forget `enqueueDocument(...)`
> helper (`src/services/documents/generate.js`), and the **final_invoice issue**
> transition wired as the exemplar (fires on `ISSUED_LOCKED`). The other captured
> docTypes wire the same one line in their controller at the issue point — the
> only remaining bit, and it's mechanical.

> **Build status.** ✅ **Phase 0** — template **kit** (`src/services/documents/
templates/kit.js`: shell + letterhead + parties + lineTable + totals + bank +
> terms + signature + watermark + footer, theme-token + FR/EN driven), the
> **registry** (`.../registry.js`), the **config store** ((docType, entity_id) over
> the settings store `document_template`, entity→tenant→branding resolution), the
> **module** (`src/modules/documents/template/` → `/document-templates`: list /
> get+put config / records / **preview** (live HTML, real-record or sample, inline
> config for unsaved edits) / **generate** (real vaulted PDF via `renderAndStore`)),
> and the **Template Studio UI** (`client/.../settings/document-templates-page.tsx`,
> route `/settings/document-templates`): live iframe preview + structured beautify
> controls + entity picker + real-record picker. ✅ **Phase 1** — all six core docs
> designed (invoice, proforma, quotation, credit note, receipt, proposal) with
> `sampleData`; real-record loading wired for the **invoice family** (FINAL /
> PROFORMA / CREDIT_NOTE share the `invoice` table). Validated: all six render;
> backend eslint + client `tsc` + Tailwind clean.
>
> **Remaining wiring (small, per-doc):** (a) real-record `load()` for quotation /
> receipt / proposal (invoice family done — the pattern is in `template.service.
loadRecord`); (b) auto-generate-on-issue — modules still only `documents.capture`
> metadata; hook each issue action to the `/generate` path (or call
> `renderAndStore`) so PDFs mint automatically. The Studio + on-demand generate
> already produce real PDFs today.

---

## 1. Current state (audit)

The pipeline pieces exist; the templates and the UI do not.

- **`src/services/pdf.service.js`** — `renderAndStore(html, key, entityRef, docType)`:
  HTML → Puppeteer PDF → storage → `document_vault` capture with SHA-256 "DNA" +
  a `praxis://verify` QR token. ✅ works.
- **`src/services/pdf.templates.js`** — HTML builders. **Only `buildInvoiceHtml`
  exists** (+ `shell/xaf/esc` helpers). Everything else is unbuilt.
- **`src/jobs/handlers/pdf-render.js`** + the `pdf` worker queue — ✅ wired.
- **`documents.capture(...)`** — records a `document_vault` row (docType, hash,
  status). Today the module capture calls **only record metadata — no module
  renders an actual PDF** (nothing calls `renderAndStore` / enqueues the `pdf`
  job). So end-to-end generation is unwired for all 14 captured docTypes.
- **Branding / letterhead** — corporate-entity logo (`logo_light_ref`/
  `logo_dark_ref`) + tenant `--primary`; **numbering** — per-module numbering
  schemes (prefix/pad/reset). Both must feed the templates.

**Net:** we have a renderer and a vault, but 33 of 34 templates, the tenant
customization layer, and the preview UI are all to be built.

---

## 2. Architecture

Five layers, each reusable across every document:

1. **Template registry** — one entry per `docType`: `{ build(data, cfg, brand),
sampleData, i18n, fields[] }`. Grows out of `pdf.templates.js` into
   `src/services/documents/templates/*`.
2. **Shared template kit** — the shell + reusable blocks (letterhead, party
   blocks, line-item table, totals, OHADA legal footer, signature, QR-verify
   badge, watermark). Bilingual FR/EN (KB §8.4). One CSS theme driven by tokens.
3. **Per-tenant template config** — a settings-store record per docType
   (`/settings/document_template/<docType>`) holding the client's beautify choices
   (accent, logo, visible sections, footer text, terms, signature, watermark,
   language, paper). Defaults derive from branding so an unconfigured template
   already looks right.
4. **Preview + render services** — a **preview** path (fast HTML, no PDF, for the
   live UI) and a **render** path (`renderAndStore`, the real immutable PDF).
5. **Template Studio (UI)** — Settings → Document templates: list all docs, open
   one into a live-preview editor with structured beautify controls.

```
tenant config ─┐
branding      ─┤→ template.build(data, cfg, brand) → HTML ─┬→ preview  (iframe, live)
record data   ─┘                                            └→ renderAndStore → PDF → vault (QR)
```

---

## 3. The shared template kit

Build once in `templates/kit.js`, reuse everywhere:

- **`shell(cfg, brand, bodyHtml)`** — `<html>` + injected CSS theme (accent, fonts,
  margins, paper size), page `@page` rules, header/footer running elements.
- **`letterhead(entity, cfg)`** — logo + legal identity block (name, address,
  RCCM, NIU, share capital) — the OHADA header.
- **`partyBlock(label, party)`** — Bill-to / Ship-to / Supplier / Employee.
- **`metaBlock(fields)`** — number, date, due/validity, reference, page.
- **`lineTable(columns, rows, cfg)`** — the shared items grid (qty × unit × tax ×
  total) with show/hide columns.
- **`totals(summary, cfg)`** — HT / VAT breakdown / WHT / TTC, in words (FR/EN).
- **`legalFooter(entity, cfg)`** — RCCM · NIU · capital · bank block · custom
  mentions + page numbers.
- **`signatureBlock(cfg)`**, **`qrVerify(token)`**, **`watermark(text)`** (DRAFT /
  PAID / COPY / VOID).
- **i18n** — a `t(key, lang)` dictionary; each template ships FR + EN strings;
  `language` config = `fr | en | bilingual`.

All colours/spacing are CSS variables set from `cfg` + `brand`, so re-theming is
data, never a code edit — the same discipline as the app kit.

---

## 4. Per-tenant customization (what "beautify" means)

Stored per docType in the settings store; every knob has a branding-derived
default. Grouped for the UI's control tabs:

| Group                 | Controls                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| **Brand**             | accent colour, logo (light/dark, position, size), font family, paper size (A4 default), margins |
| **Header**            | show/hide logo, document title text (per-lang), which meta fields, entity identity lines        |
| **Body**              | visible line-table columns, show tax breakdown, show notes, show discount, currency display     |
| **Footer**            | custom footer text, legal mentions (RCCM/NIU/capital), bank details block, page numbers         |
| **Terms & signature** | terms-&-conditions rich text (per doc), signature block (name/title/image), stamp               |
| **Marks**             | watermark (DRAFT/PAID/COPY/VOID or custom), background tint                                     |
| **Language**          | FR / EN / bilingual default                                                                     |

**Multi-entity (decided):** config is keyed **`(docType, entity_id)`**. Each
`corporate_entity` can have its own letterhead/config; the tenant-level row
(`entity_id = null`) is the default + the seed for a new entity. Render resolves
entity override → tenant default → branding default. See §9.1–9.2.

---

## 5. Template inventory & per-doc spec

Grouped by phase. **Status:** ✅ built · ▫ metadata-captured, template TODO · ➕ new
(no capture yet). All share the kit; the "Beautify" column notes doc-specific knobs
beyond the standard set.

### Phase 1 — Core finance & commercial (highest value)

| #   | Document           | docType            | Module                    | Status     | Key fields                          | Doc-specific beautify           |
| --- | ------------------ | ------------------ | ------------------------- | ---------- | ----------------------------------- | ------------------------------- |
| 1   | Final invoice      | `FINAL_INVOICE`    | finance/final_invoice     | ✅ (basic) | lines, HT/VAT/TTC, WHT, due, bank   | payment terms, "PAID" watermark |
| 2   | Proforma / advance | `PROFORMA_ADVANCE` | finance/proforma          | ▫          | advance %, validity                 | validity note                   |
| 3   | Quotation          | `QUOTATION`        | commercial/quotation      | ▫          | lines, margin-safe totals, validity | accept/e-sign CTA               |
| 4   | Payment receipt    | `PAYMENT_RECEIPT`  | finance/smart_receivables | ▫          | amount, method, invoice ref         | "PAID" stamp                    |
| 5   | Credit note        | `CREDIT_NOTE`      | finance/credit_note       | ▫          | reversed invoice ref, reason        | red accent option               |
| 6   | Sales proposal     | `PROPOSAL`         | sales/proposal            | ▫          | scope, pricing, cover page          | cover image, sections           |

### Phase 2 — Operations & procurement

| #   | Document                         | docType            | Module                       | Status | Doc-specific beautify             |
| --- | -------------------------------- | ------------------ | ---------------------------- | ------ | --------------------------------- |
| 7   | Delivery note (bon de livraison) | `DELIVERY_NOTE`    | operations/delivery_note     | ▫      | consignee block, no prices toggle |
| 8   | Transit order                    | `TRANSIT_ORDER`    | operations/transit_order     | ▫      | carrier block, route              |
| 9   | Purchase request                 | `PURCHASE_REQUEST` | procurement/purchase_request | ▫      | approver signatures               |
| 10  | Purchase order                   | `PURCHASE_ORDER`   | procurement/purchase_order   | ▫      | supplier terms, delivery addr     |
| 11  | Supplier invoice (recorded)      | `SUPPLIER_INVOICE` | procurement/supplier_invoice | ▫      | "COPY" watermark                  |
| 12  | Cash request                     | `CASH_REQUEST`     | costing/cash_request         | ▫      | approval chain                    |
| 13  | Régie advance                    | `REGIE_ADVANCE`    | costing/regie                | ▫      | float ledger                      |

### Phase 3 — Statements, reports & tax filings

Reports already produce data via `/reports` (exportable **pdf/csv/xlsx**) — Phase 3
gives them branded PDF layouts.

| #   | Document                              | source                             | beautify                    |
| --- | ------------------------------------- | ---------------------------------- | --------------------------- |
| 14  | Income statement (Compte de résultat) | reports `income_statement`         | period header, comparatives |
| 15  | Balance sheet (Bilan)                 | reports `balance_sheet`            | as-of date                  |
| 16  | Trial balance                         | reports `trial_balance`            | grouping                    |
| 17  | Cash-flow (TAFIRE)                    | reports `cash_flow`                | —                           |
| 18  | Receivables ageing                    | reports `receivables_ageing`       | bucket chart                |
| 19  | Receivables reminders                 | reports `receivables_reminders`    | —                           |
| 20  | Dossier 360                           | reports `dossier_360`              | sections toggle             |
| 21  | Cash position                         | reports `cash_position`            | —                           |
| 22  | Procurement spend                     | reports `procurement_spend`        | —                           |
| 23  | Dossier margin portfolio              | reports `dossier_margin_portfolio` | mask cost (RBAC)            |
| 24  | TVA / VAT return                      | tax_declaration                    | official layout             |
| 25  | DSF (annual statistique & fiscale)    | tax_declaration                    | official layout             |
| 26  | CNPS declaration (DIPE)               | tax_declaration                    | official layout             |

### Phase 4 — HR + remaining operational docs

| #   | Document                                                        | source                    | Status    | notes                                                                                      |
| --- | --------------------------------------------------------------- | ------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| 27  | Payslip (bulletin de paie)                                      | hr/payroll                | ➕        | needs `docType` + capture; statutory breakdown (CNPS/IRPP/CAC/CFC)                         |
| 28  | Employment contract (offer/employment/confirmation/termination) | hr/hr_contract            | ➕        | **both**: generate draft (`EMPLOYMENT_CONTRACT`) + allow replace-with-signed upload (§9.4) |
| 29  | GRN (goods-received note)                                       | wms/inbound               | ➕        | QA sign-off                                                                                |
| 30  | Dispatch / trip sheet                                           | fleet/dispatch            | ➕        | odometer out/in, driver                                                                    |
| 31  | Work order                                                      | fleet/work-orders         | ➕        | parts, labour, cost                                                                        |
| 32  | Cycle-count sheet                                               | wms/cycle-count           | ➕        | expected vs counted                                                                        |
| 33  | Dunning letter                                                  | finance/smart_receivables | ➕        | tone per ageing level                                                                      |
| 34  | Certified comms export                                          | `COMMS_CERTIFIED_EXPORT`  | smartcomm | ▫                                                                                          | chain-of-custody header |

**Totals:** 34 templates (1 exists, 12 metadata-captured, 21 new/uncaptured).

---

## 6. Preview & generation pipeline

- **Live preview (UI).** `POST /documents/templates/:docType/preview` → returns
  **HTML** (not PDF) rendered from `build(sampleOrRecord, cfg, brand)`. The Studio
  drops it into a sandboxed `<iframe srcDoc>`; re-renders debounced on every config
  change. Fast (no Chromium). A **"Preview PDF"** button hits the real render path
  once for an accurate proof.
- **Real-record preview (default, §9.3).** The Studio previews against a **real
  record** via a per-docType picker (choose an invoice/quote/…), rendered live and
  RBAC-masked (§7). Each registry entry also ships representative `sampleData`,
  used only as the fallback when the tenant has no record of that type yet.
- **Real generation.** On the document's own action (issue invoice, send quote,
  post receipt…) the module calls `renderAndStore` with `build(record, cfg, brand)`
  → PDF → vault (hash + QR). **Immutability:** regenerate freely while `DRAFT`;
  once issued/locked the PDF is hashed and frozen (re-issue = a new versioned doc,
  mirroring the ledger discipline). Config changes affect **future** documents,
  never already-issued ones.
- **Numbering** comes from the per-module numbering scheme; **verify** QR resolves
  to the stored hash for authenticity.

---

## 7. Cross-cutting requirements

- **OHADA/Cameroon compliance** — legal footer (RCCM, NIU, share capital), bilingual
  FR/EN, statutory tax breakdowns, official layouts for VAT/DSF/CNPS.
- **RBAC field masking in previews** — cost/margin/salary lines must respect the
  same server masks in preview as in the app (esp. dossier-margin, payslip).
- **Immutability & audit** — issued PDFs are content-hashed; regeneration is
  versioned; every render audited.
- **i18n** — FR default, EN available, bilingual option; numbers/dates localized.
- **Storage** — tenant-namespaced keys via the storage driver (local/S3).
- **Testing** — golden **HTML-snapshot** tests per template (render `sampleData` →
  compare), so beautify refactors can't silently break a layout; a couple of
  end-to-end PDF smoke tests.
- **Performance** — HTML preview is synchronous; PDF render stays on the `pdf`
  worker queue (Chromium is heavy).

---

## 8. Build sequence

- **Phase 0 — foundation (do first).** Template **kit** (shell + blocks + theme
  tokens + i18n), the **config store** schema + `GET/PUT /settings/document_template/
:docType`, the **preview** + **render** service endpoints, and the **Template
  Studio UI shell** (list + iframe editor + control panel) — proven end-to-end on
  the one existing doc (**invoice**). Nothing else ships until a client can open the
  invoice, beautify it, preview live, and download a real PDF.
- **Phase 1** — the 6 core finance/commercial docs (§5).
- **Phase 2** — the 7 operations/procurement docs.
- **Phase 3** — the 10 report/statement PDFs + 3 tax filings.
- **Phase 4** — payslip + contracts + the 5 operational extras + comms export.

Each phase = its `build()` functions + `sampleData` + wiring the module's
generate/issue action to `renderAndStore` + snapshot tests + a Studio entry.

---

## 9. Decisions (locked 2026-07-27)

1. **Customization surface = structured controls, broad.** No WYSIWYG/HTML editor.
   But the structured surface is **deliberately wide** — clients can override every
   _core_ aspect (accent + full colour set, fonts, logo & placement, paper/margins,
   per-section show/hide, column selection, header/title text per language, footer
   text + legal mentions, terms, signature/stamp, watermark, language). The kit's
   job is to keep any combination on-brand and unbreakable (bounded inputs, live
   validation). An advanced "custom CSS / raw footer HTML" escape hatch is a
   possible _later_ addition, explicitly out of scope for v1.
2. **Per-entity templates.** Config is keyed **`(docType, entity_id)`**. Each
   `corporate_entity` can carry its own letterhead/config; a tenant-level default
   (`entity_id = null`) is the fallback and the seed for a new entity's config.
   Resolution at render time: entity override → tenant default → branding-derived
   default. The Studio lets the client pick which entity they're editing.
3. **Real-record preview from day one.** The Studio previews against a **real
   record** (picker per docType), RBAC-masked exactly as generation is; bundled
   `sampleData` is the fallback only when the tenant has no record of that type yet.
4. **Contracts = both.** Generate a draft contract from the template (so the client
   gets an on-brand starting document), AND allow **replace-with-signed**: upload
   the executed/scanned PDF, which supersedes the generated draft on the record
   (draft kept in version history). `hr_contract` keeps its attachment field for
   the signed copy; a `docType: "EMPLOYMENT_CONTRACT"` is added for the generated one.
5. **Every report gets a branded PDF.** All 10 `/reports` producers render through
   the kit (branded PDF layout) in addition to the existing CSV/XLSX exports —
   internal ones included, so the look is uniform. RBAC masks still apply (e.g.
   margin/cost on `dossier_margin_portfolio`).

_Impact on the build:_ Phase 0's config store schema uses the composite
`(docType, entity_id)` key and the Studio ships the entity picker + real-record
picker from the start; the kit must expose the full override set listed in §4.
