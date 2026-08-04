// Flat ESLint config for the client (ESLint 9). The old `eslint . --ext` script
// silently self-ignored because no flat config existed — this restores the
// client lint gate. Backend has its own root config; this one is frontend-only.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "dev-dist", "coverage", "node_modules", "playwright-report", "test-results"] },
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
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
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

      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/label-has-associated-control": "warn",
      "jsx-a11y/interactive-supports-focus": "warn",
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/no-autofocus": "warn",
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
