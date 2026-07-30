# Document UI Overhaul — Step 1: identification

_Session 15. Identifies every screen touched by the doc-UI overhaul, before building._

## What we're changing (3 things)

1. **Template Studio** (`client/src/features/settings/document-templates-page.tsx`) —
   the 34 doc **chips → a `<Select>`** (the row won't scale to 34). One change, one file.
2. **Generate / Download (+ Send) buttons** on each screen where a document lives, so
   users produce/download it in place (e.g. download an invoice from Finance).
3. **Click-through document view** — rows in the doc tables become clickable; a click
   opens the record rendered **in its real document layout** (the same template preview,
   full-page), with **Download** and, for docs that go to a recipient, **Send**.

## Build-once shared pieces (used by every screen below)

- **`<DocumentView docType record.. />`** — a full-page/drawer that fetches
  `POST /document-templates/:docType/preview` (with `record_id`) and shows the branded
  HTML in an iframe + a header bar with **Download PDF** (`POST …/:docType/generate`) and
  **Send** (where applicable). This is THE component the "click-to-detail" opens.
- **`useDocDownload(docType, recordId)`** — calls `generate`, returns the vaulted PDF
  URL, triggers download.
- **Send path — DEPENDENCY (does not exist yet).** "Send to receiver" needs a backend
  endpoint that emails/dispatches the vaulted PDF (client for invoices, supplier for POs,
  employee for payslips, carrier for transit orders…). Today there's SMTP + smartcomm but
  no generic "send document" endpoint. Flag: build `POST /documents/:docType/:id/send`
  (recipient resolved from the record) before wiring Send buttons.

## Screen-by-screen map (34 docs)

Legend — **Send?**: ✉️ goes to an external receiver (needs Send) · 🏢 internal (Download only).

### Finance — `features/finance/{hub,pages,receivables}.tsx`
| Doc | docType | Table / list to make clickable | Send? |
|---|---|---|---|
| Invoice | `FINAL_INVOICE` | finance **hub** Invoices chip → `DataList` (also `InvoicesPage`) | ✉️ client |
| Proforma | `PROFORMA_ADVANCE` | hub Proforma chip → `DataList` (`ProformasPage`) | ✉️ client |
| Credit note | `CREDIT_NOTE` | `CreditNotesPage` (pages.tsx) | ✉️ client |
| Payment receipt | `PAYMENT_RECEIPT` | hub Receipts chip / `receivables.tsx` | ✉️ payer |
| Dunning letter | `DUNNING_LETTER` | receivables reminders list (`receivables.tsx`) | ✉️ client |
| VAT / DSF / CNPS | `VAT_RETURN` `DSF` `CNPS_DECLARATION` | `TaxCenterPage` (pages.tsx) | 🏢 file/print |
| Statements (income/balance/…) | report docTypes | `StatementsPage` / vault Reports | 🏢 (scheduled = ✉️) |

### Commercial — `features/commercial/pages.tsx`
| Quotation | `QUOTATION` | Quotations `DataList` | ✉️ client |

### Sales — `features/sales/pages.tsx`
| Proposal | `PROPOSAL` | Proposals `DataList` | ✉️ client |

### Procurement — `features/procurement/pages.tsx`
| Purchase order | `PURCHASE_ORDER` | PO `DataList` | ✉️ supplier |
| Purchase request | `PURCHASE_REQUEST` | PR `DataList` | 🏢 internal |
| Supplier invoice | `SUPPLIER_INVOICE` | supplier-invoice `DataList` | 🏢 received (Download only) |

### Operations — `features/operations/pages.tsx`
| Delivery note | `DELIVERY_NOTE` | Delivery-notes tab `DataList` | ✉️ consignee |
| Transit order | `TRANSIT_ORDER` | Transit-orders tab `DataList` | ✉️ carrier |
| _(dossier 360)_ | — | Dossier 360 modal: surface **related invoices/quotes** with Download (the "download invoices from operations" ask) | ✉️/🏢 |

### Costing — `features/costing/pages.tsx`
| Cash request | `CASH_REQUEST` | Cash-requests `DataList` | 🏢 internal |
| Régie advance | `REGIE_ADVANCE` | Régie `DataList` | 🏢 internal |

### HR — `features/hr/{payroll,contracts}.tsx`
| Payslip | `PAYSLIP` | Payroll **run detail** → payslip rows (`payroll.tsx`) | ✉️ employee |
| Employment contract | `EMPLOYMENT_CONTRACT` | Contracts `DataList` (`contracts.tsx`) | ✉️ employee (+ replace-with-signed) |

### Fleet — `features/fleet/{dispatch,work-orders}.tsx`  (already have detail modals — add Download)
| Trip sheet | `TRIP_SHEET` | Dispatch `DataList` / OdometerModal | 🏢 driver |
| Work order | `WORK_ORDER` | Work-orders `DataList` / WorkOrderDetail | 🏢 internal |

### WMS — `features/wms/{inbound,cycle-count}.tsx`
| GRN | `GRN` | Inbound `DataList` | 🏢 internal |
| Cycle-count sheet | `CYCLE_COUNT_SHEET` | Cycle-count `DataList` / CountSheet | 🏢 internal |

### Vault / Reports — `features/vault/pages.tsx`
| 10 reports + statements | report docTypes | Reports list / dashboard tiles → **Download PDF/CSV/XLSX**; scheduled = ✉️ email | 🏢/✉️ |

### Comms — `features/comms/{team-chat,mail}.tsx`
| Certified export | `COMMS_CERTIFIED_EXPORT` | Conversation → **Export** action | 🏢 archive/download |

## Summary of work implied (for step 2)

- **1** Studio chips→select change.
- **1** shared `DocumentView` + `useDocDownload` (+ the **Send endpoint** dependency).
- **~18 screens** get: clickable rows → `DocumentView`, and a Download (and Send where ✉️)
  affordance. Grouped: Finance (5), Commercial (1), Sales (1), Procurement (3),
  Operations (2 + dossier-360 related-docs), Costing (2), HR (2), Fleet (2), WMS (2),
  Vault/Reports (1), Comms (1).
- **Backend dependency:** `POST /documents/:docType/:id/send` (recipient from the record)
  before any Send button is wired; Download uses the existing `/generate`.

_Next (step 2): confirm this map, build the shared `DocumentView` + Send endpoint, then
wire screen-by-screen in the order above._

## Step 2 — shared foundation + exemplar (BUILT, session 15)

✅ **Studio chips → `<Select>`** (`document-templates-page.tsx`).
✅ **Send endpoint** `POST /document-templates/:docType/:id/send` — renders the doc, emails
it inline via `email.service`, vaults a PDF copy (best-effort), audits `document.sent`.
`to` is required (client contact emails aren't on the master yet). _Follow-up:_ PDF
**attachment** (mailer has no attachment channel today — sends inline HTML) + per-doc
recipient resolution.
✅ **Shared `DocumentView`** (`client/src/components/document-view.tsx`) — full-screen
sheet: record rendered in its template layout (iframe) + **Download PDF** (`/generate`) +
**Send**. Reused everywhere.
✅ **Finance invoices exemplar** — `finance/hub.tsx` invoice rows now open `DocumentView`
(FINAL_INVOICE, sendable). The proven pattern.

**Native detail (session 15 revision).** The doc page is now `DocumentPage` at route
`/documents/:docType/:id`, rendered **natively in the app theme** (dark cards, status
Pill), NOT the white sheet — the sheet is only what Download/Send produce. Preview endpoint
returns `data` (+ status) for the native render; reports keep the paper preview. A tiny
`<DocButton docType id title/>` (`components/doc-button.tsx`) is the drop-in.

**Wired so far:** Finance **Invoices** (View per row) + **Receipts** (drawer), **Commercial
Quotations** (detail), **Sales Proposals** (detail), **Procurement** POs + supplier invoices
(View per row), **Costing** cash requests (View per row), **HR** contracts (View) + payslips
(Payslip per run-detail row), **Fleet** work orders (View in the detail modal). Real
`loadRecord` branches now exist for FINAL/PROFORMA/CREDIT invoice-family, QUOTATION,
PAYMENT_RECEIPT, PROPOSAL, SUPPLIER_INVOICE, PURCHASE_ORDER, CASH_REQUEST, REGIE_ADVANCE,
WORK_ORDER, EMPLOYMENT_CONTRACT, PAYSLIP.

**Now also wired (session 15, full rollout):**
- **Credit note** — `CreditNotesPage` (finance/pages.tsx) View button. No `credit_note`
  table exists; credit notes are `invoice` rows with `type='CREDIT_NOTE'`, and the list
  returns `invoice_id`, so the button passes `String(r.invoice_id ?? r.credit_note_id)` into
  the invoice-family loader.
- **Delivery note** + **transit order** — View column on both operations lists.
- **GRN** — View in the inbound list actions.
- **Cycle-count sheet** — View column on the cycle-count list (lines pulled from the
  `discrepancy` jsonb).
- **Trip sheet** — View in the dispatch list actions (vehicle reg + driver + odometer).

Sparse docs (delivery/transit/GRN carry few fields; their line data isn't modelled) render
their heads + whatever the table holds; the template line tables show empty where there's no
source data.

**Also wired since:**
- **Proforma / advance** — View on `ProformasPage`; loader reads the `advance` table (not
  `invoice`), renders client + amount + applied.
- **Receipts** — now show *what is paid for* (payment_allocation → invoices) natively and in
  the PDF template.
- **"From" fix** — every view page now renders the issuing entity (was blank vs the template
  because preview returns `legal_name`, PartyCol read `name`).
- **Contracts** — send-on-create (optional email in the new-contract form → renders + emails
  the drafted contract), upload/replace a **signed** PDF (vaulted, tied via `pdf_vault_id`),
  View/Download prefers the signed copy; surfaced on both the Contracts screen and the
  employee-360 Contracts tab.
- Render fixes for work orders (parts/cost), contracts (party + type/effective + articles),
  proposals (narratives + line items), cycle-count (item names), trip sheet (odometer/route).

**Now closed:**
- **Régie advance** — reconciled the client field (`regie_advance_id` + `state` + `issued_on`;
  the old `regie_id`/`status` were undefined and crashed the ref cell) and wired the View.
- **Purchase request** — real loader (purchase_request + requester name via app_user;
  department + justification; header-only, no lines) and View on the PR list.
- **Operations dossier-360** — the 360° Documents tab now has an **Invoices** group with a
  View per invoice (backend overview returns `document_rows.invoices`), and View buttons on
  the transit-order and delivery-note rows there.

**Send follow-ups (done):**
- **PDF attachment** — `email.service.send` now takes `attachments`; the document `send`
  renders the PDF (Puppeteer) and attaches it, falling back to inline HTML if the render
  fails. Vault copy + audit unchanged.
- **Recipient resolution** — `resolveRecipient(docType, recordId)` returns an address where
  one genuinely exists (proposal → `lead.email`; masters store no email otherwise). Preview
  returns `suggested_to`; the Send prompt pre-fills it. `send` uses it when `to` is omitted.
- **DSF** — bespoke `dsfBuild` (SYSCOHADA-structured: identification, income statement,
  balance sheet, IS computation at 33%) replaces the generic report renderer. Reads live
  producer output or the enriched sample. Still a structured summary, not the official DGI
  liasse (needs the master PDF for pixel parity — noted in-doc footer).

**Recipient coverage (done):**
- Migration `0475_master_email.sql` adds `email` (citext) to `client_master`, `supplier_master`
  and `employee`. Validators + the client/supplier/employee forms now capture it.
- `resolveRecipient` covers all the party-linked sendables: invoices, credit notes, quotations,
  receipts, proforma/advances, proposals (client or lead), POs, supplier invoices, payslips
  and contracts → the stored master email, falling back to a typed address when blank.
- **Run `db:migrate:tenants`** to apply 0475 before the resolved-recipient send works.

**Remaining:**
- **Verification** — full `tsc` / `vite build` / `jest` on a real machine (native bundlers
  segfault in-sandbox; only per-file syntax checks + backend eslint ran here).
