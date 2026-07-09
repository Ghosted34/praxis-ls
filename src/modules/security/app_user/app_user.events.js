"use strict";
module.exports = {
  MODULE: "MOD-67",
  // Generic CRUD events
  CREATED: "app_user.created",
  UPDATED: "app_user.updated",
  ARCHIVED: "app_user.archived",
  // Auth events (formerly security/auth/auth.events.js)
  LOGIN_SUCCEEDED: "auth.login_succeeded",
  LOGIN_FAILED: "auth.login_failed",
  LOGGED_OUT: "auth.logged_out",
  TOKEN_REFRESHED: "auth.token_refreshed",
  TWOFA_ENABLED: "auth.2fa_enabled",
  TWOFA_DISABLED: "auth.2fa_disabled",
};
