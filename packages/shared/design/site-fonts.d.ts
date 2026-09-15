/** Types for the website's font registry. See site-fonts.js for why the public
 *  site's list is shorter than the ERP's. */
export type SiteFontRole = "display" | "body" | "mono";

export declare const SITE_FONT_IDS: string[];
export declare const SITE_FONT_ROLES: Record<SiteFontRole, string[]>;
export declare const SITE_FONT_DEFAULTS: Record<SiteFontRole, string>;
export declare function resolveSiteFont(role: SiteFontRole, id: string | null | undefined): string;

/** Font id → the `font-family` name `public-web/src/fonts.css` declares. The
 *  two are different strings ("inter" vs "Inter Variable"), which is why the
 *  mapping is shared rather than spelt out at a call site. */
export declare const SITE_FONT_FAMILIES: Record<string, string>;

/** The metric-matched fallback family for an id — declared in
 *  `public-web/src/fonts-fallback.css`, generated from the real font files. */
export declare function siteFontFallback(id: string): string;

/** The full `font-family` value: the real face, its metric-matched fallback,
 *  then the generic. One function, so the pre-paint stacks, the runtime stacks
 *  and the fallback generator cannot describe three different stacks. */
export declare function siteFontStack(id: string, generic?: string): string;
