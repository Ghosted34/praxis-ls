/**
 * Page width tokens (audit F3).
 *
 * Before this, every screen carried its own `mx-auto max-w-6xl` — 86 call sites
 * across 62 files, plus `const shell = "…"` redeclared in 28 of them and five
 * other widths (2xl/3xl/4xl/5xl) applied with no rule governing which. The app
 * therefore capped at 1152px on every viewport: identical at 1280px and 2560px,
 * with the data floating in dead space.
 *
 * Width is now a deliberate choice from a fixed set, resolved centrally. The
 * underlying values live in tailwind.config.ts (`maxWidth.reading/standard/wide`)
 * so they are tunable in one place.
 *
 * WHICH ONE:
 *   wide      dense data screens — lists, tables, dashboards, hubs. The default.
 *             1664px, so a 1920px display is actually used.
 *   standard  detail and mixed screens — a record with side panels, 360 views.
 *   reading   prose and single-column forms — settings, help, editors. Capping
 *             measure is correct here; a 1600px-wide form is not a feature.
 *   full      the screen manages its own width (split panes, chat, kanban).
 *
 * `pageShell.*` is the class string, for screens that already own a <section>.
 * <PageContainer> (components/layout/page-container.tsx) is the same thing with
 * the element and semantics included — prefer it in new code.
 */
export const pageShell = {
  wide: "mx-auto w-full max-w-wide animate-fade-in",
  standard: "mx-auto w-full max-w-standard animate-fade-in",
  reading: "mx-auto w-full max-w-reading animate-fade-in",
  full: "w-full animate-fade-in",
} as const;

export type PageWidth = keyof typeof pageShell;
