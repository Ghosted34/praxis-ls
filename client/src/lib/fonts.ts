/**
 * THE FONT LIBRARY — the closed set of families the ERP ships.
 *
 * WHY A CLOSED SET. Appearance used to take three free-text CSS strings. A typo
 * ("Montserat") failed silently to the fallback, and even a correct name only
 * worked if the font happened to be installed on the viewer's machine — so a
 * tenant configured their brand type on a designer's Mac and every operator on
 * Windows saw something else. Every family below is self-hosted (@fontsource,
 * SIL OFL / Apache-2.0), so what the tenant picks is what every user renders,
 * on every device, offline included.
 *
 * WHY NO SEGOE UI / SF PRO / HELVETICA NEUE. All three are proprietary —
 * Microsoft, Apple and Monotype respectively — and cannot legally be
 * redistributed. Offering them would mean shipping a name that renders natively
 * on one OS and silently substitutes on every other, which is the exact failure
 * this library exists to end. Their open counterparts are here instead: Noto
 * Sans, Plus Jakarta Sans and Work Sans.
 *
 * WHAT IS PERSISTED. The `stack` string, not the id — it is written straight
 * into `--font-display` / `--font-body` / `--font-mono` (see lib/theme.ts), so
 * the storage contract is unchanged and any value already in the `setting`
 * table stays valid. `fontByValue()` resolves a stored string back to a library
 * entry, matching on the first family name, so a legacy hand-typed
 * `"Montserrat", Georgia, serif` resolves to Montserrat and starts loading the
 * real webfont rather than continuing to fall back to Georgia.
 *
 * LOADING IS LAZY. Nothing here is in the startup bundle except the active
 * fonts (see `loadFonts`). Each `load()` is a dynamic import of the family's
 * CSS, which Vite code-splits into its own chunk; the woff2 files it references
 * land in dist/assets, where the service worker's `**\/*.woff2` precache glob
 * picks them up. Eagerly bundling all fifteen would be ~3 MB on first paint for
 * a set where a tenant uses at most three.
 */

export type FontRole = "sans" | "serif" | "mono";

export type FontDef = {
  /** Stable identifier. Used by tests and as a React key — never persisted. */
  id: string;
  /** Human name. The picker renders this in the font's own face. */
  name: string;
  /** The CSS font-family value written to the token. THIS is what persists. */
  stack: string;
  role: FontRole;
  /** One line on the family's character, shown under the name in the picker. */
  note: string;
  /** Dynamic import of the family's @fontsource CSS. Code-split by Vite. */
  load: () => Promise<unknown>;
};

/**
 * Fallbacks are per role and deliberately short. They exist for the instant
 * between first paint and the webfont resolving (@fontsource ships
 * `font-display: swap`), not as a substitution strategy — the whole point of a
 * self-hosted library is that the real font always arrives.
 */
