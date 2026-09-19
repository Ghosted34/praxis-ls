/**
 * Website settings — `GET/PUT/POST/PATCH/DELETE /site-settings/*`, gated
 * server-side by MOD-29 view/edit.
 *
 * ── THE PALETTE IS DERIVED SERVER-SIDE, AND THE PREVIEW READS THAT ─────────
 *
 * `getThemePreview()` returns the SAME payload the public site paints from
 * (`GET /public/site/theme`), computed by the same call to the same engine.
 * That is deliberate and it is the whole reason there is no palette maths in
 * this app: a preview that derived its own tokens would eventually disagree
 * with the site, and the tenant would find out from a screenshot somebody sent
 * them rather than from us.
 *
 * ── `corrections` IS NOT DIAGNOSTIC OUTPUT ─────────────────────────────────
 *
 * It travels with the palette so the screen can tell a tenant, in words, that
 * their orange measures 3.1:1 as text on white and what it became. A tenant who
 * understands the correction stops fighting it; one who does not keeps
 * re-entering the colour and filing a bug.
 */
import { siteSettings } from "@praxis/shared";
import { tenant, tenantWithProgress } from "./api-client";

/* ── theme ──────────────────────────────────────────────────────────────────*/

export type SiteTheme = {
  primary_hex: string;
  secondary_hex: string | null;
  tertiary_hex: string | null;
  font_display: string;
  font_body: string;
  font_mono: string;
  radius_px: number;
  default_mode: "light" | "dark";
};

/** One value the engine changed, and the measured reason it had to. */
export type PaletteCorrection = {
  theme: "light" | "dark";
  token: string;
  from: string;
  to: string;
  fromRatio?: number;
  toRatio?: number;
  reason: string;
};

export type ThemePreview = {
  input: { primary: string; secondary: string | null; tertiary: string | null };
  fonts: { display: string; body: string; mono: string };
  radius: string;
  defaultMode: "light" | "dark";
  light: Record<string, string>;
  dark: Record<string, string>;
  corrections: PaletteCorrection[];
  derived: { secondary: boolean; tertiary: boolean };
};

export const getTheme = () => tenant<SiteTheme>("/site-settings/theme");
export const getThemePreview = () => tenant<ThemePreview>("/site-settings/theme/preview");
export const saveTheme = (body: SiteTheme) =>
  tenant<SiteTheme>("/site-settings/theme", { method: "PUT", body });

/* ── social ─────────────────────────────────────────────────────────────────*/

export type SocialLink = { platform: string; url: string };

export const listSocial = () => tenant<SocialLink[]>("/site-settings/social");
/** The whole set at once — blank removes. See the service: absence is the empty
 *  state, and an empty-string row would put a footer icon linking nowhere. */
export const saveSocial = (links: Record<string, string>) =>
  tenant<SocialLink[]>("/site-settings/social", { method: "PUT", body: links });

/* ── partners and credentials ───────────────────────────────────────────────*/

export type PartnerKind = "carrier" | "client" | "network";

export type Partner = {
  partner_id: string;
  name: string;
  kind: PartnerKind;
  url: string | null;
  logo_vault_id: string | null;
  /** Who cleared this mark, and when. The server refuses `is_active` without
   *  it, and a CHECK constraint refuses it again. */
  permission_note: string | null;
  sort_order: number;
  is_active: boolean;
};

export type Credential = {
  credential_id: string;
  name: string;
  issuer: string | null;
  identifier: string | null;
  issued_on: string | null;
  expires_on: string | null;
  url: string | null;
  logo_vault_id: string | null;
  sort_order: number;
  is_active: boolean;
};

export const listPartners = () => tenant<Partner[]>("/site-settings/partners");
export const createPartner = (body: Partial<Partner>) =>
  tenant<Partner>("/site-settings/partners", { method: "POST", body });
export const updatePartner = (id: string, body: Partial<Partner>) =>
  tenant<Partner>(`/site-settings/partners/${id}`, { method: "PATCH", body });
