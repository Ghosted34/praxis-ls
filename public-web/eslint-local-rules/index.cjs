/**
 * Local ESLint rules for public-web.
 *
 * The implementations live in client/eslint-local-rules/ and are shared from
 * there rather than copied, for the same reason platform-console shares them: a
 * second copy of a gate is a gate that drifts, and the copy that falls behind is
 * always the one in the app nobody is looking at.
 *
 * This app matters MORE than the other two for this particular ban, not less.
 * The client and the console are behind a login — the people who see a popup
 * there already work here. public-web is the marketing site and the tracking
 * page: it is the first thing a prospect sees, it is the surface a tenant's own
 * domain points at, and every screen on it is a FORM (contact, quote,
 * newsletter, track). `alert("Thanks!")` after a submit is the single most
 * natural thing to write on a page like this, and it would render as
 * "praxis-ls.com says" on top of a landing page built to look like the tenant's.
 */
"use strict";

module.exports = {
  rules: {
    "no-native-dialogs": require("../../client/eslint-local-rules/no-native-dialogs.cjs"),
  },
};
