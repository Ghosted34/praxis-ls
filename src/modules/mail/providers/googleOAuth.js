/**
 * Google OAuth 2.0 (authorization code + refresh) for the Gmail adapter.
 * Deploy-wide Google Cloud client (config.GOOGLE_*). axios-only, no googleapis
 * dependency. Tokens are persisted by mail.service into the tenant vault; this
 * module only talks to Google's IdP.
 *
 * `access_type=offline` + `prompt=consent` are required to receive a refresh
 * token (Google only returns one on the first consent unless prompt=consent).
 */
"use strict";

const axios = require("axios");
const qs = require("querystring");
const { config } = require("../../../config/env");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function isConfigured() {
  return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
}

function authorizeUrl({ state, redirectUri }) {
  const params = {
    client_id: config.GOOGLE_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: config.GOOGLE_SCOPES,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  };
  return `${AUTH_URL}?${qs.stringify(params)}`;
}

async function exchangeCode({ code, redirectUri }) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

async function refresh({ refreshToken }) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

async function tokenRequest(extra) {
  const body = qs.stringify({
    client_id: config.GOOGLE_CLIENT_ID,
    client_secret: config.GOOGLE_CLIENT_SECRET,
    ...extra,
  });
  const r = await axios.post(TOKEN_URL, body, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  // { access_token, refresh_token?, expires_in, scope, token_type, id_token? }
  return r.data;
}

module.exports = { isConfigured, authorizeUrl, exchangeCode, refresh };