export const deletePartner = (id: string) =>
  tenant(`/site-settings/partners/${id}`, { method: "DELETE" });

export const listCredentials = () => tenant<Credential[]>("/site-settings/credentials");
export const createCredential = (body: Partial<Credential>) =>
  tenant<Credential>("/site-settings/credentials", { method: "POST", body });
export const updateCredential = (id: string, body: Partial<Credential>) =>
  tenant<Credential>(`/site-settings/credentials/${id}`, { method: "PATCH", body });
export const deleteCredential = (id: string) =>
  tenant(`/site-settings/credentials/${id}`, { method: "DELETE" });

/* ── about and leadership ───────────────────────────────────────────────────*/

export type BilingualItem = {
  label_fr?: string | null;
  label_en?: string | null;
  text_fr?: string | null;
  text_en?: string | null;
};

export type EsgPillar = {
  text_fr?: string | null;
  text_en?: string | null;
  points?: { fr?: string | null; en?: string | null }[];
};

export type SiteAbout = {
  headline_fr: string | null;
  headline_en: string | null;
  summary_fr: string | null;
  summary_en: string | null;
  mission_fr: string | null;
  mission_en: string | null;
  vision_fr: string | null;
  vision_en: string | null;
  principles: BilingualItem[];
  /** Three fixed pillars, never an open bag — the renderer builds a
   *  three-panel interactive and cannot guess at a fourth. */
  esg: { environment?: EsgPillar; social?: EsgPillar; governance?: EsgPillar };
  timeline: (BilingualItem & { year: number })[];
  founded_year: number | null;
  headquarters: string | null;
};

export type Leader = {
  leader_id: string;
  /** null means GROUP leadership. The nullable field is the two-tier
   *  mechanism — see migration 13786. */
  entity_id: string | null;
  full_name: string;
  role_fr: string | null;
  role_en: string | null;
  bio_fr: string | null;
  bio_en: string | null;
  photo_vault_id: string | null;
  linkedin_url: string | null;
  sort_order: number;
  is_active: boolean;
};

export const getAbout = () => tenant<SiteAbout>("/site-settings/about");
export const saveAbout = (body: Partial<SiteAbout>) =>
  tenant<SiteAbout>("/site-settings/about", { method: "PUT", body });

/* ── careers (13792) ────────────────────────────────────────────────────────*/

/**
 * The two switches on the public careers page, and the tag that feeds its
 * culture strip.
 *
 * No COPY here on purpose: every sentence on that page is already rewritable
 * through Settings › Website › Wording (13790's `copy_overrides`), so a
 * headline field on this screen would be a second place to say the same thing
 * and the first opportunity for the two to disagree.
 */
export type SiteCareers = {
  open_applications: boolean;
  alerts_enabled: boolean;
  culture_tag: string | null;
  updated_at?: string | null;
};

export const getCareers = () => tenant<SiteCareers>("/site-settings/careers");
export const saveCareers = (body: Partial<SiteCareers>) =>
  tenant<SiteCareers>("/site-settings/careers", { method: "PUT", body });

export const listLeaders = () => tenant<Leader[]>("/site-settings/leaders");
export const createLeader = (body: Partial<Leader>) =>
  tenant<Leader>("/site-settings/leaders", { method: "POST", body });
export const updateLeader = (id: string, body: Partial<Leader>) =>
  tenant<Leader>(`/site-settings/leaders/${id}`, { method: "PATCH", body });
export const deleteLeader = (id: string) =>
  tenant(`/site-settings/leaders/${id}`, { method: "DELETE" });

/* ── an entity's public story ───────────────────────────────────────────────*/

