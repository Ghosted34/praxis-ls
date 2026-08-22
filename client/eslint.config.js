// Flat ESLint config for the client (ESLint 9). The old `eslint . --ext` script
// silently self-ignored because no flat config existed — this restores the
// client lint gate. Backend has its own root config; this one is frontend-only.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";
import { createRequire } from "module";

// The local rules (client/eslint-local-rules/) are written as CJS because the
// rule API is CJS-first everywhere in the ESLint ecosystem; createRequire
// lets a flat ESM config import them without a bundler step. Each rule is
// documented against the taxonomy in doc/ERROR_HANDLING.md.
const require = createRequire(import.meta.url);
const praxis = require("./eslint-local-rules/index.cjs");

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dev-dist",
      "coverage",
      "node_modules",
      "playwright-report",
      "test-results",
      /*
       * The verification-portal render harness (scripts/dev/render-portal.js
       * builds it, nothing else imports it). Its files legitimately break the
       * Fast Refresh rule — a mount script that renders six components and
       * exports none — and Fast Refresh is meaningless for a bundle that is
       * built once and screenshotted. Linting it would trade three real
       * warnings' worth of budget for a rule that cannot apply.
       */
      "scripts/portal-preview",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
      // Local rules — see client/eslint-local-rules/. Namespaced under
      // "praxis" so a project-specific rule is unmistakable in the config.
      praxis,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      /**
       * PHASE 4: error, because the backlog reached zero.
       *
       * The audit (F15) flagged this as `warn` and suppressed. Every one of the
       * ten outstanding warnings turned out to be the SAME live bug, not lint
       * pedantry: `const rows = query.data || []` mints a fresh array on every
       * render, so an effect or memo depending on it re-runs on every render.
       * On the 360 screens (client, vehicle, employee, location) that effect
       * calls `setSelId`, which renders, which rebuilds the array — the loop was
       * only bounded by the `if (!selId)` guard happening to be false after the
       * first pass.
       *
       * Six `eslint-disable-next-line` suppressions remain, each with a written
       * reason at the call site. That is the difference this flip is for: an
       * exception someone had to justify, rather than a warning nobody reads.
       */
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",

      /**
       * Accessibility (audit F13, F15).
       *
       * Nothing previously stopped an a11y regression from shipping, and the
       * audit found the predictable result: 23 onClick handlers on non-interactive
       * elements, role="menu" with no keyboard handling, and 569 unassociated
       * form labels.
       *
       * ERRORS are the rules whose violations are unambiguous bugs and which the
       * codebase already satisfies (or nearly does) — so they hold the line
       * without a mass rewrite.
       *
       * WARNINGS are the rules with a real existing backlog. They are deliberately
       * not errors yet: a gate everyone learns to force past is worse than one
       * that reports honestly (the same reasoning the backend's `npm audit` step
       * documents). Phase 2 fixes Field/label association and the interactive
       * elements; these flip to "error" in Phase 5 once the count is zero.
       */
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      // ignoreNonDOM: this codebase has custom components with a domain `role`
      // prop (e.g. <PersonRow role="Validator" /> in operations/pages.tsx, where
      // "role" means job function). Without it the rule reports those as invalid
      // ARIA roles — a false positive that would train people to disable it.
      "jsx-a11y/aria-role": ["error", { ignoreNonDOM: true }],
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/iframe-has-title": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/scope": "error",
      "jsx-a11y/tabindex-no-positive": "error",

      /**
       * PHASE 4: these were the rules with a real backlog. The backlog is now
       * zero, so they are errors.
       *
       * The comment above says they "flip to error in Phase 5 once the count is
       * zero". The count reached zero here — Phase 4 is the per-area sweep that
       * clears them — and leaving a satisfied rule at "warn" just invites the
       * backlog back. The 83 warnings this config reported at the start of the
       * phase are gone: 23 non-interactive onClicks became real controls or one
       * documented exception in a shared component, and 11 redundant `autoFocus`
       * props were deleted outright (they sat inside <Modal>, which is now Radix
       * Dialog and focuses its first control already).
       *
       * Every remaining exception in the tree is a `eslint-disable-next-line`
       * carrying a written reason, which is reviewable. A blanket "warn" is not.
       */
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/anchor-is-valid": "error",
      "jsx-a11y/no-autofocus": "error",

      /**
       * `controlComponents` teaches the rule this app's form primitives.
       *
       * A `<label>Pos <Input/></label>` associates by NESTING, which is valid —
       * but the rule only recognises native `<input>`/`<select>`/`<textarea>`,
       * so every design-system control read as "a label wrapping nothing". That
       * is a false positive that would have been silenced with a disable
       * comment, teaching people the rule is noise. Naming the components makes
       * it correct instead, and it now genuinely catches an unassociated label.
       */
      "jsx-a11y/label-has-associated-control": [
        "error",
        {
          depth: 4,
          controlComponents: [
            "Input",
            "Textarea",
            "Select",
            "SearchSelect",
            "Checkbox",
            "RadioGroup",
            "OtpInput",
          ],
        },
      ],

      /**
       * R1 from doc/ERROR_HANDLING.md — every silent catch must carry a
       * taxonomy marker. Set as "warn" for now with the existing violations
       * grandfathered via `--max-warnings <N>` in the lint script; the flip
       * to "error" happens once PR2 has classified every legacy site. This
       * matches the ratchet the backend's `check-silent-catch.js` already
       * uses.
       */
      "praxis/no-unmarked-silent-catch": "warn",
    },
  },
  // Test files run under Vitest globals and legitimately use non-null assertions.
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
