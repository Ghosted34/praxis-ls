/**
 * Local ESLint rules for the platform console.
 *
 * The rule implementations live in client/eslint-local-rules/ and are shared
 * from there rather than copied. A second copy of a gate is a gate that drifts:
 * the console is a smaller app that gets less attention, so the copy that fell
 * behind would be this one, and the whole point of the ban is that it holds
 * EVERYWHERE a person can see a popup.
 */
"use strict";

module.exports = {
  rules: {
    "no-native-dialogs": require("../../client/eslint-local-rules/no-native-dialogs.cjs"),
  },
};