export type EntityStory = {
  entity_id: string;
  code: string;
  legal_name: string;
  trading_name: string | null;
  country_code: string;
  /** The authoritative lifecycle ladder (Decision Q1): a DRAFT or DEACTIVATED
   *  company is not on the website even with `public_enabled` on, and the tab
   *  says so rather than letting an operator discover it on the About page. */
  registration_status: string | null;
  public_enabled: boolean;
  public_summary_fr: string | null;
  public_summary_en: string | null;
  public_coverage: { country_code: string; label_fr?: string | null; label_en?: string | null }[];
  public_focus: {
    label_fr?: string | null;
    label_en?: string | null;
    mode?: string | null;
    service_type_key?: string | null;
  }[];
  public_cover_vault_id: string | null;
  /**
   * PR-07 (CE-25): the state of the last cover-attachment attempt that has
   * not resolved — null when the last attempt linked or was reconciled. The
   * Story tab renders it as a durable banner so "the upload did not take"
   * stays on the screen until it is fixed, instead of dying with the toast.
   * `vault_doc_id` is the honest byte counter: present when the file reached
   * storage, absent when the attempt died before any byte was written.
   */
  cover_attachment?: {
    state: "INTENT" | "BYTES_STORED" | "FAILED";
    vault_doc_id: string | null;
    attempts: number;
    last_error: string | null;
    updated_at: string | null;
  } | null;
};

export const getEntityStory = (id: string) =>
  tenant<EntityStory>(`/site-settings/entities/${id}/story`);
export const saveEntityStory = (id: string, body: Partial<EntityStory>) =>
  tenant<EntityStory>(`/site-settings/entities/${id}/story`, { method: "PUT", body });

/* ── the service catalogue behind the focus picker (Decision Q8) ────────────
 *
 * The picker offers a stable `service_type.key` — the tenant's own taxonomy —
 * and NOT a free transport mode, so the card's colour is derived in one place
 * server-side. The labels the operator types remain an editorial overlay over
 * the classification.
 */
export type ServiceFocusEntry = {
  key: string;
  label: { fr: string; en: string | null };
  mode: string | null;
};

export const listServiceFocus = () =>
  tenant<ServiceFocusEntry[]>("/site-settings/service-types");

/* ── website media (§6.3) ───────────────────────────────────────────────────
 *
 * ── THE SLOT CONSTRAINTS COME FROM `@praxis/shared`, NOT FROM HERE ─────────
 *
 * §6.3: the slot's aspect, minimum width and byte cap must be shown BEFORE the
 * file dialog opens, because "a tenant who learns the constraint after a
 * rejected upload uploads something wrong twice". Those numbers are the same
 * ones the API enforces, so they are read from the shared package rather than
 * retyped here — a second list would be a second answer to "what fits here",
 * and the one on this side is the one a tenant would believe.
 */

export type AssetSlot =
  | "leader-portrait"
  | "partner-mark"
  | "credential-mark"
  | "entity-cover";
export type AssetProvenance = "owned" | "licensed" | "generated";

/** What each slot accepts. Re-exported so a caller does not have to know the
 *  shared package's shape to render a hint. */
export const ASSET_SLOTS = siteSettings.SITE_MEDIA_SLOTS;

/** The ladder of derivatives a document actually has. `null` where none were
 *  written — an SVG needs none, and an upload predating 13789 has none. */
export type AssetVariants = { widths: number[]; formats: string[] } | null;

export const uploadAsset = (
  body: {
    slot: AssetSlot;
    owner_id: string;
    provenance: AssetProvenance;
    data_url: string;
    original_name?: string;
  },
  onProgress?: (percent: number) => void,
) =>
  onProgress
    ? tenantWithProgress<{ doc_id: string }>(
        "/site-settings/media",
        body,
        onProgress,
      )
    : tenant<{ doc_id: string }>("/site-settings/media", {
        method: "POST",
        body,
      });

export const removeAsset = (slot: AssetSlot, ownerId: string) =>
  tenant<unknown>(`/site-settings/media/${slot}/${encodeURIComponent(ownerId)}`, {
    method: "DELETE",
  });
