/**
 * DMARC TXT parse — PURE. A record like `v=DMARC1; p=none; rua=mailto:…`
 * becomes a verdict plus a sentence an operator can act on.
 */
"use strict";

function parseDmarc(txt) {
  const raw = Array.isArray(txt) ? txt.join("") : String(txt || "");
  const parts = {};
  for (const piece of raw.split(";")) {
    const [k, ...rest] = piece.split("=");
    if (!k) continue;
    parts[k.trim().toLowerCase()] = rest.join("=").trim();
  }
  const policy = (parts.p || "").toLowerCase();
  const sp = (parts.sp || "").toLowerCase();
  const rua = parts.rua || null;
  const ruf = parts.ruf || null;
  const adkim = (parts.adkim || "r").toLowerCase();
  const aspf = (parts.aspf || "r").toLowerCase();

  let reading;
  if (!parts.v || !/^dmarc1$/i.test(parts.v)) {
    reading = "This is not a DMARC record (it should start with v=DMARC1).";
  } else if (policy === "none") {
    reading = "p=none — you are monitoring only; nobody is stopping a spoof of your domain yet.";
  } else if (policy === "quarantine") {
    reading = "p=quarantine — unauthenticated mail claiming to be you is sent to spam. A step toward reject.";
  } else if (policy === "reject") {
    reading = "p=reject — unauthenticated mail claiming to be you is refused. This is the policy that actually stops spoofing.";
  } else {
    reading = `Unknown policy p=${policy || "(missing)"}. Valid values are none, quarantine, reject.`;
  }

  return {
    raw,
    policy: policy || null,
    subdomain_policy: sp || null,
    rua,
    ruf,
    dkim_alignment: adkim === "s" ? "strict" : "relaxed",
    spf_alignment: aspf === "s" ? "strict" : "relaxed",
    reading,
    ok: policy === "quarantine" || policy === "reject" || policy === "none",
  };
}

module.exports = { parseDmarc };
