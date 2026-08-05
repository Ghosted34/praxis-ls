/**
 * Hand-written declarations for the client.
 *
 * The package ships plain CommonJS so the backend can `require` it with no build
 * step (see README.md). These types are what make it a first-class import on the
 * TypeScript side: `z.input<typeof finalInvoice.submit>` has to give the client
 * the EXACT payload shape the API will accept, which means being precise here.
 * `ZodTypeAny` would compile and then quietly erase every field type into `any`
 * — the shared package would typecheck while proving nothing.
 */
import type { z } from "zod";

/** `YYYY-MM-DD`, round-trip validated (see schemas/common.js). */
type IsoDate = z.ZodEffects<z.ZodString, string, string>;
/** Number or numeric string in, number out. */
type Amount = z.ZodEffects<
  z.ZodEffects<z.ZodUnion<[z.ZodNumber, z.ZodString]>, number, number | string>,
  number,
  number | string
>;

/**
 * Raw `setting` section='pwa' values as the API stores and returns them. Every
 * field is nullable and null means INHERIT (from branding, or from the built-in
 * default) — not "empty". See pwa-design.js.
 */
export type PwaConfig = {
  appName: string | null;
  shortName: string | null;
  description: string | null;
  display: "standalone" | "fullscreen" | "minimal-ui" | "browser" | null;
  orientation: "any" | "portrait" | "landscape" | null;
  themeColor: string | null;
  backgroundColor: string | null;
  iconUrl: string | null;
  iconBackground: string | null;
  iconPadding: number | null;
  iconZoom: number | null;
  iconOffsetX: number | null;
  iconOffsetY: number | null;
  iconRadius: number | null;
  maskableBackground: string | null;
  maskablePadding: number | null;
  splashEnabled: boolean | null;
  splashPreset: "none" | "fade" | "pulse" | "shimmer" | "ring" | "mesh" | null;
  splashDuration: number | null;
  splashBackground: string | null;
  splashTagline: string | null;
  splashShowProgress: boolean | null;
  installEnabled: boolean | null;
  installTitle: string | null;
  installBody: string | null;
  installIosBody: string | null;
  installButton: string | null;
  offlineText: string | null;
  offlineReadyText: string | null;
  updateTitle: string | null;
  updateBody: string | null;
  updateButton: string | null;
};

/** What every consumer actually renders: nothing here is null except the two
 *  asset URLs and the copy overrides, which fall back in the component. */
export type EffectivePwa = {
  name: string;
  shortName: string;
  description: string;
  display: NonNullable<PwaConfig["display"]>;
  orientation: NonNullable<PwaConfig["orientation"]>;
  themeColor: string;
  backgroundColor: string;
  iconUrl: string | null;
  iconBackground: string;
  iconPadding: number;
  iconZoom: number;
  iconOffsetX: number;
  iconOffsetY: number;
  iconRadius: number;
  maskableBackground: string;
  maskablePadding: number;
  splashEnabled: boolean;
  splashPreset: NonNullable<PwaConfig["splashPreset"]>;
  splashDuration: number;
  splashBackground: string;
  splashTagline: string;
  splashShowProgress: boolean;
  splashLogoUrl: string | null;
  installEnabled: boolean;
  installTitle: string | null;
  installBody: string | null;
  installIosBody: string | null;
  installButton: string | null;
  offlineText: string | null;
  offlineReadyText: string | null;
  updateTitle: string | null;
  updateBody: string | null;
  updateButton: string | null;
};

/** Branding fields `effectivePwa` inherits from. A subset of the client's
 *  `Branding` type, declared structurally so neither side has to import the
 *  other. */
export type PwaBrandSource = {
  name?: string | null;
  primary?: string | null;
  logoUrl?: string | null;
  theme?: "dark" | "light" | null;
};

export declare namespace pwaDesign {
  const PWA_ENUMS: {
    display: readonly NonNullable<PwaConfig["display"]>[];
    orientation: readonly NonNullable<PwaConfig["orientation"]>[];
    splashPreset: readonly NonNullable<PwaConfig["splashPreset"]>[];
  };
  const PWA_RANGES: Record<string, [number, number]>;
  const PWA_BOOLS: readonly string[];
  const PWA_TEXT_MAX: Record<string, number>;
  const PWA_TEXT_DEFAULT_MAX: number;
  const PWA_DEFAULTS: Record<string, string | number | boolean>;
  const SPLASH_FALLBACK_BG: string;
  function effectivePwa(pwa: Partial<PwaConfig> | null, brand: PwaBrandSource | null): EffectivePwa;
  /** Artwork box inside the icon canvas, as fractions of the canvas (0..1). */
  function iconLayout(cfg: EffectivePwa, maskable: boolean): { size: number; left: number; top: number };
  function clamp(n: number, range: [number, number]): number;
}

export declare namespace common {
  const uuid: z.ZodString;
  const isoDate: IsoDate;
  function requiredText(label?: string): z.ZodString;
  const amount: Amount;
  const positiveAmount: Amount;
  const currency: z.ZodString;
}

export declare namespace finalInvoice {
  const line: z.ZodObject<{
    dictionary_item_id: z.ZodString;
    amount: Amount;
    is_debours: z.ZodOptional<z.ZodBoolean>;
    label: z.ZodOptional<z.ZodString>;
  }>;

  const createDraft: z.ZodObject<{
    entity_id: z.ZodString;
    client_id: z.ZodOptional<z.ZodString>;
    dossier_id: z.ZodOptional<z.ZodString>;
    lines: z.ZodOptional<z.ZodArray<typeof line>>;
  }>;

  const updateDraft: z.ZodObject<{
    client_id: z.ZodOptional<z.ZodString>;
    dossier_id: z.ZodOptional<z.ZodString>;
    lines: z.ZodOptional<z.ZodArray<typeof line>>;
  }>;

  const submit: z.ZodObject<{
    entry_date: IsoDate;
    source_doc_ref: z.ZodString;
  }>;

  const aiUpdate: z.ZodObject<{
    client_id: z.ZodOptional<z.ZodString>;
    dossier_id: z.ZodOptional<z.ZodString>;
    lines: z.ZodOptional<z.ZodArray<typeof line>>;
    invoice_id: z.ZodString;
  }>;

  const aiSubmit: z.ZodObject<{
    entry_date: IsoDate;
    source_doc_ref: z.ZodString;
    invoice_id: z.ZodString;
  }>;
}
