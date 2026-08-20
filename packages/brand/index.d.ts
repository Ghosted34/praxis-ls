/** @praxis/brand — Praxis LS brand constants. See README.md. */

export declare const palette: {
  /** Optical Orange #FF5A00 — the single accent. */
  orange: string;
  /** Slate Gray #7E8286 — the mark's structure. */
  slate: string;
  /** Carbon Black #0A0A0A — the ground of the primary (dark) expression. */
  carbon: string;
};

export declare const slateRamp: Record<
  100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900,
  string
>;

/** Accessible TEXT variants. Suffix names the theme the value is legible on. */
export declare const ink: {
  orangeLight: string;
  orangeDark: string;
  slateLight: string;
  slateDark: string;
};

/** Label colour for text on an orange fill. Carbon — white fails AA at 3.13:1. */
export declare const onOrange: string;

export declare const status: {
  okLight: string;
  okDark: string;
  warnLight: string;
  warnDark: string;
  dangerLight: string;
  dangerDark: string;
  infoLight: string;
  infoDark: string;
};

/** CSS font-family stacks. Identical to variableStack() in client/src/lib/fonts.ts. */
export declare const type: {
  display: string;
  body: string;
  mono: string;
};

export declare const wordmark: {
  text: string;
  tracking: string;
  minWidthPx: number;
  clearSpaceRatio: number;
};

/** WCAG 2.1 contrast ratio between two hex colours. */
export declare function contrast(hexA: string, hexB: string): number;
