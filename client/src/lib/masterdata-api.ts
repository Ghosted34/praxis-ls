/**
 * Master-data API helpers (typed) — clients, suppliers, corporate entities,
 * treasury accounts + payment gateways, expense rates, financial dictionary.
 * Routes/fields mirror src/modules/master/*. All calls go through `tenant()`.
 */
import { tenant } from "./api-client";

/* ── Clients(/clients) ──────────────────────────────────────────── */
export type Client = {
  client_id: string;
  entity_id?: string | null;
  name: string;
  client_type_id?: string | null;
  niu?: string | null;
  rccm?: string | null;
  email?: string | null;
  // 0480 — bill-to address. Neither master had one before, so the counterparty
  // side of an invoice could only carry a name and a tax number.
  address?: string | null;
  city?: string | null;
  country_code?: string | null;
  payment_terms_days?: number | null;
  credit_limit?: number | null;
  is_withholding_agent?: boolean;
  is_active: boolean;
};
// Country-first form blocks (PR3-B §2) — the service persists these as their
// own rows (party_registration / *_contact / *_address) in the create tx.
export type PartyRegistrationInput = { kind: string; number?: string; country_code?: string };
export type PartyContactInput = { name?: string; email?: string; phone?: string; role_tags?: string[] };
export type PartyAddressInput = { line1?: string; city?: string; region?: string; postal_code?: string; country_code?: string };

export type ClientInput = {
  name: string;
  entity_id?: string;
  client_type_id?: string;
  niu?: string;
  rccm?: string;
  registrations?: PartyRegistrationInput[];
  primary_contact?: PartyContactInput;
  primary_address?: PartyAddressInput;
  email?: string;
  address?: string;
  city?: string;
  country_code?: string;
  payment_terms_days?: number;
  credit_limit?: number;
  is_withholding_agent?: boolean;
  is_active?: boolean;
  // PR 2 extended fields (all optional; the shared schema owns validation).
  legal_name?: string;
  trading_name?: string;
  industry?: string;
  website?: string;
  notes?: string;
  risk_tier?: string;
  tax_residency_country?: string;
  default_currency?: string;
  registration_status?: string;
};
/** Extended master fields (PR 2) — present after the 0511 revamp; all optional
 *  so the existing list/table code keeps compiling against the same type. */
export type PartyExtras = {
  ref?: string | null;
  legal_name?: string | null;
  trading_name?: string | null;
  registration_status?: string | null;
  compliance_state?: string | null;
  verification_status?: string | null;
  coa_aux_account?: string | null;
  risk_tier?: string | null;
  industry?: string | null;
  website?: string | null;
  tax_residency_country?: string | null;
  default_currency?: string | null;
  hard_block_reason?: string | null;
  hard_blocked_at?: string | null;
  category_name?: string | null;
};

export const listClients = () => tenant<Client[]>("/clients");
export const getClientCredit = (id: string) =>
  tenant<{ credit_limit: number | null; outstanding: number; available: number | null }>(`/clients/${id}/credit`);
/* Client 360 rollups — receivables (overdue) + receipts. */
export type OverdueInvoice = { invoice_id: string; doc_number?: string | null; total_ttc: number; outstanding: number; payment_due_on?: string | null; days_overdue: number };
export type OverdueResult = { as_of: string; total: number; count: number; invoices: OverdueInvoice[] };
export const clientOverdue = (clientId: string) => tenant<OverdueResult>(`/receivables/overdue?client_id=${encodeURIComponent(clientId)}`);
export type Receipt = { receipt_id: string; client_id?: string | null; amount: number | string; method?: string | null; received_on?: string | null; status?: string | null };
export const clientReceipts = (clientId: string) => tenant<Receipt[]>(`/receivables?client_id=${encodeURIComponent(clientId)}`);

export const createClient = (body: ClientInput) => tenant<Client>("/clients", { method: "POST", body });
export const updateClient = (id: string, body: Partial<ClientInput>) =>
  tenant<Client>(`/clients/${id}`, { method: "PATCH", body });