const FALLBACK: Record<FontRole, string> = {
  // `system-ui` first is also the licence-clean way to reach the three faces
  // that had to be dropped: it resolves to Segoe UI on Windows and SF Pro on
  // Apple platforms, chosen by the OS, without this app redistributing either.
  // Naming them outright would only have added the proprietary names back.
  sans: "system-ui, -apple-system, Arial, sans-serif",
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

/**
 * @fontsource-variable packages declare the family as "<Name> Variable" (a
 * space, not "InterVariable" — index.css asked for the latter and therefore
 * rendered system-ui for months despite bundling the font). The static name is
 * kept as the second entry so a user who has the family installed locally is
 * still served the right typeface if the chunk is slow.
 */
const variableStack = (family: string, role: FontRole) =>
  `"${family} Variable", "${family}", ${FALLBACK[role]}`;

export const FONTS: FontDef[] = [
  // ── Sans ──
  {
    id: "inter",
    name: "Inter",
    stack: variableStack("Inter", "sans"),
    role: "sans",
    note: "Neutral UI workhorse. The app default.",
    load: () => import("@fontsource-variable/inter"),
  },
  {
    id: "roboto",
    name: "Roboto",
    stack: variableStack("Roboto", "sans"),
    role: "sans",
    note: "Android's type. Compact, familiar, dense-table friendly.",
    load: () => import("@fontsource-variable/roboto"),
  },
  {
    id: "noto-sans",
    name: "Noto Sans",
    stack: variableStack("Noto Sans", "sans"),
    role: "sans",
    note: "Widest glyph coverage here — built for global scripts.",
    load: () => import("@fontsource-variable/noto-sans"),
  },
  {
    id: "plus-jakarta-sans",
    name: "Plus Jakarta Sans",
    stack: variableStack("Plus Jakarta Sans", "sans"),
    role: "sans",
    note: "Geometric with warm details. Modern product feel.",
    load: () => import("@fontsource-variable/plus-jakarta-sans"),
  },
  {
    id: "ibm-plex-sans",
    name: "IBM Plex Sans",
    stack: variableStack("IBM Plex Sans", "sans"),
    role: "sans",
    note: "Engineered and slightly technical. Reads as enterprise.",
    load: () => import("@fontsource-variable/ibm-plex-sans"),
  },
  {
    id: "work-sans",
    name: "Work Sans",
    stack: variableStack("Work Sans", "sans"),
    role: "sans",
    note: "Grotesque tuned for screens. Strong at large sizes.",
    load: () => import("@fontsource-variable/work-sans"),
  },
  {
    id: "open-sans",
    name: "Open Sans",
    stack: variableStack("Open Sans", "sans"),
    role: "sans",
    note: "Open forms, high legibility. A safe body choice.",
    load: () => import("@fontsource-variable/open-sans"),
  },
  {
    id: "public-sans",
    name: "Public Sans",
    stack: variableStack("Public Sans", "sans"),
    role: "sans",
    note: "US government design system. Plain and unfussy.",
    load: () => import("@fontsource-variable/public-sans"),
  },
  {
    id: "montserrat",
    name: "Montserrat",
    stack: variableStack("Montserrat", "sans"),
    role: "sans",
    note: "Wide geometric caps. Best on headings, not body copy.",
    load: () => import("@fontsource-variable/montserrat"),
  },
  {
    id: "source-sans-3",
    name: "Source Sans 3",
    stack: variableStack("Source Sans 3", "sans"),
    role: "sans",
    note: "Adobe's UI sans. Narrow, economical in tables.",
    load: () => import("@fontsource-variable/source-sans-3"),
  },
  {
    id: "lato",
    name: "Lato",
    // The one family with no variable build on @fontsource — static weights.
    stack: `"Lato", ${FALLBACK.sans}`,
    role: "sans",
    note: "Humanist warmth with a semi-rounded feel.",
    load: () =>
      Promise.all([
        import("@fontsource/lato/400.css"),
        import("@fontsource/lato/700.css"),
        import("@fontsource/lato/400-italic.css"),
      ]),
  },

  // ── Serif ──
  {
    id: "lora",
    name: "Lora",
    stack: variableStack("Lora", "serif"),
    role: "serif",
    note: "Contemporary serif with brushed contrast. Editorial.",
    load: () => import("@fontsource-variable/lora"),
  },
  {
    id: "merriweather",
    name: "Merriweather",
    stack: variableStack("Merriweather", "serif"),
    role: "serif",
    note: "Large x-height serif, designed for screen reading.",
    load: () => import("@fontsource-variable/merriweather"),
  },

  // ── Mono ──
  {
    id: "jetbrains-mono",
    name: "JetBrains Mono",
    stack: variableStack("JetBrains Mono", "mono"),
    role: "mono",
    note: "Tall x-height, clear 0/O and 1/l. Good for references.",
    load: () => import("@fontsource-variable/jetbrains-mono"),
  },
  {
    id: "cascadia-code",
    name: "Cascadia Code",
    stack: variableStack("Cascadia Code", "mono"),
    role: "mono",
    note: "Microsoft's terminal mono. Rounder than JetBrains.",
    load: () => import("@fontsource-variable/cascadia-code"),
  },
];

/** The app's own defaults — what an unset token resolves to in index.css. */
export const DEFAULT_FONT_ID = "inter";
export const DEFAULT_MONO_FONT_ID = "jetbrains-mono";

/** Which slot a picker is filling. Decides how the groups are ordered. */
export type FontSlot = "display" | "body" | "mono";

const ROLE_LABEL: Record<FontRole, string> = {
  sans: "Sans-serif",
  serif: "Serif",
  mono: "Monospace",
};

/**
 * Group order per slot. Every family is offered in every slot — a tenant may
 * legitimately want a mono display face — but the group that suits the slot is
 * listed first so the sensible choice is the one in view.
 */
const SLOT_ORDER: Record<FontSlot, FontRole[]> = {
  display: ["sans", "serif", "mono"],
  body: ["sans", "serif", "mono"],
  mono: ["mono", "sans", "serif"],
};

/** The library grouped and ordered for a given slot. */
export function fontGroups(slot: FontSlot): { role: FontRole; label: string; fonts: FontDef[] }[] {
  return SLOT_ORDER[slot]
    .map((role) => ({ role, label: ROLE_LABEL[role], fonts: FONTS.filter((f) => f.role === role) }))
    .filter((g) => g.fonts.length > 0);
}

export const fontById = (id: string | null | undefined): FontDef | undefined =>
  FONTS.find((f) => f.id === id);

// ── Resolving a stored CSS string back to a library entry ──

const norm = (s: string) =>
  s
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** The first family in a font-family list — the one the browser actually uses. */
const firstFamily = (s: string) => norm(s).split(",")[0].trim();

/**
 * Resolve a persisted font-family string to its library entry.
 *
 * Matches on the FIRST family rather than the whole stack, which is what makes
 * the pre-library data usable: a tenant who typed `"Montserrat", Georgia, serif`
 * into the old free-text box resolves to Montserrat, so the picker shows their
 * real choice and the webfont is loaded — where before the browser found no
 * Montserrat installed and quietly rendered Georgia. Returns undefined for a
 * genuinely custom stack, which the picker surfaces as "Custom".
 */
export function fontByValue(value: string | null | undefined): FontDef | undefined {
  if (!value || !value.trim()) return undefined;
  const head = firstFamily(value);
  return FONTS.find(
    (f) => head === firstFamily(f.stack) || head === norm(f.name) || head === `${norm(f.name)} variable`,
  );
}

// ── Loading ──

/**
 * One in-flight promise per family. Without this the Appearance page would
 * re-import on every render pass and a preview list would fire fifteen imports
 * per keystroke; the picker also calls loadAll() on mount while the active
 * fonts are already loading, and those two paths must converge on one request.
 */
const inFlight = new Map<string, Promise<unknown>>();

/** Load one family's CSS. Idempotent — repeat calls share the first promise. */
export function loadFont(font: FontDef): Promise<unknown> {
  const existing = inFlight.get(font.id);
  if (existing) return existing;
  // A failed chunk must not poison the cache: drop it so a later attempt (say,
  // after connectivity returns) can retry rather than replaying the rejection.
  const p = font.load().catch((err) => {
    inFlight.delete(font.id);
    throw err;
  });
  inFlight.set(font.id, p);
  return p;
}

/**
 * Load whatever families a set of persisted stacks refers to. This is the
 * startup path: the branding layer calls it with the tenant's (and the user's)
 * three active values, so a session downloads at most three families, not
 * fifteen. Unknown/custom stacks resolve to nothing and cost no request.
 */
export function loadFonts(values: (string | null | undefined)[]): Promise<unknown> {
  const defs = values.map(fontByValue).filter((f): f is FontDef => Boolean(f));
  const unique = new Map(defs.map((f) => [f.id, f]));
  // Never reject: a font chunk failing offline must not break the caller's
  // boot/save path — the fallback stack still renders readable text.
  return Promise.allSettled([...unique.values()].map(loadFont));
}

/**
 * Load every family in the library. Called when a picker mounts, because the
 * dropdown renders each name in its own typeface and cannot do that without the
 * faces present. This is the ONLY path that pulls the whole set, and it is
 * reached only on an Appearance screen.
 */
export function loadAllFonts(): Promise<unknown> {
  return Promise.allSettled(FONTS.map(loadFont));
}

/** Test seam — resets the load cache between cases. */
export function __resetFontCache() {
  inFlight.clear();
}
