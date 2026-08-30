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
import { createRequire } from "module";

// Shared with the client — see public-web/eslint-local-rules/index.cjs. The
// header above says to "port eslint-local-rules/ across when this app starts to
// carry shared UI". The dialog ban does not wait for that: it is not a
// convention about shared components, it is a promise to the tenant that no
// screen on their domain renders a browser popup, and this app is the only one
// of the three an unauthenticated prospect ever sees.
const require = createRequire(import.meta.url);
const praxis = require("./eslint-local-rules/index.cjs");

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
      praxis,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",

      /**
       * NO BROWSER-DRAWN POPUPS. Error, matching client/ and
       * platform-console/ — see client/eslint-local-rules/no-native-dialogs.cjs.
       *
       * There is no backlog to clear here: this app has never had one. That is
       * exactly why the rule belongs in before the first form handler grows an
       * `alert("Thanks!")`, rather than after a sweep has to remove it.
       */
      "praxis/no-native-dialogs": "error",
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
