// Flat ESLint config for public-web (ESLint 9), modelled on platform-console's.
//
// Two rules are deliberately NOT configured as errors here even though they are
// the ones a reviewer will ask about: `react-refresh/only-export-components`
// (this app has co-located providers + hooks in the same files, which the ERP
// also does) and `jsx-a11y` (the a11y gate in client/ is a real axe test run in
// CI; a lint rule that duplicates it is noise). `client/` adds both plugins and
// a local-rules directory; when this app starts to carry shared UI, port
// `eslint-local-rules/` across rather than re-inventing the checks.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["**/*.config.{ts,js}", "scripts/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },
);