/* ── Suppliers(/suppliers) ──────────────────────────────────────── */
export type Supplier = {
  supplier_id: string;
  entity_id?: string | null;
  name: string;
  supplier_type?: string | null;
  niu?: string | null;
  rccm?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country_code?: string | null;
  payment_method?: string | null;
  momo_network?: string | null;
  momo_number?: string | null;
  is_non_resident?: boolean;
  rating?: number | null;
  is_active: boolean;
};
export type SupplierInput = {
  name: string;
  entity_id?: string;
  supplier_type?: string;
  niu?: string;
  rccm?: string;
  registrations?: PartyRegistrationInput[];
  primary_contact?: PartyContactInput;
  primary_address?: PartyAddressInput;
  email?: string;
  address?: string;
  city?: string;
  country_code?: string;
  payment_method?: "BANK" | "CASH" | "MOBILE_MONEY" | "CHEQUE" | "BANK_TRANSFER";
  momo_network?: string;
  momo_number?: string;
  is_non_resident?: boolean;
  rating?: number;
  is_active?: boolean;
  // PR 2 extended fields.
  supplier_type_id?: string;
  legal_name?: string;
  trading_name?: string;
  industry?: string;
  website?: string;
  tax_residency_country?: string;
  default_currency?: string;
  withholding_rate?: number;
  registration_status?: string;
};
export const listSuppliers = () => tenant<Supplier[]>("/suppliers");
export const createSupplier = (body: SupplierInput) => tenant<Supplier>("/suppliers", { method: "POST", body });
export const updateSupplier = (id: string, body: Partial<SupplierInput>) =>
  tenant<Supplier>(`/suppliers/${id}`, { method: "PATCH", body });

/* ── Corporate entities(/entities) ──────────────────────────────── */
/** Bank details rendered on the entity's invoices / letterhead. Free-form jsonb
 *  server-side; these are the keys the document templates expect. */
export type BankBlock = {
  bank_name?: string;
  branch?: string;
  account_number?: string;
  iban?: string;
  swift?: string;
};
export type EntityLifecycle = "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED" | "ARCHIVED";
export type AccountingFramework = "OHADA" | "IFRS" | "IFRS_SME" | "US_GAAP" | "FR_PCG" | "UK_GAAP" | "LOCAL_OTHER";
export type EntityRelationship =
  | "HEADQUARTERS" | "SUBSIDIARY" | "BRANCH" | "REPRESENTATIVE_OFFICE"
  | "JOINT_VENTURE" | "ASSOCIATE" | "SPV";

export type Entity = {
  entity_id: string;
  code: string;
  legal_name: string;
  trading_name?: string | null;
  legal_form?: string | null;
  niu?: string | null;
  rccm?: string | null;
  country_code?: string | null;
  address?: string | null;
  description?: string | null;
  industry?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  headcount?: number | null;
  timezone?: string | null;
  incorporation_date?: string | null;
  incorporation_country?: string | null;
  incorporation_place?: string | null;
  dissolution_date?: string | null;
  share_capital?: number | string | null;
  share_capital_currency?: string | null;
  share_capital_paid_up?: number | string | null;
  bank_block?: BankBlock | null;
  logo_light_ref?: string | null;
  logo_dark_ref?: string | null;
  doc_prefix?: string | null;
  default_language?: string | null;
  fiscal_year_start_month?: number | null;
  accounting_framework?: AccountingFramework | null;
  default_currency?: string | null;
  default_tax_jurisdiction_id?: string | null;
  payroll_country?: string | null;
  numbering_reset?: "NEVER" | "ANNUAL" | "MONTHLY" | null;
  vat_registered?: boolean | null;
  parent_entity_id?: string | null;
  relationship_type?: EntityRelationship | null;
  ownership_percent?: number | string | null;
  consolidates?: boolean;
  is_group_parent?: boolean;
  registration_status?: EntityLifecycle | null;
  deactivation_reason?: string | null;
  status_changed_at?: string | null;
  is_active: boolean;
};
export type EntityInput = Partial<Omit<Entity, "entity_id" | "is_active">> & {
  code: string;
  legal_name: string;
};

