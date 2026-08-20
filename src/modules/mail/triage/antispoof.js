/**
 * PURE anti-spoof evaluation. Header auth is not enough: smartlogistics-cm.com
 * passes SPF because the attacker owns it.
 */
"use strict";

function levenshtein(a, b) {
  const s = String(a), t = String(b);
  const dp = Array.from({ length: s.length + 1 }, () => Array(t.length + 1).fill(0));
  for (let i = 0; i <= s.length; i++) dp[i][0] = i;
  for (let j = 0; j <= t.length; j++) dp[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[s.length][t.length];
}

function fold(d) {
  let s = String(d || "").toLowerCase();
  s = s.replace(/[\u0430]/g, "a").replace(/[\u043e]/g, "o");
  s = s.replace(/rn/g, "m").replace(/0/g, "o");
  return s;
}

function tldSwap(a, b) {
  const pa = a.split(".");
  const pb = b.split(".");
  if (pa.length < 2 || pb.length < 2) return false;
  const sa = pa.slice(0, -1).join(".");
  const sb = pb.slice(0, -1).join(".");
  return sa === sb && pa[pa.length - 1] !== pb[pb.length - 1];
}

function lookalike(fromDomain, knownDomains = []) {
  const f = fold(fromDomain);
  for (const k of knownDomains) {
    const g = fold(k);
    if (f === g && fromDomain !== k) return { kind: "homoglyph", against: k };
    if (levenshtein(f, g) <= 2 && f !== g) return { kind: "levenshtein", against: k };
    if (tldSwap(f, g)) return { kind: "tld", against: k };
    if (f.replace(/-/g, "") === g.replace(/-/g, "") && f !== g) return { kind: "hyphen", against: k };
    const bare = (d) => d.replace(/\.[a-z0-9]+$/i, "").replace(/-/g, "");
    const ba = bare(f), bb = bare(g);
    if (ba !== bb && (ba.startsWith(bb) || bb.startsWith(ba)) && Math.abs(ba.length - bb.length) <= 4) {
      return { kind: "affix", against: k };
    }
  }
  return null;
}

const BANK = /new bank details|nouvelles coordonn[eé]es bancaires|updated remittance|\biban\b|account number/i;

function evaluate(message = {}, { parties = [], verifiedDomains = [] } = {}) {
  const from = String(message.from_address || "").toLowerCase();
  const domain = from.includes("@") ? from.split("@")[1] : "";
  const auth = (message.auth || {}).dmarc || (message.headers && message.headers["authentication-results"]) || "";
  const known = verifiedDomains.map((d) => String(d.domain || d).toLowerCase());
  const look = lookalike(domain, known);
  let verdict = "UNVERIFIED";
  const detail = { domain, look };

  if (known.includes(domain) && /dmarc=pass|spf=pass/i.test(String(auth))) {
    verdict = "VERIFIED";
  }
  if (look) verdict = "LIKELY_IMPERSONATION";
  if (BANK.test(String(message.body_text || message.subject || "")) && verdict !== "VERIFIED") {
    verdict = verdict === "LIKELY_IMPERSONATION" ? verdict : "SUSPICIOUS";
    detail.bank_change = true;
  }
  const display = String(message.from_name || "").toLowerCase();
  const partyHit = parties.find((p) => display && String(p.name || "").toLowerCase() === display && !known.includes(domain));
  if (partyHit && verdict === "UNVERIFIED") {
    verdict = "SUSPICIOUS";
    detail.first_contact = true;
  }
  return { verdict, detail };
}

module.exports = { evaluate, lookalike, levenshtein };
