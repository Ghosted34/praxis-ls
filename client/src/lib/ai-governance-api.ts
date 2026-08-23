/**
 * AI Control / governance API — the admin surface for the AI subsystem
 * (feature flags incl. the global AI on/off, per-user access grants, spend caps,
 * vendor keys). Gated server-side by MOD-70 (Settings) view/edit. See doc/AI_ARCHITECTURE.md §6.
 */
import { tenant } from "./api-client";

export type FeatureFlag = {
  feature_key: string;
  description?: string | null;
  is_enabled: boolean;
  default_provider?: string | null;
  default_model?: string | null;
  est_cost_per_call_xaf?: number | null;
  last_changed_at?: string | null;
};
export const listFeatures = () =>
  tenant<FeatureFlag[]>("/ai/governance/features");
export const setFeature = (
  key: string,
  patch: Partial<
    Pick<
      FeatureFlag,
      "is_enabled" | "description" | "default_provider" | "default_model"
    >
  >,
) =>
  tenant<FeatureFlag>(`/ai/governance/features/${key}`, {
    method: "PATCH",
    body: patch,
  });

export type Grant = {
  grant_id?: string;
  user_id: string;
  feature_key: string;
  monthly_cap_xaf?: number | null;
  granted_at?: string | null;
  revoked_at?: string | null;
};
export const listGrants = (userId?: string) =>
  tenant<Grant[]>(`/ai/governance/grants${userId ? `?user_id=${userId}` : ""}`);
export const grantAccess = (body: {
  user_id: string;
  feature_key: string;
  monthly_cap_xaf?: number;
}) => tenant<Grant>("/ai/governance/grants", { method: "POST", body });
export const revokeAccess = (body: {
  user_id: string;
  feature_key: string;
  reason?: string;
}) =>
  tenant<{ ok: boolean }>("/ai/governance/grants/revoke", {
    method: "POST",
    body,
  });

export type Budget = {
  period_start?: string | null;
  period_end?: string | null;
  soft_cap_xaf?: number | null;
  hard_cap_xaf?: number | null;
  state?: string | null;
  spent_xaf?: number | null;
};
export const getBudget = () => tenant<Budget>("/ai/governance/budget");
export const setBudget = (body: {
  period_start: string;
  period_end: string;
  soft_cap_xaf: number;
  hard_cap_xaf: number;
}) => tenant<Budget>("/ai/governance/budget", { method: "POST", body });

export type UsageRow = {
  /** The ledger column is `occurred_at`; `created_at` never existed on it. */
  occurred_at?: string | null;
  created_at?: string | null;
  feature_key?: string | null;
  provider?: string | null;
  model?: string | null;
  cost_xaf?: number | string | null;
  /** Vendor-currency cost — shown when no FX rate resolved cost_xaf. */
  cost_native?: number | string | null;
  cost_native_currency?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  was_successful?: boolean | null;
  [k: string]: unknown;
};
export const listUsage = () => tenant<UsageRow[]>("/ai/governance/usage");

export type Vendor = {
  vendor: string;
  display_name?: string | null;
  endpoint_url?: string | null;
  default_model?: string | null;
  current_model?: string | null;
  is_active?: boolean;
  per_vendor_monthly_cap_xaf?: number | null;
  has_key?: boolean;
  last_rotated_at?: string | null;
  /** List price per 1k tokens, in `cost_native_currency` — what Usage bills. */
  cost_per_1k_input_tokens?: number | string | null;
  cost_per_1k_output_tokens?: number | string | null;
  cost_per_audio_minute?: number | string | null;
  cost_native_currency?: string | null;
};
export const listVendors = () => tenant<Vendor[]>("/ai/governance/vendors");
export const setVendor = (
  vendor: string,
  body: {
    api_key?: string;
    display_name?: string;
    endpoint_url?: string;
    default_model?: string;
    is_active?: boolean;
    cost_per_1k_input_tokens?: number;
    cost_per_1k_output_tokens?: number;
    cost_per_audio_minute?: number;
    cost_native_currency?: string;
  },
) =>
  tenant<Vendor>(`/ai/governance/vendors/${vendor}`, { method: "PUT", body });
export const testVendor = (vendor: string) =>
  tenant<{ ok: boolean; message?: string }>(
    `/ai/governance/vendors/${vendor}/test`,
    { method: "POST" },
  );