/* Nested collections owned by an entity. */
export type EntityPerson = {
  person_id: string;
  role: "SHAREHOLDER" | "DIRECTOR" | "OFFICER" | "LEGAL_REPRESENTATIVE"
    | "AUTHORISED_SIGNATORY" | "BENEFICIAL_OWNER" | "STATUTORY_AUDITOR" | "SECRETARY";
  holder_type?: "PERSON" | "COMPANY";
  full_name: string;
  title?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  country_of_residence?: string | null;
  id_type?: string | null;
  id_number?: string | null;
  company_registration_number?: string | null;
  company_country?: string | null;
  holder_entity_id?: string | null;
  holder_entity_code?: string | null;
  holder_entity_name?: string | null;
  email?: string | null;
  phone?: string | null;
  share_class?: string | null;
  share_count?: number | string | null;
  share_nominal_value?: number | string | null;
  ownership_percent?: number | string | null;
  voting_percent?: number | string | null;
  is_pep?: boolean;
  is_primary_contact?: boolean;
  signature_limit_amount?: number | string | null;
  signature_limit_currency?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
  employee_id?: string | null;
  notes?: string | null;
  is_active?: boolean;
  /** Set when the caller lacks the governance grant — personal fields are stripped. */
  redacted?: boolean;
};
export type EntityContact = {
  contact_id: string; name: string; title?: string | null;
  email?: string | null; phone?: string | null; role_tags?: string[] | null;
  is_primary?: boolean; language?: string | null; timezone?: string | null; is_active?: boolean;
};
export type EntityAddress = {
  address_id: string;
  type: "REGISTERED" | "TRADING" | "BILLING" | "REMITTANCE" | "MAILING" | "WAREHOUSE" | "OTHER";
  line1?: string | null; line2?: string | null; city?: string | null; region?: string | null;
  postal_code?: string | null; country_code?: string | null; po_box?: string | null;
  is_primary?: boolean; is_active?: boolean;
};
export type EntityRegistration = {
  registration_id: string; country_code?: string | null; kind: string; number?: string | null;
  issuing_authority?: string | null; issued_on?: string | null; expires_on?: string | null;
  is_primary?: boolean; verified?: boolean; notes?: string | null;
};
export type EntityEstablishment = {
  establishment_id: string; code?: string | null; name: string;
  kind?: "HEAD_OFFICE" | "OFFICE" | "WAREHOUSE" | "TERMINAL" | "WORKSHOP" | "SITE" | "AGENCY" | "OTHER";
  country_code?: string | null; city?: string | null; address_line?: string | null;
  tax_office_ref?: string | null; registration_ref?: string | null; customs_office?: string | null;
  manager_employee_id?: string | null; opened_on?: string | null; closed_on?: string | null; is_active?: boolean;
};

export type CapTableFinding = { code: string; severity: "INFO" | "WARN"; message: string; person_id?: string };
export type CapTable = {
  as_of: string; holder_count: number; total_percent: number; total_shares: number;
  issued_capital: number; balanced: boolean; findings: CapTableFinding[]; redacted?: boolean;
};

/** The `/entities/:id/360` aggregation — everything the dossier page renders. */
export type Entity360 = {
  entity: Entity;
  structure: {
    parent_entity_id: string | null;
    relationship_type: EntityRelationship | null;
    ownership_percent: number | string | null;
    consolidates: boolean;
    is_group_parent: boolean;
    ancestors: { entity_id: string; code: string; legal_name: string; country_code?: string | null; depth: number }[];
    children: (Pick<Entity, "entity_id" | "code" | "legal_name" | "country_code" | "relationship_type"
      | "ownership_percent" | "consolidates" | "registration_status" | "is_active" | "accounting_framework">)[];
  };
  people: EntityPerson[];
  contacts: EntityContact[];
  addresses: EntityAddress[];
  registrations: EntityRegistration[];
  establishments: EntityEstablishment[];
  /** Read-only here: treasury accounts are owned by MOD-09 and created there. */
  treasury_accounts: Treasury[];
  treasury_is_read_only: boolean;
  cap_table: CapTable;
  usage: { journal_entries: number; employees: number; treasury_accounts: number; subsidiaries: number };
  letterhead_source: Record<string, unknown>;
  readiness: { ready: boolean; missing: { field: string; label: string }[] };
  expiring_registrations: { registration_id: string; kind: string; number?: string | null; expires_on: string; expired: boolean }[];
  can_see_governance: boolean;
};

export const listEntities = () => tenant<Entity[]>("/entities");
export const createEntity = (body: EntityInput) => tenant<Entity>("/entities", { method: "POST", body });
export const updateEntity = (id: string, body: Partial<EntityInput>) =>
  tenant<Entity>(`/entities/${id}`, { method: "PATCH", body });
export const setEntityActive = (id: string, active: boolean) =>
  tenant<Entity>(`/entities/${id}/active`, { method: "POST", body: { active } });
