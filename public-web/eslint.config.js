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
    files: ["**/*.config.{ts,js}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The gates in scripts/ are the app's own CI tooling, so they get real rules:
    // `js.configs.recommended` at minimum. They were previously listed only to
    // receive Node globals, which meant `no-useless-escape` and friends never ran
    // on them — and two of those regexes did carry a useless escape, which the
    // BACKEND's lint then reported as an error in `npm run lint` at the repo root.
    // The point of covering them here is so that class of mistake is caught by the
    // app that owns the file, in the app's own `npm run lint`.
    files: ["scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // The backend forbids `console.log` because the API has a logger and a log
      // line in a request handler is a bug. A standalone CLI gate has no logger and
      // its stdout IS the product — the green line a reviewer reads — so the rule
      // is off here rather than satisfied by writing informational output through
      // `console.warn`, which is what the equivalent client scripts do.
      "no-console": "off",
    },
  },
);
