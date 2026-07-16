/**
 * Screen catalogue for un-built screens (rendered by ScreenScaffold / <Planned/>).
 * Each entry is the *planned* structure of a screen: header, tabs, table columns,
 * primary actions and the AI actions that apply there. This doubles as the
 * machine-readable source for doc/FE_IA_BUILD_MAP.md.
 *
 * BE status:
 *   ready    — backend endpoints exist; screen just needs FE wiring
 *   partial  — some endpoints exist (create/list) but the flow isn't complete
 *   readonly — backend is read-only today
 *   none     — no backend endpoint yet (BE dev must build it)
 *
 * AI kind:
 *   read   — the assistant can query this screen's data (no side effects)
 *   write  — the assistant can perform an action here (human-confirmed)
 *   assist — an LLM-generative / inference step (draft, triage, reconcile, verify)
 */

export type BeStatus = "ready" | "partial" | "readonly" | "none";
export type AiKind = "read" | "write" | "assist";
export type AiAction = { label: string; kind: AiKind; describe: string };
export type ScreenTab = { label: string; columns?: string[]; actions?: string[] };
export type ScreenSpec = {
  path: string;
  area: string;
  title: string;
  purpose: string;
  module?: string;
  status: BeStatus;
  columns?: string[];
  actions?: string[];
  tabs?: ScreenTab[];
  ai?: AiAction[];
};

