"use strict";

const js = require("@eslint/js");

module.exports = [
  // Global ignores — vendored, generated, reference, and frontend trees are not
  // part of the backend lint gate. (`client/` has its own tsc/vite tooling; the
  // legacy PHP/JS under doc/reference is kept for reference only.)
  {
    ignores: [
      "node_modules/**",
      ".cache/**",
      "coverage/**",
      "data/**",
      "doc/**",
      "client/**",
      "platform-console/**",
      "assets/**",
      "media/**",
      "packages/**",
      "postman/**",
      "**/*.min.js",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        URL: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always"],
      "no-shadow": "warn",
    },
  },
  {
    // The backend is CommonJS, but `.mjs` is ESM by definition — Node decides
    // that from the extension, so the parser must agree or every import is a
    // syntax error. Only the standalone check scripts use it (check-fonts.mjs),
    // matching how client/scripts/*.mjs are already written.
    files: ["**/*.mjs"],
    languageOptions: { sourceType: "module" },
  },
  {
    files: ["tests/**/*.js", "**/*.test.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        jest: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
];
