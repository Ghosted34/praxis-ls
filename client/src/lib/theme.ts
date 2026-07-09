/**
 * White-label theming. The tenant's brand color (from the `setting` table,
 * section 'appearance') overrides --primary at runtime — no rebuild. Call
 * applyBrand() after login (or from a public branding endpoint once one exists).
 * Values are plain CSS color strings (hex or oklch); we set them straight onto
 * :root so every `bg-primary`/`text-primary` utility re-tints instantly.
 */
export type Brand = {
  primary?: string;
  primaryForeground?: string;
  logoUrl?: string;
  name?: string;
};

const root = () => document.documentElement;

export function applyBrand(brand: Brand) {
  if (brand.primary) root().style.setProperty("--primary", brand.primary);
  if (brand.primaryForeground) root().style.setProperty("--primary-foreground", brand.primaryForeground);
  if (brand.primary) root().style.setProperty("--ring", brand.primary);
}

export function resetBrand() {
  ["--primary", "--primary-foreground", "--ring"].forEach((v) => root().style.removeProperty(v));
}
