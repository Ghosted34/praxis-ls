/**
 * Types for the palette engine. Hand-written for the same reason index.d.ts is:
 * the package ships plain CommonJS so the API can require it with no build
 * step, and these declarations are what make it a first-class import on the
 * TypeScript side.
 *
 * `Record<string, string>` is honest here rather than lazy: the token set is
 * open by design — a theme carries every `--*` the engine emits, and pinning
 * the key union would mean editing this file every time a token is added,
 * which is exactly the drift a hand-written declaration invites.
 */
export type PaletteInput = {
  primary: string;
  secondary?: string | null;
  tertiary?: string | null;
  /** false reproduces the ERP's fixed transport colours exactly. */
  harmoniseModes?: boolean;
};

/** One value the engine changed, and the measured reason it had to. */
export type PaletteCorrection = {
  theme: "light" | "dark";
  token: string;
  from: string;
  to: string;
  fromRatio?: number;
  toRatio?: number;
  reason: "accent-as-text" | "no-legible-label" | string;
};

export type DerivedPalette = {
  light: Record<string, string>;
  dark: Record<string, string>;
  meta: {
    input: Required<Pick<PaletteInput, "primary">> & {
      secondary: string;
      tertiary: string;
      harmoniseModes: boolean;
    };
    derived: { secondary: boolean; tertiary: boolean };
    corrections: PaletteCorrection[];
  };
};

/** One measured pair from `auditTheme`. */
export type ContrastRow = {
  fg: string;
  bg: string;
  ratio: number;
  required: number;
  ok: boolean;
};

export declare function derivePalette(input: PaletteInput | null | undefined): DerivedPalette;
export declare function auditTheme(tokens: Record<string, string>): ContrastRow[];
export declare const AA_PAIRS: [string, string][];
export declare const UI_PAIRS: [string, string][];
export declare const AA: number;
export declare const AA_UI: number;
export declare const MODES: Record<"sea" | "air" | "road" | "rail", { light: string; dark: string }>;
export declare const MODE_HUE_MAX_PULL: number;
export declare const DEFAULT_PRIMARY: string;
