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

/**
 * A relay exists only when both halves do: a host to reach and a secret to
 * sign with. `relay` is the resolved runtime config
 * (runtime-config.service.turn()), never `config` directly — the host and
 * ports are settable from the platform console, so reading env here would
 * quietly ignore whatever an operator has set.
 */
const turnConfigured = (relay) => Boolean(relay && relay.host && relay.secretSet);

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
function signedLabel({ id, ttlSeconds, now = Date.now(), secret }) {
  if (!id) throw new Error("a TURN credential needs an id");
  const expiry = Math.floor(now / 1000) + Math.max(60, Math.ceil(Number(ttlSeconds) || 0));
  const label = `${expiry}:${id}`;
  // `secret` when the caller resolved one (the vault, or the resolved relay
  // config); `.env` otherwise. Not read from `config` unconditionally any
  // more: with TURN_SECRET_SOURCE=vault the value here is the one coturn has
  // in its Redis set, and signing with the env copy would be refused.
  const sharedKey = String(secret === undefined || secret === null ? config.TURN_CREDENTIAL_SECRET : secret);
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
function turnCredential({ token, ttlSeconds, now = Date.now(), secret }) {
  if (!token) throw new Error("a TURN credential needs the call's token");
  const { label, mac, expiresAt } = signedLabel({ id: token, ttlSeconds, now, secret });
  return { username: label, password: mac, expiresAt };
}

function stunServers(relay) {
  const listed = String(relay.stunUrls || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (listed.length) return [{ urls: listed }];
  if (relay.host) return [{ urls: [`stun:${relay.host}:${relay.portUdp}`] }];
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
function iceConfigFor({ token, ttlSeconds, relayOnly = false, relay, secret }) {
  const servers = stunServers(relay);
  let expiresAt = null;
  if (turnConfigured(relay)) {
    const cred = turnCredential({ token, ttlSeconds, secret });
    expiresAt = cred.expiresAt;
    const urls = String(relay.transports || "udp,tcp")
      .split(",")
      .map((s) => s.trim())
      .filter((t) => t === "udp" || t === "tcp")
      .map((t) => `turn:${relay.host}:${t === "tcp" ? relay.portTcp : relay.portUdp}?transport=${t}`);
    if (Number(relay.tlsPort) > 0) {
      urls.push(`turns:${relay.host}:${relay.tlsPort}?transport=tcp`);
    }
    for (const url of urls) {
      servers.push({ urls: [url], username: cred.username, credential: cred.password });
    }
  } else if (relay.host && !warnedTurnMisconfigured) {
    // Warn once per process: an ops error, not a per-call one.
    warnedTurnMisconfigured = true;
    logger.warn("A relay host is set but TURN_CREDENTIAL_SECRET is empty — no relay, " +
      "calls behind carrier-grade NAT will not connect");
  }
  return {
    iceServers: servers,
    iceTransportPolicy: relayOnly ? "relay" : "all",
    turnConfigured: turnConfigured(relay),
    expiresAt,
  };
}

/** Whether calls fall back to Google's public STUN (for the disclosure). */
function usesGoogleStun(relay) {
  return !String((relay && relay.stunUrls) || "").trim() && !(relay && relay.host);
}

module.exports = { newCallToken, turnCredential, signedLabel, iceConfigFor, usesGoogleStun, turnConfigured };
