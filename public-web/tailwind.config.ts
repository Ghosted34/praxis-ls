import type { Config } from "tailwindcss";

/**
 * Design tokens for the public web app.
 *
 * The semantic colour names are the SAME as `client/tailwind.config.ts` — and
 * that is a functional decision, not a copy. The portal screens in
 * `src/features/portal/` are the tenant app's screens moved here, and every one
 * of them paints through `bg-card` / `text-muted-foreground` / `text-primary-ink`
 * / `border-input`. If the names diverged, the port would either re-style by
 * accident or need a rewrite, and "the same tenant brand paints both surfaces"
 * is the property the white-label product depends on.
 *
 * WHAT DIFFERS, and why it may:
 *
 *   Type scale — the ERP is an instrument: 13px body, 32px rows, everything
 *   dense because an operator reads 200 shipments a day. This app is a
 *   publication and a doorway: a stranger reads one page at a time, on a phone,
 *   in sunlight. `base` is 16px and the ramp opens upward from there. Two
 *   different correct answers for two different jobs — the shared part is the
 *   COLOUR contract, not the sizes.
 *
 *   Containers — `prose` and `measure` are new: marketing columns are set to a
 *   reading width, which the app's `reading` (768px) is too tight for a hero and
 *   `standard` too loose for body copy.
 *
 * Everything resolves through CSS variables defined in `src/index.css`, which
 * `lib/theme.ts` overrides at runtime from the tenant's `GET /branding`. No hex
 * in this file, no hex in a component: a raw colour here is the failure the
 * brand package exists to end (doc/WEB_BUILD_BRIEF.md N2/N3).
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
      "2xl": "1536px",
    },
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        hero: { DEFAULT: "var(--hero)", foreground: "var(--hero-foreground)" },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
          // Orange/slate AS TEXT. --primary is a FILL colour and typically fails
          // AA as type on white (the tenant default measures 2.59:1); every
          // `text-primary-ink` in the ported screens reads this instead.
          ink: "var(--primary-ink)",
        },
        /**
         * Status tones, as `R G B` triplets so `<alpha-value>` (the slash
         * syntax) works. Text vs fill is a real distinction — `--ok` is the
         * AA-corrected value for type, `--ok-fill` the saturated one for
         * grounds — and it is why `.st-*` pairs the two rather than tinting the
         * text colour itself.
         */
        ok: "rgb(var(--ok) / <alpha-value>)",
        "ok-fill": "rgb(var(--ok-fill) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        "warn-fill": "rgb(var(--warn-fill) / <alpha-value>)",
        bad: "rgb(var(--bad) / <alpha-value>)",
        "bad-fill": "rgb(var(--bad-fill) / <alpha-value>)",
        "brand-orange": "rgb(var(--brand-orange) / <alpha-value>)",
        "brand-blue": "rgb(var(--brand-blue) / <alpha-value>)",
        "brand-blue-ink": "rgb(var(--brand-blue-ink) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-3": "rgb(var(--ink-3) / <alpha-value>)",
      },

      /** Bound to the tokens, not to Tailwind's defaults: `font-display` is the
       *  brand sheet's display face, and a tenant's own `fontDisplay` override
       *  written by lib/theme.ts must reach it. Ending stacks with a bare
       *  generic keyword is the rule in `scripts/check-fonts.mjs`. */
      fontFamily: {
        sans: "var(--font-body)",
        display: "var(--font-display)",
        mono: "var(--font-mono)",
      },

      /**
       * `micro` and `title` keep the ERP's names so the ported screens render
       * without edits; the sizes above them are the publication ramp.
       */
      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.06em" }], // 11
        label: ["0.75rem", { lineHeight: "1.125rem", letterSpacing: "0.01em" }], // 12
        sm: ["0.875rem", { lineHeight: "1.375rem" }], // 14 — data, captions
        base: ["1rem", { lineHeight: "1.65rem" }], // 16 — body copy
        lg: ["1.125rem", { lineHeight: "1.85rem" }], // 18
        title: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }], // 20
        h3: ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.015em" }], // 24
        h2: ["2rem", { lineHeight: "2.35rem", letterSpacing: "-0.02em" }], // 32
        h1: ["2.75rem", { lineHeight: "3rem", letterSpacing: "-0.025em" }], // 44
        display: [
          "3.5rem",
          { lineHeight: "3.75rem", letterSpacing: "-0.03em" },
        ], // 56
        jumbo: ["4.5rem", { lineHeight: "4.75rem", letterSpacing: "-0.035em" }], // 72
      },

      maxWidth: {
        reading: "48rem", // 768  — forms, portal panels
        standard: "80rem", // 1280 — data screens
        wide: "88rem", // 1408 — marketing pages (a publication, not a grid)
        prose: "42rem", // 672 — article measure
        measure: "34rem", // 544 — lead paragraphs beside an image
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 10px)",
      },

      spacing: {
        // One vertical rhythm unit for the marketing sections, so "a bit more
        // air" is not re-decided per section.
        band: "clamp(3.5rem, 8vw, 7.5rem)",
        gutter: "clamp(1rem, 4vw, 2.5rem)",
      },

      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        // The marching-ants stroke on a lane. The only decorative motion this app
        // keeps, because on a route diagram it carries meaning — direction of
        // travel — rather than delight. Same offsets as client's Control Tower.
        "lane-dash": { to: { strokeDashoffset: "-120" } },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.12s ease-out both",
        // Short, and only on arrival — a scrolling marketing page that animates
        // every element is the idiom this product's own audit rejected.
        "rise-in": "rise-in 0.4s cubic-bezier(0.2, 0, 0.13, 1) both",
        "lane-sea": "lane-dash 2.4s linear infinite",
        "lane-road": "lane-dash 1.6s linear infinite",
        "lane-air": "lane-dash 3s linear infinite",
        "lane-rail": "lane-dash 2s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
