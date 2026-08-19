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

const authBase = () => `https://login.microsoftonline.com/${config.MS_GRAPH_TENANT || "common"}/oauth2/v2.0`;

function isConfigured() {
  return Boolean(config.MS_GRAPH_CLIENT_ID && config.MS_GRAPH_CLIENT_SECRET);
}

/** Browser-facing consent URL. `state` is our signed CSRF+context token. */
function authorizeUrl({ state, redirectUri }) {
  const params = {
    client_id: config.MS_GRAPH_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: config.MS_GRAPH_SCOPES,
    state,
  };
  return `${authBase()}/authorize?${qs.stringify(params)}`;
}

async function exchangeCode({ code, redirectUri }) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: config.MS_GRAPH_SCOPES,
  });
}

async function refresh({ refreshToken }) {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: config.MS_GRAPH_SCOPES,
  });
}

async function tokenRequest(extra) {
  const body = qs.stringify({
    client_id: config.MS_GRAPH_CLIENT_ID,
    client_secret: config.MS_GRAPH_CLIENT_SECRET,
    ...extra,
  });
  const r = await axios.post(`${authBase()}/token`, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  // { access_token, refresh_token?, expires_in, token_type, scope }
  return r.data;
}

module.exports = { isConfigured, authorizeUrl, exchangeCode, refresh };