export const getEntity = (id: string) => tenant<Entity>(`/entities/${id}`);
export const entityDossier = (id: string) => tenant<Entity360>(`/entities/${id}/360`);
export const setEntityStatus = (id: string, status: EntityLifecycle, reason?: string) =>
  tenant<Entity>(`/entities/${id}/status`, { method: "POST", body: { status, reason } });
export const setEntityStructure = (id: string, body: Record<string, unknown>) =>
  tenant<Entity>(`/entities/${id}/structure`, { method: "POST", body });

/** Generic nested-collection helpers — one implementation for all five. */
export type EntityCollection = "people" | "contacts" | "addresses" | "registrations" | "establishments";
export const addEntityChild = <T,>(id: string, seg: EntityCollection, body: Record<string, unknown>) =>
  tenant<T>(`/entities/${id}/${seg}`, { method: "POST", body });
export const updateEntityChild = <T,>(id: string, seg: EntityCollection, childId: string, body: Record<string, unknown>) =>
  tenant<T>(`/entities/${id}/${seg}/${childId}`, { method: "PATCH", body });
export const deleteEntityChild = (id: string, seg: EntityCollection, childId: string) =>
  tenant<{ deleted: boolean }>(`/entities/${id}/${seg}/${childId}`, { method: "DELETE" });
/** Upload a per-entity letterhead logo (base64 data URL). MOD-01 edit — not the
 *  MOD-70-gated /branding/logo. Returns the updated entity with the /media URL. */
export const uploadEntityLogo = (id: string, dataUrl: string, variant: "light" | "dark" = "light") =>
  tenant<Entity>(`/entities/${id}/logo`, { method: "POST", body: { data_url: dataUrl, variant } });

/* ── Treasury accounts(/treasury-accounts) ──────────────────────── */
export type Treasury = {
  treasury_account_id: string;
  entity_id?: string | null;
  kind: string;
  label: string;
  coa_code: string;
  currency?: string;
  momo_network?: string | null;
  momo_fee_account?: string | null;
  is_active: boolean;
};
export type TreasuryInput = {
  entity_id: string;
  kind: "BANK" | "CASH" | "MOMO";
  label: string;
  coa_code: string;
  currency?: string;
  momo_network?: string;
  momo_fee_account?: string;
};
export const listTreasury = () => tenant<Treasury[]>("/treasury-accounts");
export const createTreasury = (body: TreasuryInput) => tenant<Treasury>("/treasury-accounts", { method: "POST", body });
export const updateTreasury = (id: string, body: Partial<TreasuryInput>) =>
  tenant<Treasury>(`/treasury-accounts/${id}`, { method: "PATCH", body });
export const setTreasuryActive = (id: string, active: boolean) =>
  tenant<Treasury>(`/treasury-accounts/${id}/active`, { method: "POST", body: { active } });

/* ── Payment gateways(/payment-gateways) — credentials write-only ── */
export type Gateway = {
  provider: string;
  active: boolean;
  role?: string | null;
  has_credentials: boolean;
  updated_at?: string;
};
export type GatewayInput = { provider: string; active?: boolean; role?: string | null; credentials?: string };
export const listGateways = () => tenant<Gateway[]>("/payment-gateways");
export const upsertGateway = (body: GatewayInput) => tenant<Gateway>("/payment-gateways", { method: "POST", body });
export const setGatewayActive = (provider: string, active: boolean) =>
  tenant<Gateway>(`/payment-gateways/${provider}/active`, { method: "PATCH", body: { active } });
export const setGatewayRole = (provider: string, role: string) =>
  tenant<Gateway>(`/payment-gateways/${provider}/role`, { method: "PATCH", body: { role } });
export const deleteGateway = (provider: string) =>
  tenant<{ deleted: boolean }>(`/payment-gateways/${provider}`, { method: "DELETE" });

/* ── Expense rates(/expense-rates) ──────────────────────────────── */
export type ExpenseRate = {
  expense_rate_id: string;
  dictionary_item_id: string;
  shipping_line: string;
  variant?: string | null;
  rate: number;
  currency?: string;
  effective_from?: string | null;
  effective_to?: string | null;
};
export type ExpenseRateInput = {
  dictionary_item_id: string;
  shipping_line: string;
  variant?: string;
  rate: number;
  currency?: string;
  effective_from?: string;
  effective_to?: string;
};
export const listExpenseRates = () => tenant<ExpenseRate[]>("/expense-rates");
export const createExpenseRate = (body: ExpenseRateInput) =>
  tenant<ExpenseRate>("/expense-rates", { method: "POST", body });
