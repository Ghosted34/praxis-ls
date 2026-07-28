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

**Rollout ("then all") — remaining wiring**, per the map above, each = `onRowClick →
DocumentView docType=… recordId=…`, plus a per-doc real-record `load()` where the record
id isn't the invoice table (proforma/receipt/quotation/proposal loaders exist; the Phase
2/4 docs need their `loadRecord` branch added, mirroring the invoice one). Order: Finance
(proforma, credit note, receipt, dunning) → Commercial → Sales → Procurement → Operations
(+ dossier-360 related docs) → Costing → HR → Fleet → WMS → Vault/Reports → Comms.
