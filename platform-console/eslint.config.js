// Flat ESLint config for the platform console (ESLint 9). Mirrors the client's
// config — this app previously had no lint gate at all. Frontend-only; the
// backend has its own root config.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { createRequire } from "module";

// Shared with the client — see platform-console/eslint-local-rules/index.cjs
// for why this is a re-export rather than a second copy of the rule.
const require = createRequire(import.meta.url);
const praxis = require("./eslint-local-rules/index.cjs");

export default tseslint.config(
  { ignores: ["dist", "dev-dist", "coverage", "node_modules"] },
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
      praxis,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
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
       * No browser-drawn popups here either. The console had exactly one
       * (`ErrorCenterSettings`, deleting an escalation rule) while its own
       * <ConfirmModal danger> had existed since Plans and OpsBackups — which is
       * the case for a gate rather than a code review: the primitive was there
       * and reaching for `window.confirm` was still easier.
       */
      "praxis/no-native-dialogs": "error",
    },
  },
  // THE BAN IS NOT TYPESCRIPT-ONLY.
  //
  // Every other block in this file is scoped to TS and TSX files, which is right
  // for rules about types and hooks — but it means the dialog gate stops at a
  // file extension. Nothing in this repo forbids a .jsx component, a .js helper
  // or a .mjs build script that touches the DOM, and the gate would have had
  // nothing to say about any of them. A ban a rename defeats is not a ban.
  //
  // Deliberately ONE rule and no `extends`. Pulling the recommended sets over
  // these files would report a backlog that has nothing to do with dialogs, and
  // the pressure to make THAT green is how the whole block gets deleted.
  {
    files: ["**/*.{js,jsx,mjs,cjs,mts,cts}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { praxis },
    rules: { "praxis/no-native-dialogs": "error" },
  },
);
