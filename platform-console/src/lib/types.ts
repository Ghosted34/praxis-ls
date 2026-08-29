// Shapes returned by /api/platform (see src/services/platform/*.js).

export interface PlatformUser {
  platform_user_id: string;
  email: string;
  full_name: string;
  role: string;
  capabilities?: string[];
  is_active?: boolean;
  last_login_at?: string | null;
  created_at?: string;
}

export interface PlatformRole {
  role_id: string;
  code: string;
  name: string;
  is_system: boolean;
  capabilities: string[];
  user_count: number;
}

export interface LoginResult {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: string | number;
  user: PlatformUser;
}

export type TenantStatus = "PROVISIONING" | "LIVE" | "SUSPENDED" | "ARCHIVED" | string;

export interface TenantListRow {
  slug: string;
  display_name: string;
  status: TenantStatus;
  is_live: boolean;
  /** 0 = never auto-wipe (wipes are manual). >0 = auto-wipe cadence in days. */
  sandbox_wipe_days: number | null;
  last_sandbox_wipe_at: string | null;
  plan: string | null;
  db_name: string | null;
  capacity_tier: string | null;
  region: string | null;
  tenant_owned: boolean | null;
  subdomain: string | null;
  overrides: number | string | null;
}

export interface TenantDatabase {
  db_name?: string | null;
  region?: string | null;
  capacity_tier?: string | null;
  tenant_owned?: boolean | null;
  [k: string]: unknown;
}

export interface Subdomain {
  host: string;
  is_primary?: boolean | null;
  is_custom_domain?: boolean | null;
  /**
   * What this host serves. 'erp' is the tenant workspace — the default, and what
   * every host meant before 0103. 'public' is the marketing site and external
   * portal at that host's ROOT, with the staff workspace not served there at
   * all: the shape a tenant wants for a domain their own clients visit.
   */
  surface?: "erp" | "public" | null;
  /** Path prefix the marketing site is served at on this host — `/public`,
   *  `/site`. The portal is always `/portal` and is not settable. */
  public_base?: string | null;
  [k: string]: unknown;
}

export interface TenantDetail {
  slug: string;
  display_name: string;
  legal_name?: string;
  status: TenantStatus;
  is_live: boolean;
  /** 0 = never auto-wipe (wipes are manual). >0 = auto-wipe cadence in days. */
  sandbox_wipe_days: number | null;
  last_sandbox_wipe_at?: string | null;
  plan_code?: string | null;
  country_code?: string | null;
  created_at?: string | null;
  database: TenantDatabase | null;
  subdomains: Subdomain[];
  [k: string]: unknown;
}

export interface FeatureRow {
  feature_key: string;
  name: string | null;
  module_key: string | null;
  state: "on" | "off";
  source: "override" | "plan" | "default";
}

export interface Plan {
  // The endpoint selects `p.*`, so this has always been present — it simply was
  // never declared, which left it typed `unknown` via the index signature and
  // unusable as a value. WS-S3 needs it to attach entitlements to a plan.
  plan_id: string;
  code: string;
  name: string;
  description?: string | null;
  price_setup_xaf?: string | number | null;
  price_yearly_xaf?: string | number | null;
  is_active?: boolean | null;
  [k: string]: unknown;
}

export interface ModuleRow {
  module_key: string;
  name: string;
  phase?: string | number | null;
  sort_order?: number | null;
  description?: string | null;
  [k: string]: unknown;
}

export interface CatalogueFeature {
  feature_key: string;
  name: string;
  module_key: string | null;
  default_state?: "on" | "off" | null;
  description?: string | null;
  [k: string]: unknown;
}

export type TicketStatus = "NEW" | "TRIAGED" | "IN_PROGRESS" | "SHIPPED" | "DECLINED";
export type TicketKind = "SUPPORT" | "BUG" | "FEATURE";

export interface SupportTicket {
  ticket_id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  raised_by_email: string | null;
  kind: TicketKind;
  title: string;
  body: string | null;
  context: Record<string, unknown> | null;
  status: TicketStatus;
  csat: number | null;
  created_at: string;
  updated_at: string;
}

export interface AuditRow {
  audit_id: string | number;
  action: string;
  entity_ref: string | null;
  payload: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
  tenant_slug: string | null;
  tenant_name: string | null;
}
