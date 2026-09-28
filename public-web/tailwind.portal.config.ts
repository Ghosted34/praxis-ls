import type { Config } from "tailwindcss";
import base from "./tailwind.config";

/**
 * The client portal's own Tailwind build — compiled into
 * `src/features/portal/portal.css` through its `@config` line, and loaded with
 * the portal's lazy chunk rather than on every marketing page's first paint.
 *
 * ── WHY EVERY UTILITY IS SCOPED UNDER `.pt-root` ───────────────────────────
 *
 * Two stylesheets now both carry Tailwind utilities: `index.css` (everything
 * but the portal) and this one. Once the portal has been opened, its sheet
 * stays in the document for the rest of the visit — including after the
 * visitor follows a link back to the marketing site. Unscoped, a `.hidden` in
 * the LATER sheet would then override an `md:flex` in the earlier one on any
 * marketing element that uses both, because equal specificity is decided by
 * order. Scoping raises every portal utility to `.pt-root .x` and confines it
 * to the portal's own subtree, so the two builds can never fight.
 *
 * `content` includes the shared components the portal renders, so their
 * responsive variants exist here too, in the right order relative to anything
 * the portal adds — otherwise a portal `.pt-root .h-11` would outrank a shared
 * button's unscoped `sm:h-12`.
 *
 * Preflight is off: the base layer already arrived with `index.css`.
 */
export default {
  ...base,
  content: [
    "./src/features/portal/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  important: ".pt-root",
  corePlugins: { preflight: false },
} satisfies Config;