export const updateExpenseRate = (id: string, body: Partial<ExpenseRateInput>) =>
  tenant<ExpenseRate>(`/expense-rates/${id}`, { method: "PATCH", body });
export const deleteExpenseRate = (id: string) =>
  tenant<{ deleted: boolean }>(`/expense-rates/${id}`, { method: "DELETE" });

/* ── Financial dictionary(/financial-dictionary) ────────────────── */
export type PostingRule = {
  applies_context: "sale" | "purchase" | "disbursement";
  debit_account?: string;
  credit_account?: string;
  tax_code_id?: string;
  is_debours?: boolean;
};
export type DictItem = {
  dictionary_item_id: string;
  code: string;
  label_fr?: string;
  label_en?: string | null;
  category: string;
  currency?: string;
  is_debours?: boolean;
  default_price?: number | null;
  service_type_key?: string | null;
  is_active: boolean;
};
export type DictInput = {
  code: string;
  label_fr: string;
  label_en?: string;
  description?: string;
  category: "debours" | "service" | "overhead" | "asset" | "other";
  is_debours?: boolean;
  default_price?: number;
  currency?: string;
  shipping_line?: string;
  service_type_key?: string;
  posting_rules: PostingRule[];
  is_active?: boolean;
};
export const listDict = () => tenant<DictItem[]>("/financial-dictionary");
export const getDict = (id: string) =>
  tenant<DictItem & { posting_rules: PostingRule[] }>(`/financial-dictionary/${id}`);
export const createDict = (body: DictInput) => tenant<DictItem>("/financial-dictionary", { method: "POST", body });
export const updateDict = (id: string, body: Partial<DictInput>) =>
  tenant<DictItem>(`/financial-dictionary/${id}`, { method: "PATCH", body });

/* ── Currencies(/currencies) — for selects ──────────────────────── */
export type Currency = { code: string; name?: string; symbol?: string | null; is_active?: boolean };
export const listCurrencies = () => tenant<Currency[]>("/currencies");

/* ── Tax codes(/tax-jurisdictions/:id/codes) — for line-item pickers ──
 * There is no flat tax-code endpoint, so aggregate across jurisdictions and
 * expose the sales-applicable VAT codes for quotation / invoice line pickers. */
export type TaxCode = {
  tax_code_id: string;
  code: string;
  kind: string;
  rate_percent?: number | null;
  applies_to?: string | null;
};
type Jurisdiction = { jurisdiction_id: string };
export async function listSalesTaxCodes(): Promise<TaxCode[]> {
  const jurs = await tenant<Jurisdiction[]>("/tax-jurisdictions").catch(() => []);
  const perJur = await Promise.all(
    (jurs || []).map((j) => tenant<TaxCode[]>(`/tax-jurisdictions/${j.jurisdiction_id}/codes`).catch(() => [])),
  );
  const flat = perJur.flat();
  // VAT codes that apply to sales (or don't scope applies_to). Deduped by id.
  const seen = new Set<string>();
  return flat.filter((c) => {
    if (c.kind !== "VAT") return false;
    if (c.applies_to && c.applies_to !== "sales") return false;
    if (seen.has(c.tax_code_id)) return false;
    seen.add(c.tax_code_id);
    return true;
  });
}

/* ═══════════════ Party 360° revamp (PR 2) — src/modules/master ═══════════════ */

export type PartyKind = "client" | "supplier";
const base = (kind: PartyKind) => (kind === "client" ? "/clients" : "/suppliers");

