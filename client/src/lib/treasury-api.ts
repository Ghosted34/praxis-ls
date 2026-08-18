/**
 * Treasury master (MOD-09) — API types and fetchers for the extended
 * treasury_account + treasury_category + treasury-360 endpoints introduced by
 * the 0519 revamp.
 *
 * The old `TreasuryAccount` in `finance-api.ts` is intentionally kept as a
 * NARROW type ({ treasury_account_id, kind, label, coa_code }) — it feeds the
 * finance-hub cash-position donut and any other consumer that only needs
 * enough to render a row of the donut. This module carries the WIDE row
 * (with all the banking / cash / MoMo identity fields, category join, and
 * derived aggregates from the 360 endpoint) that the /master/treasury-accounts
 * pages render.
 */
import { tenant } from "./api-client";

/* ─────────────── categories (the user-editable registry) ─────────────── */

export type TreasuryCategory = {
  treasury_category_id: string;
  code: string; // 'BANK' | 'CASH' | 'PETTY_CASH' | 'MTN_MOMO' | 'ORANGE_MONEY' | tenant-added
  label: string;
  legacy_kind: "BANK" | "CASH" | "MOMO";
  coa_parent_code: string;
  requires_custodian: boolean;
  is_bank_identity: boolean;
  is_momo_identity: boolean;
  is_system: boolean;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export const listCategories = () =>
  tenant<TreasuryCategory[]>("/treasury-categories");

export const createCategory = (body: {
  code: string;
  label: string;
  legacy_kind: "BANK" | "CASH" | "MOMO";
  coa_parent_code: string;
  requires_custodian?: boolean;
  is_bank_identity?: boolean;
  is_momo_identity?: boolean;
}) =>
  tenant<TreasuryCategory>("/treasury-categories", { method: "POST", body });

export const setCategoryActive = (id: string, active: boolean) =>
  tenant<TreasuryCategory>(`/treasury-categories/${id}/active`, {
    method: "POST",
    body: { active },
  });

/* ─────────────── treasury account (wide, with category join) ─────────────── */

export type TreasuryAccountRich = {
  treasury_account_id: string;
  entity_id: string;
  category_id: string | null;
  kind: "BANK" | "CASH" | "MOMO";
  label: string;
  coa_code: string;
  currency: string;
  is_active: boolean;
  is_primary: boolean;
  is_verified: boolean;
  verified_by: string | null;
  verified_at: string | null;

  // Banking identity
  bank_name: string | null;
  branch: string | null;
  account_number: string | null;
  iban: string | null;
  swift_bic: string | null;
  routing_code: string | null;
  holder_name: string | null;

  // Opening + statement
  opening_balance: string | number | null;
  opening_date: string | null;
  statement_day: number | null;

  // Cash / petty
  custodian_user_id: string | null;
  location: string | null;
  float_limit: string | number | null;

  // MoMo
  momo_number: string | null;
  momo_till: string | null;
  momo_agent: string | null;
  momo_network: string | null;
  momo_fee_account: string | null;

  // Category join
  category_code?: string | null;
  category_label?: string | null;
  category_requires_custodian?: boolean | null;
  category_is_bank_identity?: boolean | null;
  category_is_momo_identity?: boolean | null;
  category_coa_parent_code?: string | null;

  created_at?: string;
  updated_at?: string;
};

export const listAccounts = (
  params: {
    entity_id?: string;
    category_id?: string;
    is_active?: boolean;
  } = {},
) => {
  const qs = new URLSearchParams();
  if (params.entity_id) qs.set("entity_id", params.entity_id);
  if (params.category_id) qs.set("category_id", params.category_id);
  if (params.is_active !== undefined)
    qs.set("is_active", String(params.is_active));
  const s = qs.toString();
  return tenant<TreasuryAccountRich[]>(
    "/treasury-accounts" + (s ? "?" + s : ""),
  );
};

export const getAccount = (id: string) =>
  tenant<TreasuryAccountRich>(`/treasury-accounts/${id}`);

export type CreateAccountBody = {
  entity_id: string;
  category_id: string;
  label: string;
  currency?: string;
  bank_name?: string;
  branch?: string;
  account_number?: string;
  iban?: string;
  swift_bic?: string;
  routing_code?: string;
  holder_name?: string;
  opening_balance?: number;
  opening_date?: string;
  statement_day?: number;
  custodian_user_id?: string;
  location?: string;
  float_limit?: number;
  momo_number?: string;
  momo_till?: string;
  momo_agent?: string;
  momo_network?: string;
  momo_fee_account?: string;
};

export const createAccount = (body: CreateAccountBody) =>
  tenant<TreasuryAccountRich>("/treasury-accounts", { method: "POST", body });

/**
 * PATCH body. Deliberately NOT `Partial<CreateAccountBody>`:
 *
 *   – `entity_id` and `category_id` are absent, because the service refuses
 *     them (the CoA leaf is already minted under the category's parent).
 *   – the optional identity fields accept `null`, because a correction often
 *     means "this field should be empty" — and `undefined` would leave the
 *     wrong value sitting in the row. The server validator marks the same
 *     fields `.nullable()`.
 *   – `opening_balance` and `currency` stay non-nullable: they are numeric /
 *     ISO-code columns with defaults, so they can be corrected but not blanked.
 */
export type UpdateAccountBody = {
  label?: string;
  currency?: string;
  bank_name?: string | null;
  branch?: string | null;
  account_number?: string | null;
  iban?: string | null;
  swift_bic?: string | null;
  routing_code?: string | null;
  holder_name?: string | null;
  opening_balance?: number;
  opening_date?: string | null;
  statement_day?: number | null;
  custodian_user_id?: string | null;
  location?: string | null;
  float_limit?: number | null;
  momo_number?: string | null;
  momo_till?: string | null;
  momo_agent?: string | null;
  momo_network?: string | null;
  momo_fee_account?: string | null;
};

export const updateAccount = (id: string, patch: UpdateAccountBody) =>
  tenant<TreasuryAccountRich>(`/treasury-accounts/${id}`, {
    method: "PATCH",
    body: patch,
  });

export const setAccountActive = (id: string, active: boolean) =>
  tenant<TreasuryAccountRich>(`/treasury-accounts/${id}/active`, {
    method: "POST",
    body: { active },
  });

export const setAccountPrimary = (id: string) =>
  tenant<TreasuryAccountRich>(`/treasury-accounts/${id}/primary`, {
    method: "POST",
  });

export const verifyAccount = (id: string) =>
  tenant<TreasuryAccountRich>(`/treasury-accounts/${id}/verify`, {
    method: "POST",
  });

export const unverifyAccount = (id: string) =>
  tenant<TreasuryAccountRich>(`/treasury-accounts/${id}/unverify`, {
    method: "POST",
  });

/* ─────────────── 360 dossier ─────────────── */

export type Kpis = {
  opening_balance: number;
  posted_net: number;
  balance: number;
  currency: string;
  debit_total: number;
  credit_total: number;
  mtd: { debit: number; credit: number; net: number };
  ytd: { debit: number; credit: number; net: number };
  unreconciled_count: number | null;
};

export type MovementLine = {
  line_id: string;
  entry_id: string;
  entry_date: string;
  entry_no: number;
  description: string | null;
  journal_code: string;
  source_doc_ref: string | null;
  debit: string | number;
  credit: string | number;
  currency: string;
  dossier_id: string | null;
  status: string;
};

export type MonthlyPoint = {
  period_code: string;
  debit: number;
  credit: number;
  net: number;
};

export type ReadinessItem = {
  key: string;
  label: string;
  ok: boolean;
  hint: string | null;
};
export type Readiness = {
  items: ReadinessItem[];
  done: number;
  total: number;
  percent: number;
};

export type Dossier = {
  account: TreasuryAccountRich;
  category: TreasuryCategory | null;
  coa_leaf: {
    code: string;
    parent_code: string;
    label_fr: string;
    label_en: string;
    class: number;
    is_postable: boolean;
    is_active: boolean;
  } | null;
  custodian: {
    user_id: string;
    full_name: string;
    email: string | null;
    phone: string | null;
    is_active: boolean;
  } | null;
  verifier: { user_id: string; full_name: string; email: string | null } | null;
  kpis: Kpis;
  last_debit: {
    amount: string | number;
    entry_date: string;
    description: string | null;
    entry_no: number;
    journal_code: string;
  } | null;
  last_credit: {
    amount: string | number;
    entry_date: string;
    description: string | null;
    entry_no: number;
    journal_code: string;
  } | null;
  monthly_series: MonthlyPoint[];
  recent_lines: MovementLine[];
  documents: unknown[];
  timeline: {
    audit_id: string;
    action: string;
    actor_user_id: string | null;
    before_snapshot: unknown;
    after_snapshot: unknown;
    occurred_at: string;
  }[];
  readiness: Readiness;
};

export const getDossier = (id: string) =>
  tenant<Dossier>(`/treasury-accounts/${id}/360`);
