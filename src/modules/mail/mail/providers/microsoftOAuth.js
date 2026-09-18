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
const { AppError } = require("../../../../utils/errors");

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
  try {
    const r = await axios.post(`${authBase(c.tenant)}/token`, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    // { access_token, refresh_token?, expires_in, token_type, scope }
    return r.data;
  } catch (err) {
    throw classifyProviderError({
      error: err && err.response && err.response.data && err.response.data.error,
      description: err && err.response && err.response.data && err.response.data.error_description,
      subcode: err && err.response && err.response.data && err.response.data.error_subcode,
      httpStatus: err && err.response && err.response.status,
    });
  }
}

/**
 * WHAT ENTRA ACTUALLY SAID, IN OUR VOCABULARY.
 *
 * The token endpoint answers `{ error, error_description, error_subcode }`,
 * and `error_description` carries an `AADSTSnnnnn` code plus a paragraph aimed
 * at an Entra administrator. Left untranslated, the consent round trip lands on
 * the setup page as `mail_error=OAUTH_FAILED` — or as an axios dump — and the
 * operator cannot tell "your organisation needs admin approval" from "the
 * platform secret expired", two failures with different owners and different
 * remedies. The mapping below names the three the setup page can act on; the
 * raw description is trimmed into the message so the logs still carry it.
 *
 * Used twice: here, for token-endpoint failures, and by the OAuth callback for
 * Entra's error redirect (`?error=access_denied&error_description=…`), which is
 * the same vocabulary arriving over GET.
 */
function classifyProviderError({ error, description, subcode, httpStatus } = {}) {
  const e = String(error || "");
  const desc = String(description || "");
  // Lowercased once for the substring checks below. Deliberately `includes`,
  // not `/expired.*secret/`: the description arrives over HTTP (untrusted
  // input), and a `.*` between two literals is a polynomial-backtracking
  // shape on adversarial strings — CodeQL flags it, correctly.
  const lower = desc.toLowerCase();
  const aadsts = (/AADSTS(\d+)/i.exec(desc) || [])[1] || "";
  const short = desc ? desc.replace(/\s+/g, " ").trim().slice(0, 240) : "";

  // A bad, expired or unknown client secret — AADSTS700016 (unknown app),
  // 7000215 (bad secret), 7000222 (expired secret). Owner: whoever holds the
  // platform vault, not the operator connecting their mailbox.
  if (
    e === "invalid_client"
    || ["700016", "7000215", "7000216", "7000222"].includes(aadsts)
    || lower.includes("invalid client secret")
    || (lower.includes("expired") && lower.includes("secret"))
  ) {
    return new AppError(
      "MS_BAD_SECRET",
      `Microsoft rejected the platform's app credentials${short ? `: ${short}` : ""} (HTTP ${httpStatus || "?"})`,
      502,
    );
  }
  // The organisation requires an administrator's consent before anyone may use
  // the app — AADSTS65001 (consent required), AADSTS90094 (admin consent
  // required). Remedy: the admin-consent flow, which the setup page offers.
  if (
    e === "consent_required"
    || e === "interaction_required"
    || ["65001", "90094"].includes(aadsts)
    || /admin consent|need admin approval|approval required/i.test(desc)
  ) {
    return new AppError(
      "MS_CONSENT_REQUIRED",
      `Microsoft requires an administrator's consent for this organisation${short ? `: ${short}` : ""}`,
      502,
    );
  }
  // The redirect URI we sent is not registered on the app — AADSTS50011.
  // Owner: the app registration, i.e. the platform vault's redirect_uri field
  // or the Entra app's Redirect URIs list.
  if (aadsts === "50011" || /redirect_uri|redirect uri|reply url/i.test(desc)) {
    return new AppError(
      "MS_REDIRECT_MISMATCH",
      `Microsoft rejected the redirect URI${short ? `: ${short}` : ""}`,
      502,
    );
  }
  // The person pressed Back or cancelled at Microsoft's own screen — not a
  // failure, and the setup page says so rather than crying error.
  if (e === "access_denied" && (/cancel/i.test(String(subcode || "")) || !desc)) {
    return new AppError("OAUTH_CANCELLED", "The connection was cancelled at Microsoft's sign-in screen.", 400);
  }
  return new AppError(
    "MS_AUTH_FAILED",
    `Microsoft refused the sign-in${e ? ` (${e})` : ""}${short ? `: ${short}` : ""}`,
    502,
  );
}

/**
 * The v2 admin-consent URL: an M365 administrator opens it, signs in, and
 * presses Accept, which records tenant-wide consent for the app in THEIR
 * directory. The `tenant` segment is the configured sign-in audience, except a
 * multi-tenant keyword is swapped for `organizations` — consent is an act of an
 * organisation, and a personal account can neither give it nor need it.
 */
function adminConsentUrl({ tenant, clientId, redirectUri, scopes, state }) {
  const audience = /^(common|organizations|consumers)$/i.test(String(tenant || ""))
    ? "organizations"
    : String(tenant || "organizations");
  return (
    `https://login.microsoftonline.com/${encodeURIComponent(audience)}/v2.0/adminconsent?`
    + qs.stringify({ client_id: clientId, redirect_uri: redirectUri, scope: scopes, state })
  );
}

module.exports = {
  isConfigured,
  authorizeUrl,
  exchangeCode,
  refresh,
  credentials,
  classifyProviderError,
  adminConsentUrl,
};