/* ── Dynamic registries ─────────────────────────────────────────── */
export type Registry = { code: string; name: string; is_system?: boolean; is_active?: boolean };
export type ClientType = Registry & { client_type_id: string };
export type SupplierType = Registry & { supplier_type_id: string };
export type DocumentType = Registry & {
  document_type_id: string;
  applies_to: "CLIENT" | "SUPPLIER" | "BOTH";
  requires_expiry?: boolean;
  requires_issuing_authority?: boolean;
  default_severity?: string;
};
export const listClientTypes = () => tenant<ClientType[]>("/client-types");
export const createClientType = (body: { code: string; name: string }) => tenant<ClientType>("/client-types", { method: "POST", body });
export const updateClientType = (id: string, body: Partial<ClientType>) => tenant<ClientType>(`/client-types/${id}`, { method: "PATCH", body });
export const listSupplierTypes = () => tenant<SupplierType[]>("/supplier-types");
export const createSupplierType = (body: { code: string; name: string }) => tenant<SupplierType>("/supplier-types", { method: "POST", body });
export const updateSupplierType = (id: string, body: Partial<SupplierType>) => tenant<SupplierType>(`/supplier-types/${id}`, { method: "PATCH", body });
export const listDocumentTypes = (appliesTo?: "CLIENT" | "SUPPLIER") =>
  tenant<DocumentType[]>(`/party-document-types${appliesTo ? `?applies_to=${appliesTo}` : ""}`);
export const createDocumentType = (body: { code: string; name: string; applies_to?: string; default_severity?: string }) =>
  tenant<DocumentType>("/party-document-types", { method: "POST", body });
export const updateDocumentType = (id: string, body: Partial<DocumentType>) =>
  tenant<DocumentType>(`/party-document-types/${id}`, { method: "PATCH", body });

/* ── Countries (reference) ──────────────────────────────────────── */
export type RegistrationRequirement = { kind: string; label_en: string; label_fr: string; regex: string; placeholder: string; required: boolean };
export type CountryProfile = { code: string; name: string; phone: string; currency: string; sort_order: number; registration_requirements: RegistrationRequirement[] };
export const listCountries = () => tenant<CountryProfile[]>("/countries");

/* ── Field-requirement config (§5) ──────────────────────────────── */
export type FieldConfigRow = {
  applies_to: "CLIENT" | "SUPPLIER";
  field_key: string;
  field_group: string | null;
  is_required: boolean;
  is_visible: boolean;
  is_custom?: boolean;
  sort_order: number;
  label_override?: string | null;
};
export type MasterConfig = { applies_to: string; groups: string[]; fields: FieldConfigRow[] };
export const getMasterConfig = (appliesTo: "CLIENT" | "SUPPLIER") => tenant<MasterConfig>(`/master-config/${appliesTo}`);
export const putMasterConfig = (appliesTo: "CLIENT" | "SUPPLIER", fields: FieldConfigRow[]) =>
  tenant<MasterConfig>(`/master-config/${appliesTo}`, { method: "PUT", body: { fields } });

/* ── Nested collections (contacts / addresses / banks / documents / … ) ── */
export type Contact = { contact_id: string; name: string; title?: string | null; email?: string | null; phone?: string | null; role_tags?: string[]; is_primary?: boolean; is_active?: boolean };
export type Address = { address_id: string; line1?: string | null; line2?: string | null; city?: string | null; region?: string | null; postal_code?: string | null; country_code?: string | null; type?: string | null; is_primary?: boolean; is_active?: boolean };
export type BankAccount = { bank_account_id: string; beneficiary_name?: string | null; bank_name?: string | null; branch?: string | null; account_number?: string | null; iban?: string | null; swift_bic?: string | null; currency?: string | null; momo_network?: string | null; momo_number?: string | null; is_primary?: boolean; is_verified?: boolean; is_active?: boolean; masked?: boolean };
export type PartyDocument = { document_id: string; document_type_id?: string | null; document_type_name?: string | null; document_number?: string | null; issuing_authority?: string | null; issued_on?: string | null; expires_on?: string | null; vault_id?: string | null; scan_status?: string; physical_ref?: string | null; scan_due_on?: string | null; verification_status?: string; default_severity?: string };
export type Registration = { registration_id: string; country_code?: string | null; kind: string; number?: string | null; issuing_authority?: string | null; issued_on?: string | null; expires_on?: string | null; verified?: boolean };
export type BeneficialOwner = { owner_id: string; full_name: string; date_of_birth?: string | null; nationality?: string | null; id_type?: string | null; id_number?: string | null; ownership_percent?: number | null; is_pep?: boolean; notes?: string | null };

/** Generic nested-resource CRUD — one set of helpers for every child collection,
 *  keyed by the URL segment. The parent id is always in the path. */
