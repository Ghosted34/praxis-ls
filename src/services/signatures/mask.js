/**
 * IP masking (doc/SIGNATURE_ENGINEERING_GUIDE.md §3.13).
 *
 * The directive, in full:
 *   CAPTURE  ip + user_agent at the moment of OTP VERIFICATION — not page load,
 *            not request creation. The evidentiary claim is about the act of
 *            signing.
 *   STORE    the full value, on the signature row and in immutable_ledger.
 *   SEAL     NEVER rendered. It is PII, and a printed logistics document passes
 *            through a warehouse, a border post and a customer's filing cabinet.
 *   PORTAL   masked.
 *   CERT     masked unless signature_policy.certificate_full_ip is on.
 *   INTERNAL full, MOD-64 view, and the reveal is itself audited.
 *
 * ⚠ This module MUST be the only place an IP is formatted for display. A second
 *   formatter is a second place to forget the rule, and the rule is one a future
 *   surface will forget by default rather than by decision.
 */
"use strict";

/**
 * `197.210.44.12` → `197.210.***.***`
 * `2001:db8:85a3::8a2e:370:7334` → `2001:db8:***`
 *
 * Two octets (or two hextets) is the deliberate cut: enough to show an auditor
 * that two verifications came from different networks, not enough to identify a
 * subscriber. Anything unparseable returns the placeholder rather than the input
 * — a masker that falls back to echoing its argument is not a masker.
 */
function maskIp(ip) {
  const raw = String(ip || "").trim();
  if (!raw) return "";

  // IPv4, including the ::ffff: mapped form Node hands back on dual-stack sockets.
  const v4 = raw.replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const parts = v4.split(".");
    if (parts.every((p) => Number(p) >= 0 && Number(p) <= 255)) {
      return `${parts[0]}.${parts[1]}.***.***`;
    }
    return "***";
  }

  if (raw.includes(":")) {
    const hextets = raw.split(":").filter(Boolean);
    if (hextets.length >= 2) return `${hextets[0]}:${hextets[1]}:***`;
    return "***";
  }

  return "***";
}

/**
 * A user agent is fingerprintable too. The portal shows the shape of the client
 * ("Mobile browser") rather than the string, which tells a reader what they
 * want to know — was this signed on a phone at the loading bay or on a desk —
 * without publishing a tracking identifier.
 *
 * BILINGUAL, because the public portal renders it and §3.14 is explicit that
 * everything a counterparty reads is FR and EN. This returned English only, and
 * the French portal read "Appareil · Mobile browser" — caught by rendering the
 * page, not by reading it. FR is the default for the same reason as everywhere
 * else in this programme: this is a Cameroonian product.
 */
const DEVICE_WORDS = {
  unknown: { fr: "Appareil inconnu", en: "Unknown device" },
  tablet: { fr: "Navigateur sur tablette", en: "Tablet browser" },
  mobile: { fr: "Navigateur mobile", en: "Mobile browser" },
  automated: { fr: "Client automatisé", en: "Automated client" },
  desktop: { fr: "Navigateur de bureau", en: "Desktop browser" },
};

function coarseUserAgent(ua, language = "en") {
  const s = String(ua || "").toLowerCase();
  const lang = String(language).toLowerCase().startsWith("fr") ? "fr" : "en";
  const say = (key) => DEVICE_WORDS[key][lang];
  if (!s) return say("unknown");
  if (/\b(ipad|tablet)\b/.test(s)) return say("tablet");
  if (/\b(mobi|android|iphone)\b/.test(s)) return say("mobile");
  if (/\b(curl|wget|python|node|bot|crawler|spider)\b/.test(s)) return say("automated");
  return say("desktop");
}

module.exports = { maskIp, coarseUserAgent, DEVICE_WORDS };