export const SPECS: ScreenSpec[] = [
  /* ───────────────────────────── Overview ───────────────────────────── */
  {
    path: "workspace",
    area: "Overview",
    title: "My Workspace",
    purpose: "Your personal home: tasks assigned to you, approvals awaiting your decision, and files you touched recently.",
    module: "MOD-workspace",
    status: "readonly",
    tabs: [
      { label: "My tasks", columns: ["Item", "Type", "Linked to", "Due", "Status"] },
      { label: "My approvals", columns: ["Request", "Amount", "Requested by", "Age", "Action"] },
      { label: "Recent", columns: ["Item", "Type", "Opened", "Last activity"] },
    ],
  },
  {
    path: "godmode",
    area: "Overview",
    title: "Godmode Console",
    purpose: "Platform superadmin surface (cross-tenant). Separate from the tenant app — provision, suspend, capacity. Superadmin only.",
    module: "platform",
    status: "none",
    columns: ["Tenant", "Plan", "Status", "Users", "Capacity", "Actions"],
    actions: ["Provision tenant"],
  },

  /* ───────────────────────────── Commercial ───────────────────────────── */
  {
    path: "commercial/quotations",
    area: "Commercial",
    title: "Quotations",
    purpose: "Client quotations with a pricing workbench: build lines + totals, simulate margin and extra charges before sending.",
    module: "MOD-27",
    status: "ready",
    tabs: [
      { label: "Quotations", columns: ["Ref", "Client", "Dossier", "Status", "Total", "Valid until"], actions: ["New quotation", "Send", "Accept"] },
      { label: "Lines & totals", columns: ["Service", "Qty", "Unit price", "Tax", "Line total"] },
      { label: "Margin simulation", columns: ["Service", "Revenue", "Cost", "Margin", "Margin %"] },
      { label: "Extra-charge simulation", columns: ["Charge", "Tier", "Days", "Rate", "Estimate"] },
    ],
    ai: [
      { label: "List quotations", kind: "read", describe: "List quotations (filter status/client/dossier)." },
      { label: "Draft quotation", kind: "write", describe: "Draft a quotation with lines + totals." },
      { label: "Send / accept quotation", kind: "write", describe: "Transition or accept a quotation (optionally convert to a final invoice)." },
    ],
  },
  {
    path: "commercial/margin-simulation",
    area: "Commercial",
    title: "Margin simulation",
    purpose: "What-if margin workbench — margin is computed on services only (débours excluded, KB §6.7).",
    module: "MOD-27",
    status: "ready",
    columns: ["Ref", "Dossier", "Revenue", "Service cost", "Margin", "Margin %", "Created"],
    actions: ["New simulation"],
    ai: [
      { label: "List margin simulations", kind: "read", describe: "List margin simulations." },
      { label: "Compute margin simulation", kind: "write", describe: "Compute + persist a margin simulation (margin on services only)." },
    ],
  },
  {
    path: "commercial/extra-charge-simulation",
    area: "Commercial",
    title: "Extra-charge simulation",
    purpose: "Tiered demurrage / detention estimator — model the cost of delay before it lands.",
    module: "MOD-28",
    status: "ready",
    columns: ["Ref", "Type", "Free days", "Tiers", "Estimate", "Created"],
    actions: ["New simulation"],
    ai: [
      { label: "List extra-charge simulations", kind: "read", describe: "List demurrage/detention simulations." },
      { label: "Compute estimate", kind: "write", describe: "Compute + persist a tiered demurrage/detention estimate." },
    ],
  },
  {
    path: "commercial/pricing-variance",
    area: "Commercial",
    title: "Pricing variance",
    purpose: "Quote-vs-actual-cost variance with an R/Y/G flag. Sales sees the flag + quote; only Finance sees raw cost.",
    module: "MOD-56",
    status: "ready",
    columns: ["Dossier", "Quote", "Actual cost", "Variance", "Variance %", "Flag"],
    actions: ["Compute variance"],
    ai: [
      { label: "List pricing variance", kind: "read", describe: "Sales pricing-variance list (R/Y/G flag + quote; never raw cost)." },
      { label: "Compute pricing variance", kind: "assist", describe: "Finance: compute + persist a dossier's pricing variance (quote vs actual cost)." },
    ],
  },

  /* ───────────────────────────── Sales / CRM ───────────────────────────── */
  {
    path: "sales/leads",
    area: "Sales & CRM",
    title: "Leads",
    purpose: "Sales lead capture and qualification, plus inbound enquiry intake feeding the top of the funnel.",
    module: "sales/lead",
    status: "ready",
    tabs: [
      { label: "Leads", columns: ["Name", "Company", "Source", "Status", "Owner", "Created"], actions: ["Capture lead", "Advance", "Convert to client"] },
      { label: "Inbound intake", columns: ["Contact", "Subject", "Channel", "Status", "Received"], actions: ["Triage"] },
    ],
    ai: [
      { label: "List leads", kind: "read", describe: "List sales leads (filter status/owner)." },
      { label: "Capture lead", kind: "write", describe: "Capture a new lead." },
      { label: "Advance / convert lead", kind: "write", describe: "Advance a lead (contacted/qualified/lost) or convert a qualified lead into a client." },
      { label: "Triage inbound enquiry", kind: "assist", describe: "Triage an enquiry (optionally convert to a lead)." },
    ],
  },
  {
    path: "sales/inbound-intake",
    area: "Sales & CRM",
    title: "Inbound intake",
    purpose: "Contact enquiries and partnership requests captured from the website/email, triaged into leads.",
    module: "sales/inbound_intake",
    status: "ready",
    tabs: [
      { label: "Enquiries", columns: ["Contact", "Subject", "Channel", "Status", "Received"], actions: ["Triage → lead"] },
      { label: "Partnership requests", columns: ["Organisation", "Type", "Status", "Received"], actions: ["Review"] },
    ],
    ai: [{ label: "Triage enquiry", kind: "assist", describe: "Triage an enquiry (optionally convert to a lead)." }],
  },
  {
    path: "sales/opportunities",
    area: "Sales & CRM",
    title: "Opportunities",
    purpose: "The CRM pipeline — a Kanban board of open opportunities by stage, with weighted value forecasting.",
    module: "MOD-24",
    status: "ready",
    tabs: [
      { label: "Pipeline board", columns: ["Stage", "Opportunities", "Value", "Weighted value"], actions: ["New opportunity"] },
      { label: "List", columns: ["Name", "Client", "Stage", "Value", "Probability", "Owner"], actions: ["Move stage", "Win", "Lose"] },
    ],
    ai: [
      { label: "Pipeline board", kind: "read", describe: "Stage counts + weighted value for the open pipeline." },
      { label: "Create / move opportunity", kind: "write", describe: "Create an opportunity or move it to another stage." },
      { label: "Win / lose", kind: "write", describe: "Mark an opportunity won (optionally open a dossier) or lost." },
    ],
  },
  {
    path: "sales/proposals",
    area: "Sales & CRM",
    title: "Proposals",
    purpose: "Formal proposals with an AI-drafted narrative + line items; always human-reviewed before send.",
    module: "sales/proposal",
    status: "ready",
    columns: ["Ref", "Client", "Status", "Value", "Created"],
    actions: ["Draft with AI", "Send", "Accept"],
    ai: [
      { label: "Draft proposal", kind: "assist", describe: "Draft a proposal (AI-assisted; human review before send)." },
      { label: "Send / accept proposal", kind: "write", describe: "Review/send/reject, or accept a sent proposal (optionally create a quotation)." },
    ],
  },
  {
    path: "sales/meetings",
    area: "Sales & CRM",
    title: "Meetings",
    purpose: "Meeting scheduling and minutes against a lead or client — the CRM activity log.",
    module: "sales/meeting",
    status: "ready",
    columns: ["Title", "With", "Date", "Owner", "Notes"],
    actions: ["Schedule meeting", "Add minutes"],
    ai: [
      { label: "Schedule meeting", kind: "write", describe: "Schedule a meeting." },
      { label: "Add note / minutes", kind: "write", describe: "Add a note or minutes to a meeting." },
    ],
  },
  {
    path: "sales/campaigns",
    area: "Sales & CRM",
    title: "Marketing campaigns",
    purpose: "Outbound campaigns and newsletter audiences — create, activate, pause, measure.",
    module: "sales/marketing_campaign",
    status: "ready",
    tabs: [
      { label: "Campaigns", columns: ["Name", "Channel", "Status", "Audience", "Start"], actions: ["New campaign", "Activate / pause"] },
      { label: "Subscribers", columns: ["Email", "Segment", "Subscribed", "Status"] },
    ],
    ai: [
      { label: "Create campaign", kind: "write", describe: "Create a marketing campaign." },
      { label: "List subscribers", kind: "read", describe: "List active newsletter subscribers." },
    ],
  },
  {
    path: "sales/success-stories",
    area: "Sales & CRM",
    title: "Success stories",
    purpose: "Portfolio case studies — AI-drafted from a dossier, signed off, then published.",
    module: "sales/success_story",
    status: "ready",
    columns: ["Title", "Client", "Status", "Published"],
    actions: ["Draft with AI", "Publish"],
    ai: [
      { label: "Draft success story", kind: "assist", describe: "Draft a success story (AI-assisted)." },
      { label: "Publish", kind: "write", describe: "Publish a signed-off success story." },
    ],
  },

  /* ───────────────────────────── Operations ───────────────────────────── */
  {
    path: "operations/files",
    area: "Operations",
    title: "Operations files (dossiers)",
    purpose: "The freight-forwarding file is the operational hub — milestones, transit orders and delivery notes hang off it.",
    module: "operations/operations_file",
    status: "ready",
    tabs: [
      { label: "Dossiers", columns: ["Ref", "Client", "Service", "Status", "Opened"], actions: ["Open dossier", "Advance"] },
      { label: "Milestones", columns: ["Milestone", "Due", "Owner", "Status"], actions: ["Add milestone", "Complete"] },
      { label: "Transit orders", columns: ["Ref", "Mode", "Carrier", "Status"], actions: ["New transit order"] },
      { label: "Delivery notes", columns: ["Ref", "Consignee", "Status", "Date"], actions: ["New delivery note"] },
    ],
    ai: [
      { label: "List / get dossiers", kind: "read", describe: "List operation files (dossiers) or fetch one." },
      { label: "Open / advance dossier", kind: "write", describe: "Open a dossier, update it, or advance its status." },
    ],
  },
  {
    path: "operations/milestones",
    area: "Operations",
    title: "Milestones",
    purpose: "Shipment milestones across all dossiers — the operational timeline / SLA tracker.",
    module: "operations/milestone",
    status: "ready",
    columns: ["Dossier", "Milestone", "Due", "Owner", "Status"],
    actions: ["Add milestone", "Complete"],
  },
  {
    path: "operations/transit-orders",
    area: "Operations",
    title: "Transit orders",
    purpose: "Transport instructions to carriers — own register, also surfaced as a dossier tab.",
    module: "operations/transit_order",
    status: "ready",
    columns: ["Ref", "Dossier", "Mode", "Carrier", "Status", "Created"],
    actions: ["New transit order"],
  },
  {
    path: "operations/delivery-notes",
    area: "Operations",
    title: "Delivery notes",
    purpose: "Proof-of-delivery documents — own register, also surfaced as a dossier tab.",
    module: "operations/delivery_note",
    status: "ready",
    columns: ["Ref", "Dossier", "Consignee", "Status", "Date"],
    actions: ["New delivery note"],
  },

  /* ───────────────────────────── Procurement ───────────────────────────── */
  {
    path: "procurement/purchase-requests",
    area: "Procurement",
    title: "Purchase requests",
    purpose: "Internal purchase requisitions with their own approval workflow — the start of procure-to-pay.",
    module: "procurement/purchase_request",
    status: "ready",
    columns: ["Ref", "Requester", "Department", "Status", "Amount", "Date"],
    actions: ["New request", "Submit", "Approve"],
  },
  {
    path: "procurement/purchase-orders",
    area: "Procurement",
    title: "Purchase orders",
    purpose: "Supplier POs raised from approved requests — the commitment leg of procure-to-pay.",
    module: "procurement/purchase_order",
    status: "ready",
    columns: ["Ref", "Supplier", "Status", "Total", "Date"],
    actions: ["New PO", "Approve", "Send"],
  },
  {
    path: "procurement/goods-received",
    area: "Procurement",
    title: "Goods received (GRN)",
    purpose: "Goods-receipt notes against a PO — the delivery leg feeding the three-way match.",
    module: "procurement/goods_received",
    status: "ready",
    columns: ["Ref", "PO", "Received by", "Status", "Date"],
    actions: ["Record GRN"],
  },
  {
    path: "procurement/supplier-invoices",
    area: "Procurement",
    title: "Supplier invoices",
    purpose: "AP invoices with a PR↔PO↔GRN↔invoice three-way match, WHT handling, and GL posting (KB §8.5).",
    module: "procurement/supplier_invoice",
    status: "ready",
    tabs: [
      { label: "Invoices", columns: ["Ref", "Supplier", "Amount", "WHT", "Status", "Date"], actions: ["New invoice", "Post"] },
      { label: "Three-way match", columns: ["Document", "PR", "PO", "GRN", "Match"] },
    ],
    ai: [
      { label: "List supplier invoices", kind: "read", describe: "List supplier invoices or fetch one with lines." },
      { label: "Run three-way match", kind: "assist", describe: "Run the three-way match (PR↔PO↔GRN↔invoice)." },
      { label: "Post to GL", kind: "write", describe: "Post to GL (Dr expense+VAT / Cr supplier net of WHT + WHT)." },
    ],
  },

  /* ───────────────────────────── Costing ───────────────────────────── */
  {
    path: "costing/costing",
    area: "Costing",
    title: "Dossier costing",
    purpose: "Job-costing sheet per dossier — budget, expected margin (débours excluded, §6.7).",
    module: "MOD-46",
    status: "ready",
    tabs: [
      { label: "Costing sheet", columns: ["Dossier", "Budget", "Expected margin", "Status"], actions: ["New costing", "Validate", "Approve"] },
      { label: "Cost tracking", columns: ["Line", "Budget", "Actual", "Variance"] },
    ],
    ai: [
      { label: "List / get costing", kind: "read", describe: "List dossier costings or fetch one with lines + computed margin." },
      { label: "Create / advance costing", kind: "write", describe: "Create a DRAFT costing, edit it, or advance (validate/approve/reject)." },
    ],
  },
  {
    path: "costing/cost-tracking",
    area: "Costing",
    title: "Cost tracking",
    purpose: "Actuals vs the costing sheet — record real costs and reconcile budget variance per dossier.",
    module: "MOD-47",
    status: "ready",
    columns: ["Dossier", "Budget", "Actual", "Variance", "Variance %"],
    actions: ["Record cost"],
    ai: [
      { label: "Reconcile dossier", kind: "assist", describe: "Budget vs actual reconciliation for a dossier (MOD-48)." },
      { label: "Record cost", kind: "write", describe: "Record an actual dossier cost and post it to the ledger (débours→4731)." },
    ],
  },
  {
    path: "costing/cash-requests",
    area: "Costing",
    title: "Cash requests",
    purpose: "Disbursement requests with their own approval + justification cycle (issues a régie advance).",
    module: "MOD-49",
    status: "ready",
    columns: ["Ref", "Requester", "Amount", "Status", "Date"],
    actions: ["New request", "Submit", "Approve", "Disburse", "Justify"],
    ai: [
      { label: "List / get cash requests", kind: "read", describe: "List cash requests / disbursals or fetch one with lines + payments." },
      { label: "Draft / transition request", kind: "write", describe: "Create, edit, submit/approve/reject a cash request." },
      { label: "Disburse / justify", kind: "write", describe: "Disburse (Dr 581 / Cr treasury) or record spend and close (JUSTIFIED)." },
    ],
  },
  {
    path: "costing/regie",
    area: "Costing",
    title: "Régie d'avances",
    purpose: "Cash-advance register — issue advances to holders, age unjustified ones back to receivable (KB §6.8).",
    module: "MOD-49",
    status: "ready",
    columns: ["Holder", "Advance", "Justified", "Outstanding", "Status"],
    actions: ["Issue advance", "Age advances"],
    ai: [
      { label: "List régie advances", kind: "read", describe: "List regie d'avances (cash advances)." },
      { label: "Issue / age advance", kind: "write", describe: "Issue a cash advance (Dr 581 / Cr 521) or reclassify unjustified advances past their window." },
    ],
  },

  /* ───────────────────────────── Finance (new) ───────────────────────────── */
  {
    path: "finance/debt",
    area: "Finance",
    title: "Financing & debt",
    purpose: "Loans from banks/directors/third parties — engagements, drawdowns, repayments and outstanding balance. BE basePath /financing (full CRUD + drawdown/repay).",
    module: "MOD-53",
    status: "ready",
    columns: ["Lender", "Type", "Principal", "Outstanding", "Rate", "Status"],
    actions: ["Record engagement", "Drawdown", "Repay"],
    ai: [
      { label: "List / get debt", kind: "read", describe: "List debt engagements or fetch one with repayments + outstanding." },
      { label: "Create / drawdown / repay", kind: "write", describe: "Record an engagement, post a drawdown (Dr treasury / Cr 162) or a repayment (Dr 162 + interest / Cr treasury)." },
    ],
  },

  /* ───────────────────────────── Master data ───────────────────────────── */
  {
    path: "master/clients",
    area: "Master data",
    title: "Clients",
    purpose: "Client master — the customer registry referenced across sales, operations and receivables.",
    module: "master/client_master",
    status: "ready",
    columns: ["Code", "Name", "NIU", "Segment", "Status"],
    actions: ["New client"],
  },
  {
    path: "master/suppliers",
    area: "Master data",
    title: "Suppliers",
    purpose: "Supplier master — the vendor registry referenced across procurement and payables.",
    module: "master/supplier_master",
    status: "ready",
    columns: ["Code", "Name", "NIU", "Category", "Status"],
    actions: ["New supplier"],
  },
  {
    path: "master/corporate-entities",
    area: "Master data",
    title: "Corporate entities",
    purpose: "The legal entities the tenant operates — used by treasury, tax and document numbering.",
    module: "MOD-01",
    status: "ready",
    columns: ["Code", "Legal name", "NIU", "RCCM", "Country", "Status"],
    actions: ["New entity", "Activate"],
  },
  {
    path: "master/expense-rates",
    area: "Master data",
    title: "Expense rates",
    purpose: "Reference rate cards (per-diems, mileage, standard charges) read by costing and cash requests.",
    module: "master/expense_rate",
    status: "ready",
    columns: ["Code", "Category", "Rate", "Unit", "Effective from"],
    actions: ["New rate"],
  },
  {
    path: "master/financial-dictionary",
    area: "Master data",
    title: "Financial dictionary",
    purpose: "Business term → account/mapping lookups that drive account determination and reporting labels.",
    module: "master/financial_dictionary",
    status: "ready",
    columns: ["Term", "Account", "Mapping", "Notes"],
    actions: ["New entry"],
  },

  /* ───────────────────────────── Vault ───────────────────────────── */
  {
    path: "vault/documents",
    area: "Vault",
    title: "Document vault",
    purpose: "Central document store with hashes for tamper-evidence. Read-only today — upload/delete are a BE gap.",
    module: "vault/document_vault",
    status: "readonly",
    tabs: [
      { label: "Documents", columns: ["Name", "Type", "Entity", "Uploaded", "Hash"], actions: ["Upload"] },
      { label: "Signatures", columns: ["Document", "Signer", "Status", "Signed at"], actions: ["Request signature"] },
    ],
  },
  {
    path: "vault/signatures",
    area: "Vault",
    title: "Document signatures",
    purpose: "E-signature requests and their status against vault documents.",
    module: "vault/document_signature",
    status: "partial",
    columns: ["Document", "Signer", "Status", "Requested", "Signed at"],
    actions: ["Request signature"],
  },
  {
    path: "vault/verification",
    area: "Vault",
    title: "Document verification",
    purpose: "QR/hash tamper check for issued documents. Backend module is incomplete (repo/validator missing).",
    module: "vault/document_verification",
    status: "partial",
    columns: ["Doc ID", "Entity ref", "Hash", "Result", "Checked"],
    actions: ["Verify document"],
    ai: [{ label: "Verify document", kind: "assist", describe: "Verify a document by doc_id/entity_ref + hash (QR tamper check)." }],
  },
  {
    path: "vault/compliance-flags",
    area: "Vault",
    title: "Compliance flags",
    purpose: "Compliance issues raised against entities/dossiers, with severity and resolution tracking.",
    module: "vault/compliance_flag",
    status: "ready",
    columns: ["Entity", "Flag", "Severity", "Raised", "Status"],
    actions: ["Raise flag", "Resolve"],
  },
  {
    path: "vault/reports",
    area: "Vault",
    title: "Reports",
    purpose: "The reporting catalogue — run OHADA statements and operational reports, save and pin them to the dashboard.",
    module: "MOD-63",
    status: "ready",
    tabs: [
      { label: "Catalogue", columns: ["Report", "Description", "Run"], actions: ["Run report"] },
      { label: "Saved", columns: ["Name", "Report", "Owner", "Created"], actions: ["Save current"] },
      { label: "Dashboard tiles", columns: ["Tile", "Position", "Visible"] },
    ],
    ai: [
      { label: "Report catalogue", kind: "read", describe: "List available reports and run one by key (statements, ageing, dossier 360…)." },
    ],
  },

  /* ───────────────────────────── Comms ───────────────────────────── */
  {
    path: "comms",
    area: "Communication",
    title: "Smart Comms",
    purpose: "Corporate messaging — channels (department/project/dossier/client), DMs, presence, certified export.",
    module: "smartcomm",
    status: "ready",
    tabs: [
      { label: "Channels", columns: ["Channel", "Type", "Members", "Unread", "Last activity"], actions: ["New channel"] },
      { label: "Direct", columns: ["With", "Unread", "Last activity"], actions: ["New message"] },
    ],
    ai: [
      { label: "My channels / unread", kind: "read", describe: "Channels the user belongs to, with unread counts." },
      { label: "Search messages", kind: "assist", describe: "Search messages across the user's channels." },
      { label: "Post message", kind: "write", describe: "Post a message to a channel." },
    ],
  },

  /* ───────────────────────────── Settings & Admin ───────────────────────────── */
  {
    path: "settings/catalogue",
    area: "Settings",
    title: "Module catalogue",
    purpose: "The MOD-xx module registry that feeds the permission grant-matrix. Read-only reference.",
    module: "MOD-67",
    status: "readonly",
    columns: ["Module", "Group", "Code", "Sort"],
  },
  {
    path: "settings/business-setup",
    area: "Settings",
    title: "Business setup",
    purpose: "Company profile, financial identity (NIU/RCCM), fiscal year and operational policies per corporate entity.",
    module: "MOD-01",
    status: "partial",
    tabs: [
      { label: "Profile", columns: ["Field", "Value"], actions: ["Edit"] },
      { label: "Financial identity", columns: ["Field", "Value"], actions: ["Edit"] },
      { label: "Fiscal year", columns: ["Field", "Value"], actions: ["Edit"] },
      { label: "Policies", columns: ["Policy", "Value"], actions: ["Edit"] },
    ],
  },
  {
    path: "settings/business-policies",
    area: "Settings",
    title: "Business policies",
    purpose: "Privacy, refund, QMS, terms and similar policy documents. No backend endpoint yet — BE dev to build.",
    module: "—",
    status: "none",
    columns: ["Policy", "Version", "Effective", "Updated"],
    actions: ["New policy"],
  },
  {
    path: "settings/custom-fields",
    area: "Settings",
    title: "Custom fields",
    purpose: "Per-entity custom field definitions. No backend endpoint yet — BE dev to build.",
    module: "—",
    status: "none",
    columns: ["Entity", "Field", "Type", "Required", "Default"],
    actions: ["New field"],
  },
  {
    path: "settings/factory-languages",
    area: "Settings",
    title: "Factory languages",
    purpose: "No-code translation manager for factory screens (FR/EN). No backend endpoint yet — BE dev to build.",
    module: "—",
    status: "none",
    columns: ["Key", "Screen", "FR", "EN"],
    actions: ["Add translation"],
  },
  {
    path: "settings/document-templates",
    area: "Settings",
    title: "Document templates",
    purpose: "Invoice/PO/receipt/contract letterhead templates. Only milestone/smartcomm templates exist today — BE gap.",
    module: "—",
    status: "none",
    columns: ["Template", "Type", "Entity", "Updated"],
    actions: ["New template"],
  },
  {
    path: "settings/email-signatures",
    area: "Settings",
    title: "Email signatures",
    purpose: "Per-staff email signature HTML. Endpoint exists per-user (app_user) but is admin-gated with no self-service route yet.",
    module: "MOD-67",
    status: "partial",
    columns: ["User", "Signature", "Updated"],
    actions: ["Edit signature"],
  },
  {
    path: "settings/help-center",
    area: "Settings",
    title: "Help center",
    purpose: "In-app guides and FAQs. No backend endpoint yet — BE dev to build (or static content).",
    module: "—",
    status: "none",
    columns: ["Guide", "Category", "Updated"],
  },
  {
    path: "portal/access",
    area: "Settings",
    title: "Portal access",
    purpose: "Grant scoped external access — clients see their dossiers/invoices, investors a board terminal, auditors a time-boxed view.",
    module: "portal",
    status: "ready",
    tabs: [
      { label: "Grants", columns: ["Party", "Type", "Scope", "Expires", "Status"], actions: ["Grant access", "Revoke"] },
      { label: "Client view", columns: ["Dossier", "Invoices", "Receivables ageing"] },
      { label: "Investor terminal", columns: ["Income statement", "Cash position"] },
    ],
    ai: [
      { label: "List grants", kind: "read", describe: "List active portal access grants (client/investor/auditor)." },
      { label: "Grant access", kind: "write", describe: "Grant a client/investor/auditor portal access (auditor time-boxed)." },
      { label: "Client / investor view", kind: "read", describe: "A client's scoped dossiers/invoices/ageing, or the investor income-statement + cash terminal." },
    ],
  },
];

export const SPECS_BY_PATH: Record<string, ScreenSpec> = SPECS.reduce(
  (acc, s) => {
    acc[s.path] = s;
    return acc;
  },
  {} as Record<string, ScreenSpec>,
);