function nested<T>(seg: string) {
  return {
    list: (kind: PartyKind, id: string) => tenant<T[]>(`${base(kind)}/${id}/${seg}`),
    create: (kind: PartyKind, id: string, body: Partial<T>) => tenant<T>(`${base(kind)}/${id}/${seg}`, { method: "POST", body }),
    update: (kind: PartyKind, id: string, childId: string, body: Partial<T>) => tenant<T>(`${base(kind)}/${id}/${seg}/${childId}`, { method: "PATCH", body }),
    remove: (kind: PartyKind, id: string, childId: string) => tenant<{ deleted: boolean }>(`${base(kind)}/${id}/${seg}/${childId}`, { method: "DELETE" }),
  };
}
export const contacts = nested<Contact>("contacts");
export const addresses = nested<Address>("addresses");
export const banks = nested<BankAccount>("banks");
export const documents = nested<PartyDocument>("documents");
export const registrations = nested<Registration>("registrations");
export const beneficialOwners = nested<BeneficialOwner>("beneficial-owners");

/* ── 360° dossier ───────────────────────────────────────────────── */
export type ComplianceFlag = { flag_id: string; rule_key: string; severity: string; message?: string | null; created_at?: string; onboarding?: boolean };
export type Compliance = { compliance_state: string; can_verify: boolean; flags: ComplianceFlag[] };
export type GlParity = { docTotal: number; gl: number; mismatch: number; flagged: boolean };
export type Aging = { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };

export type Client360 = {
  party: Client & PartyExtras;
  kpis: { outstanding: number; overdue: number; oldest_due_date?: string | null; credit_limit: number | null; credit_available: number | null; ytd_revenue: number; dossiers_in_progress: number; aging: Aging };
  compliance: Compliance;
  gl_parity: GlParity;
  contacts: Contact[]; addresses: Address[]; banks: BankAccount[]; documents: PartyDocument[]; registrations: Registration[]; beneficial_owners: BeneficialOwner[];
  dossiers: { dossier_id: string; ref?: string | null; title?: string | null; status?: string | null; created_at?: string }[];
  invoices: { invoice_id: string; doc_number?: string | null; type?: string; total_ttc: number; status?: string; payment_due_on?: string | null }[];
  receipts: Receipt[];
  advances: { advance_id: string; amount: number | string; applied_amount?: number | string | null; received_on?: string | null }[];
};
export type Supplier360 = {
  party: Supplier & PartyExtras & { avl_status?: string | null; withholding_rate?: number | null };
  kpis: { payables: number; overdue_payables: number; oldest_due_date?: string | null; ytd_spend: number; open_purchase_orders: number };
  compliance: Compliance;
  gl_parity: GlParity;
  contacts: Contact[]; addresses: Address[]; banks: BankAccount[]; documents: PartyDocument[]; registrations: Registration[]; beneficial_owners: BeneficialOwner[];
  purchase_orders: { po_id: string; doc_number?: string | null; total_ttc?: number | null; status?: string; created_at?: string }[];
  supplier_invoices: { supplier_invoice_id: string; doc_number?: string | null; amount_ttc?: number | null; wht_total?: number | null; status?: string; due_on?: string | null }[];
};
export const clientDossier = (id: string) => tenant<Client360>(`/clients/${id}/360`);
export const supplierDossier = (id: string) => tenant<Supplier360>(`/suppliers/${id}/360`);

/* ── Lifecycle actions ──────────────────────────────────────────── */
export const blockParty = (kind: PartyKind, id: string, reason: string) => tenant(`${base(kind)}/${id}/block`, { method: "POST", body: { reason } });
export const unblockParty = (kind: PartyKind, id: string) => tenant(`${base(kind)}/${id}/unblock`, { method: "POST" });
export const verifyParty = (kind: PartyKind, id: string) => tenant(`${base(kind)}/${id}/verify`, { method: "POST" });
export const activateParty = (kind: PartyKind, id: string) =>
  (kind === "client" ? updateClient(id, { registration_status: "ACTIVE" } as Partial<ClientInput>) : updateSupplier(id, { registration_status: "ACTIVE" } as Partial<SupplierInput>));
/** Smart Copy — a supplier id → a draft client, or a client id → a draft supplier. */
export const convertFromSupplier = (supplierId: string) => tenant<Client>(`/clients/convert-from-supplier/${supplierId}`, { method: "POST" });
export const convertFromClient = (clientId: string) => tenant<Supplier>(`/suppliers/convert-from-client/${clientId}`, { method: "POST" });
