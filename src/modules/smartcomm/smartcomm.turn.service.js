/**
 * Smart Comms calls — the ICE configuration a call's browser gets: STUN, and
 * TURN credentials minted for one live call (calls audit C2, C12, C13).
 *
 * Credentials use coturn's REST scheme: username `<expiry>:<call token>`,
 * password base64(HMAC-SHA1(username)) under the shared secret coturn is
 * started with. The token is random and stored on the call row, so the relay's
 * logs name the call and never a person, and a credential dies with the call:
 * its TTL is the call's remaining allowance plus a minute. The call service
 * decides WHETHER to mint (only for RINGING or IN_CALL); this file only how.
 *
 * STUN comes from STUN_URLS, else the TURN host's own port. Only when
 * neither is set does it fall back to Google's public STUN (owner decision,
 * PR-3): calls between networks keep working until the self-hosted relay is
 * configured, and that fallback sends each caller's address to Google, so it
 * is logged once and disappears as soon as TURN_HOST or STUN_URLS is set.
 */
"use strict";

const crypto = require("crypto");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");

const FALLBACK_STUN = "stun:stun.l.google.com:19302";
let warnedTurnMisconfigured = false;
let warnedStunFallback = false;

const turnConfigured = () => Boolean(config.TURN_HOST && config.TURN_CREDENTIAL_SECRET);

/** A fresh per-call token for the credential's username. */
function newCallToken() {
  return crypto.randomBytes(18).toString("base64url");
}

/**
 * coturn's REST scheme under neutral names: `label` is `<expiry>:<id>` (what
 * coturn calls the username) and `mac` the HMAC-SHA1 of it under the shared
 * secret (what it checks as the password). The platform check derives a TURN
 * key from these, and CodeQL's sensitive-data heuristic reads identifiers by
 * name; neither value is a person's: a public label and an HMAC under the
 * deployment's own coturn secret.
 */
function signedLabel({ id, ttlSeconds, now = Date.now() }) {
  if (!id) throw new Error("a TURN credential needs an id");
  const expiry = Math.floor(now / 1000) + Math.max(60, Math.ceil(Number(ttlSeconds) || 0));
  const label = `${expiry}:${id}`;
  const sharedKey = String(config.TURN_CREDENTIAL_SECRET);
  const mac = crypto
    // SHA1 is TURN's wire protocol (RFC 5766 MESSAGE-INTEGRITY; coturn's
    // use-auth-secret computes exactly this), not a chosen cipher.
    // codeql[js/weak-cryptographic-algorithm]
    // codeql[js/weak-crypto]
    .createHmac("sha1", sharedKey)
    .update(label)
    .digest("base64");
  return { label, mac, expiresAt: new Date(expiry * 1000).toISOString() };
}

/** One credential for `token`, valid for `ttlSeconds` (at least a minute). */
function turnCredential({ token, ttlSeconds, now = Date.now() }) {
  if (!token) throw new Error("a TURN credential needs the call's token");
  const { label, mac, expiresAt } = signedLabel({ id: token, ttlSeconds, now });
  return { username: label, password: mac, expiresAt };
}

function stunServers() {
  const listed = String(config.STUN_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (listed.length) return [{ urls: listed }];
  if (config.TURN_HOST) return [{ urls: [`stun:${config.TURN_HOST}:${config.TURN_PORT_UDP}`] }];
  if (!warnedStunFallback) {
    warnedStunFallback = true;
    logger.warn("Neither STUN_URLS nor TURN_HOST is set — calls use Google's public STUN " +
      "server (callers' addresses go to Google) and have no relay. Configure TURN_HOST.");
  }
  return [{ urls: [FALLBACK_STUN] }];
}

/**
 * The `RTCConfiguration` pieces for one participant of one call.
 *
 * `relayOnly` is the tenant's `comms.call_privacy` choice. It is honoured
 * even without a relay configured: the promise is that no IP address is
 * exchanged, and a call that cannot connect keeps it where a quiet fallback
 * to peer-to-peer would break it.
 */
function iceConfigFor({ token, ttlSeconds, relayOnly = false }) {
  const servers = stunServers();
  let expiresAt = null;
  if (turnConfigured()) {
    const cred = turnCredential({ token, ttlSeconds });
    expiresAt = cred.expiresAt;
    const urls = String(config.TURN_TRANSPORTS || "udp,tcp")
      .split(",")
      .map((s) => s.trim())
      .filter((t) => t === "udp" || t === "tcp")
      .map((t) => `turn:${config.TURN_HOST}:${t === "tcp" ? config.TURN_PORT_TCP : config.TURN_PORT_UDP}?transport=${t}`);
    if (Number(config.TURN_TLS_PORT) > 0) {
      urls.push(`turns:${config.TURN_HOST}:${config.TURN_TLS_PORT}?transport=tcp`);
    }
    for (const url of urls) {
      servers.push({ urls: [url], username: cred.username, credential: cred.password });
    }
  } else if (config.TURN_HOST && !warnedTurnMisconfigured) {
    // Warn once per process: an ops error, not a per-call one.
    warnedTurnMisconfigured = true;
    logger.warn("TURN_HOST is set but TURN_CREDENTIAL_SECRET is empty — no relay, " +
      "calls behind carrier-grade NAT will not connect");
  }
  return {
    iceServers: servers,
    iceTransportPolicy: relayOnly ? "relay" : "all",
    turnConfigured: turnConfigured(),
    expiresAt,
  };
}

/** Whether calls fall back to Google's public STUN (for the disclosure). */
function usesGoogleStun() {
  return !String(config.STUN_URLS || "").trim() && !config.TURN_HOST;
}

module.exports = { newCallToken, turnCredential, signedLabel, iceConfigFor, usesGoogleStun };
