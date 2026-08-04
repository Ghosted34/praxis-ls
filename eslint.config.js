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
        // Node 20 global. Used by shared/observability/error-reporter.js to
        // bound the outbound webhook call — a reporting POST must not hang a
        // request path.
        AbortSignal: "readonly",
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
