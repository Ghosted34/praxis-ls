/**
 * Microsoft identity platform OAuth 2.0 (authorization code + refresh) for the
 * Graph mail adapter. Deploy-wide Azure app (config.MS_GRAPH_*). Kept tiny and
 * axios-only — no MSAL dependency. Tokens are handled by the caller (mail.service
 * persists the bundle to the tenant vault); this module only talks to the IdP.
 */
"use strict";

const axios = require("axios");
const qs = require("querystring");
const { config } = require("../../../../config/env");

const platformSettings = require("../../../../services/platform/settings.service");

/**
 * WHERE THE CREDENTIALS COME FROM: the platform vault first, `.env` last.
 *
 * These are deploy-wide infrastructure credentials, and this repo has one place
 * for those — the encrypted `platform_setting` store, set and live-tested in
 * Platform Console → Integrations. `.env` stays as a last-resort default so an
 * existing deployment keeps working the moment this ships and can be migrated
 * on its own schedule, which is the same tiering `mail.fallback` already uses.
 *
 * It matters more here than for most credentials: an Entra client secret
 * EXPIRES. Kept in `.env` it is invisible, undated and only editable by whoever
 * can reach the server; kept here it is encrypted at rest, shows its last4 and
 * an expiry note in the console, and has a Test button that answers "is this
 * still good?" in one click instead of after every mailbox has quietly stopped
 * syncing.
 *
 * Resolved per call rather than cached: a secret is rotated precisely when the
 * old one has stopped working, and a cache would keep serving the dead one.
 * These calls happen at consent and at token refresh, not per message.
 */
async function credentials() {
  let stored = null;
  try {
    stored = await platformSettings.resolve("mail", "microsoft_graph");
  } catch {
    /* @silent:storage the platform store being unreachable must fall through to
       env, not take mailbox OAuth down with it */
  }
  const v = (stored && stored.value) || {};
  return {
    client_id: v.client_id || config.MS_GRAPH_CLIENT_ID,
    client_secret: (stored && stored.secret) || config.MS_GRAPH_CLIENT_SECRET,
    tenant: v.tenant || config.MS_GRAPH_TENANT || "common",
    scopes: v.scopes || config.MS_GRAPH_SCOPES,
    redirect_uri: v.redirect_uri || config.MS_GRAPH_REDIRECT_URI || null,
  };
}

const authBase = (tenant) => `https://login.microsoftonline.com/${tenant || "common"}/oauth2/v2.0`;

async function isConfigured() {
  const c = await credentials();
  return Boolean(c.client_id && c.client_secret);
}

/** Browser-facing consent URL. `state` is our signed CSRF+context token. */
async function authorizeUrl({ state, redirectUri }) {
  const c = await credentials();
  const params = {
    client_id: c.client_id,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: c.scopes,
    state,
  };
  return `${authBase(c.tenant)}/authorize?${qs.stringify(params)}`;
}

async function exchangeCode({ code, redirectUri }) {
  const c = await credentials();
  return tokenRequest(c, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: c.scopes,
  });
}

async function refresh({ refreshToken }) {
  const c = await credentials();
  return tokenRequest(c, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: c.scopes,
  });
}

async function tokenRequest(c, extra) {
  const body = qs.stringify({
    client_id: c.client_id,
    client_secret: c.client_secret,
    ...extra,
  });
  const r = await axios.post(`${authBase(c.tenant)}/token`, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  // { access_token, refresh_token?, expires_in, token_type, scope }
  return r.data;
}

module.exports = { isConfigured, authorizeUrl, exchangeCode, refresh, credentials };
