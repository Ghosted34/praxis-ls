import type { Config } from "tailwindcss";

/**
 * Praxis LS design tokens.
 *
 * Semantic colours resolve to the CSS variables in src/index.css so the tenant
 * white-label loader (src/lib/theme.ts) can override --primary etc. at runtime
 * without a rebuild.
 *
 * PHASE 1 (audit F2 / F3 / F14 / F17): before this pass the config extended
 * `colors`, `borderRadius`, `keyframes` and `animation` and nothing else —
 * which is why the app fragmented into 19 ad-hoc type sizes, five unruled page
 * widths and zero desktop breakpoints. The scales below are the missing
 * contract:
 *
 *   screens   `xl` / `2xl` are the DESKTOP tiers this product actually targets.
 *             Every layout decision used to be made at `sm` (640px), so 1280px
 *             and 2560px rendered identically.
 *   fontSize  one ramp. `text-[13px]` and friends become a lint smell.
 *   maxWidth  named page containers, replacing 86 `max-w-6xl` literals.
 *             Consumed through <PageContainer>, not by hand.
 *   spacing   the row steps the table-density work needs.
 *
 * Scope note: `sm` / `md` / `lg` / `xl` keep Tailwind's default pixel values on
 * purpose — this pass adds the missing desktop tier, it does not move the
 * breakpoints existing screens are already written against.
 */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1600px",
    },
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        popover: { DEFAULT: "var(--popover)", foreground: "var(--popover-foreground)" },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
          // Accessible orange for TEXT. --primary is a FILL colour: at 2.59:1 on
          // white it fails WCAG AA as type (audit F13). Brand identity is
          // unchanged — fills keep --primary, text uses --primary-ink (4.64:1).
          ink: "var(--primary-ink)",
        },
        secondary: { DEFAULT: "var(--secondary)", foreground: "var(--secondary-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        accent: { DEFAULT: "var(--accent)", foreground: "var(--accent-foreground)" },
        destructive: { DEFAULT: "var(--destructive)", foreground: "var(--destructive-foreground)" },

        /**
         * Semantic STATUS tones (Phase 4).
         *
         * These existed in index.css from Phase 1 but were never exposed to
         * Tailwind, so the only way to reach them was the arbitrary-value form:
         *
         *   text-[rgb(var(--ok))]        vs   text-ok
         *   bg-[rgb(var(--ok)_/_0.12)]   vs   bg-ok/10
         *
         * That is the whole reason `text-emerald-600` kept reappearing. The
         * audit called it a discipline problem (F14, rule #1 "never hardcode
         * colours") — it was partly an ergonomics problem: the wrong thing was
         * shorter to type than the right one, and 46 sites took the shortcut.
         *
         * `<alpha-value>` is what lets the slash-opacity syntax work on a
         * variable-backed colour, so `border-ok/40` resolves rather than being
         * silently dropped. That requires the CSS var to hold a bare `R G B`
         * triplet, which is how index.css already defines these.
         *
         * TEXT vs FILL is a real distinction here, not tidiness: `--ok` is the
         * AA-corrected value for type, `--ok-fill` the more saturated one for
         * grounds. Pairing text-ok with bg-ok-fill/12 is what `.st-ok` does, and
         * what <Pill> should still be preferred for on an actual status.
         */
        ok: "rgb(var(--ok) / <alpha-value>)",
        "ok-fill": "rgb(var(--ok-fill) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        "warn-fill": "rgb(var(--warn-fill) / <alpha-value>)",
        bad: "rgb(var(--bad) / <alpha-value>)",
        "bad-fill": "rgb(var(--bad-fill) / <alpha-value>)",
        "brand-blue": "rgb(var(--brand-blue) / <alpha-value>)",
        /**
         * Blue as TYPE. Same ink/fill split as `--primary` vs `--primary-ink`,
         * and added for the same reason one phase later: `text-brand-blue` over
         * `bg-brand-blue/10` measured 3.27:1 — text on a tint OF ITSELF is the
         * pattern that is failing by construction, and it appeared at eight
         * sites (the KPI tile, three Control Tower components, the callout, the
         * AI action chip and both blue status pills).
         *
         * Rule of thumb: `brand-blue` fills, `brand-blue-ink` writes.
         */
        "brand-blue-ink": "rgb(var(--brand-blue-ink) / <alpha-value>)",
        "brand-orange": "rgb(var(--brand-orange) / <alpha-value>)",

        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          border: "var(--sidebar-border)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
        },
      },

      /**
       * Type ramp. Extends rather than replaces, so `text-xs`/`text-xl`/`2xl`/
       * `3xl` keep their defaults while the migration runs; `sm`/`base`/`lg` are
       * retuned one step down for data density.
       *
       * `micro` and `label` replace the 9px / 9.5px / 10px uppercase spread that
       * measured 3.01:1 (F13). At 11-12px with restrained tracking they clear AA
       * and still read as captions.
       */
      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.06em" }], // 11
        label: ["0.75rem", { lineHeight: "1.125rem", letterSpacing: "0.01em" }], // 12
        sm: ["0.8125rem", { lineHeight: "1.25rem" }], // 13 — table + body default
        base: ["0.875rem", { lineHeight: "1.375rem" }], // 14
        lg: ["1rem", { lineHeight: "1.5rem" }], // 16
        title: ["1.125rem", { lineHeight: "1.625rem", letterSpacing: "-0.01em" }], // 18
        h2: ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em" }], // 22
        h1: ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.02em" }], // 28
      },

      // Named page containers — the replacement for `mx-auto max-w-6xl` (F3).
      // `wide` is the default for data screens; `reading` caps prose/settings.
      maxWidth: {
        reading: "48rem", // 768  — settings, forms, docs
        standard: "80rem", // 1280 — detail + mixed screens
        wide: "104rem", // 1664 — dense tables, dashboards
      },

      borderRadius: {
        // 0.9rem (14.4px) read as a consumer app (F17). Linear / Stripe / Vercel
        // sit at 6-8px; --radius is now 8px.
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      spacing: {
        /**
         * The table row's vertical padding — now a VARIABLE, not a constant
         * (Phase 5).
         *
         * Phase 1 set this to a literal 6px, giving 32px rows against ~46px
         * before: roughly 40% more rows per screen (F17). Phase 5 makes the
         * number a user preference — 28 / 32 / 40px — and the cleanest way to
         * deliver that was to point this step at `--row-py`, which
         * `[data-density]` in index.css sets.
         *
         * The payoff is that `py-row` did not have to change anywhere. Both
         * existing call sites (`ui/table.tsx` TD, `ui/data-view.tsx`'s report
         * table) became density-aware without being touched, and a screen that
         * writes `py-row` tomorrow gets it for free. A prop threaded through
         * every cell of a 200-row table would have re-rendered the table to
         * change a padding the browser can resolve by itself.
         */
        row: "var(--row-py)",
        "row-compact": "0.25rem",
      },

      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        // Control Tower map: the marching-ants stroke on a shipping lane. The
        // only decorative motion the app keeps, because on a live map it is
        // carrying meaning — direction of travel — rather than delight.
        // Speed differs per mode; the offset is the same.
        "lane-dash": { to: { strokeDashoffset: "-100" } },
      },
      animation: {
        // Was 0.35s with a 4px translate. Entrance motion on a screen opened
        // dozens of times a day should be imperceptible, not decorative.
        "fade-in": "fade-in 0.12s ease-out both",
        "lane-sea": "lane-dash 2.4s linear infinite",
        "lane-road": "lane-dash 1.6s linear infinite",
        "lane-air": "lane-dash 3s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
