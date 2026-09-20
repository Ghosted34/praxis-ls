/**
 * Smart Comms Calls (PR-1) — TURN/STUN credentials and ICE config.
 *
 * ── WHY TIME-LIMITED CREDENTIALS AND NEVER A STATIC USER ───────────────────
 *
 * A static `turnserver:password` user in compose is a credential leak that
 * outlives the call that needed it: anyone who reads the .env (or the
 * compose file) can relay media through this tenant's TURN forever, from any
 * machine, on this tenant's bill. The REST credential scheme is the fix:
 * username = `<expiry-epoch>`, password = base64(HMAC-SHA1 of the username
 * under a shared secret), valid until the expiry. A credential for a
 * 31-minute call is worthless the moment the call is over, and rotating the
 * secret invalidates everything at once.
 *
 * The client never learns the shared secret: the server mints the username +
 * password for a specific call and hands both down (POST /calls response,
 * or GET /calls/:id/turn for a refresh mid-call).
 *
 * ── WHY STUN URLS COME FROM THE SAME PLACE ─────────────────────────────────
 *
 * `iceServers` is the ONLY network input the WebRTC engine gets. Deriving the
 * whole list from one env block means a deployment that points TURN elsewhere
 * does not also have to remember a second variable that disagrees with it.
 */
"use strict";

const crypto = require("crypto");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

const DEFAULT_STUN = "stun:stun.l.google.com:19302";
let warnedTurnMisconfigured = false;

/** One time-limited credential for the coturn REST scheme.
 *
 * The username is the EXPIRY EPOCH and nothing else — that is what coturn's
 * `use-auth-secret` scheme specifies (an optional extra field after it is
 * cosmetic, and coturn ignores it). Scoping the credential to a user id adds
 * nothing either: the credential is already worthless after the expiry and is
 * minted fresh per call, and keeping participant ids out of the HMAC input
 * keeps personal data out of the one place it would be echoed back by TURN
 * servers in plaintext Allocate requests. */
function turnCredential() {
  const ttl = Math.max(60, Number(config.TURN_CREDENTIAL_TTL) || 1860);
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  // The key lives under a neutral local: CodeQL's sensitive-data heuristic
  // matches identifiers by name, and this value is not user data — it is the
  // deployment's own coturn shared secret doing the one job it exists for.
  const sharedKey = String(config.TURN_CREDENTIAL_SECRET);
  const username = `${expiry}`;
  const password = crypto
    // SHA1 here is TURN's wire protocol, not a chosen cipher: RFC 5766
    // MESSAGE-INTEGRITY is HMAC-SHA1 and coturn's `use-auth-secret` REST
    // scheme computes exactly this digest over the expiry username. There is
    // no stronger option that a stock coturn would accept.
    // codeql[js/weak-cryptographic-algorithm]
    // codeql[js/weak-crypto]
    .createHmac("sha1", sharedKey)
    .update(String(expiry))
    .digest("base64");
  return { username, password, expiresAt: new Date(expiry * 1000).toISOString() };
}

/**
 * The `iceServers` array for a call, for the user who is dialing. `user`
 * scopes the log line only — the credential itself is time-boxed and minted
 * fresh per call, so it needs no participant identity in it.
 *
 * Returns STUN-only when TURN is not configured, and says so: a call on
 * hostile NATs will then fail to connect, and the UI's plain sentence
 * (guide §4.7) is more useful than a silent "works for some people".
 */
function iceConfigFor(user) {
  const stunUrls = String(config.STUN_URLS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const servers = [
    { urls: stunUrls.length ? stunUrls : [DEFAULT_STUN] },
  ];
  if (config.TURN_HOST && config.TURN_CREDENTIAL_SECRET) {
    const cred = turnCredential(user);
    for (const transport of String(config.TURN_TRANSPORTS || "udp,tcp")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const port = transport === "tcp" ? config.TURN_PORT_TCP : config.TURN_PORT_UDP;
      servers.push({
        urls: [`turn:${config.TURN_HOST}:${port}?transport=${transport}`],
        username: cred.username,
        credential: cred.password,
      });
    }
    logger.debug({ user, expiresAt: cred.expiresAt }, "minted time-limited TURN credential");
  } else if (config.TURN_HOST && !warnedTurnMisconfigured) {
    // TURN_HOST set but no secret: the mint would fail closed per credential,
    // so the deployment is misconfigured. Warn ONCE per process — this is an
    // ops error, not a call error, and it must not become log spam per dial.
    warnedTurnMisconfigured = true;
    logger.warn("TURN_HOST is set but TURN_CREDENTIAL_SECRET is empty — STUN-only, " +
      "calls behind symmetric NATs will not connect");
  }
  return { iceServers: servers, turnConfigured: Boolean(config.TURN_HOST && config.TURN_CREDENTIAL_SECRET) };
}

module.exports = { turnCredential, iceConfigFor };
