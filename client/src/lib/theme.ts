/**
 * White-label theming. The tenant's brand tokens (from the `GET /branding`
 * endpoint, branding.service.js) override the design-system CSS variables at
 * runtime — no rebuild. Call applyBrand() after the public branding fetch (and
 * again on save). Most tokens are plain CSS colour strings (hex) set straight
 * onto :root so every `bg-primary`/`bg-secondary`/`bg-accent` utility re-tints
 * instantly. The status-pill tokens (--ok/--warn/--bad) are consumed as raw
 * `R G B` triplets (`rgb(var(--warn) / 0.15)`), so hex values are converted.
 */
export type Brand = {
  primary?: string | null;
  primaryForeground?: string | null;
  secondary?: string | null;
  accent?: string | null;
  accentDeep?: string | null;
  info?: string | null;
  success?: string | null;
  warn?: string | null;
  danger?: string | null;
  fontDisplay?: string | null;
  fontBody?: string | null;
  fontMono?: string | null;
  radius?: string | null;
  logoUrl?: string | null;
  name?: string | null;
};

const root = () => document.documentElement;

/** All the vars applyBrand touches — used by resetBrand to fully revert. */
const MANAGED_VARS = [
  "--primary",
  "--primary-foreground",
  "--ring",
  "--brand-orange",
  "--secondary",
  "--accent",
  "--brand-orange-deep",
  "--info",
  "--ok",
  "--warn",
  "--bad",
  "--destructive",
  "--font-display",
  "--font-body",
  "--font-mono",
  "--radius",
];

/**
 * "#f5821f" / "#abc" → "245 130 31" (space-separated RGB triplet) for tokens
 * consumed via `rgb(var(--x) / a)`. Returns null for non-hex input so we skip
 * the assignment rather than write an invalid value.
 */
function hexToTriplet(value: string): string | null {
  let hex = value.trim();
  if (hex[0] !== "#") return null;
  hex = hex.slice(1);
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  if (hex.length !== 6 || /[^0-9a-f]/i.test(hex)) return null;
  const n = parseInt(hex, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

export function applyBrand(brand: Brand) {
  const r = root();
  const set = (name: string, value?: string | null) => {
    if (value) r.style.setProperty(name, value);
  };
  /** Set a triplet token only when the value converts cleanly. */
  const setTriplet = (name: string, value?: string | null) => {
    const t = value ? hexToTriplet(value) : null;
    if (t) r.style.setProperty(name, t);
  };

  // Accent (full colour strings — Tailwind consumes these directly).
  set("--primary", brand.primary);
  set("--ring", brand.primary);
  set("--primary-foreground", brand.primaryForeground);
  set("--secondary", brand.secondary);
  set("--accent", brand.accent);

  // Brand-mark gradient stops (raw triplets in index.css).
  setTriplet("--brand-orange", brand.primary);
  setTriplet("--brand-orange-deep", brand.accentDeep);

  // Status colours. --destructive is a full string (Tailwind); the status pill
  // tokens --ok/--warn/--bad are raw triplets. --info has no consumer yet but
  // is set for forward use.
  set("--info", brand.info);
  setTriplet("--ok", brand.success);
  setTriplet("--warn", brand.warn);
  set("--destructive", brand.danger);
  setTriplet("--bad", brand.danger);

  // Typography + shape.
  set("--font-display", brand.fontDisplay);
  set("--font-body", brand.fontBody);
  set("--font-mono", brand.fontMono);
  set("--radius", brand.radius);
}

export function resetBrand() {
  MANAGED_VARS.forEach((v) => root().style.removeProperty(v));
}
