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
  payment_terms_days?: number | null;
  credit_limit?: number | null;
  is_withholding_agent?: boolean;
  is_active: boolean;
};
export type ClientInput = {
  name: string;
  entity_id?: string;
  client_type_id?: string;
  niu?: string;
  rccm?: string;
  payment_terms_days?: number;
  credit_limit?: number;
  is_withholding_agent?: boolean;
  is_active?: boolean;
};
export const listClients = () => tenant<Client[]>("/clients");
export const getClientCredit = (id: string) =>
  tenant<{ credit_limit: number | null; outstanding: number; available: number | null }>(`/clients/${id}/credit`);
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
  payment_method?: "BANK" | "CASH" | "MOBILE_MONEY" | "CHEQUE";
  momo_network?: string;
  momo_number?: string;
  is_non_resident?: boolean;
  rating?: number;
  is_active?: boolean;
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
export type Entity = {
  entity_id: string;
  code: string;
  legal_name: string;
  niu?: string | null;
  rccm?: string | null;
  country_code?: string | null;
  address?: string | null;
  bank_block?: BankBlock | null;
  logo_light_ref?: string | null;
  logo_dark_ref?: string | null;
  doc_prefix?: string | null;
  default_language?: string | null;
  fiscal_year_start_month?: number | null;
  is_active: boolean;
};
export type EntityInput = {
  code: string;
  legal_name: string;
  niu?: string;
  rccm?: string;
  country_code?: string;
  address?: string | null;
  bank_block?: BankBlock;
  logo_light_ref?: string | null;
  logo_dark_ref?: string | null;
  doc_prefix?: string;
  default_language?: string;
  fiscal_year_start_month?: number;
};
export const listEntities = () => tenant<Entity[]>("/entities");
export const createEntity = (body: EntityInput) => tenant<Entity>("/entities", { method: "POST", body });
export const updateEntity = (id: string, body: Partial<EntityInput>) =>
  tenant<Entity>(`/entities/${id}`, { method: "PATCH", body });
export const setEntityActive = (id: string, active: boolean) =>
  tenant<Entity>(`/entities/${id}/active`, { method: "POST", body: { active } });
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
