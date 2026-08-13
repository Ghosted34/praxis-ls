/**
 * Local ESLint rules for the client. Loaded from client/eslint.config.js as a
 * plugin under the "praxis" namespace, so a rule below appears in ESLint
 * config as `"praxis/<rule-name>": "warn"`.
 *
 * doc/ERROR_HANDLING.md is the specification these rules enforce.
 */
"use strict";

module.exports = {
  rules: {
    "no-unmarked-silent-catch": require("./no-unmarked-silent-catch.cjs"),
  },
};
