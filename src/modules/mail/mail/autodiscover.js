/**
 * IMAP/SMTP autodiscovery for the "Other email provider" connect flow. Given an
 * address, suggest transport settings so the user rarely types hosts by hand:
 *   1) known consumer domains (gmail, outlook, yahoo, icloud, zoho…),
 *   2) MX-record inference (Google Workspace / Microsoft 365 / Zoho custom domains),
 *   3) convention (imap./smtp./mail.<domain>) confirmed by a short TLS probe.
 * Best-effort and fast: every network step is timeout-bounded and falls back to a
 * plain convention guess. The user can always override before saving.
 */
"use strict";

const dns = require("dns").promises;
const tls = require("tls");
const { AppError } = require("../../../utils/errors");

const gmail = { imap_host: "imap.gmail.com", imap_port: 993, imap_secure: true, smtp_host: "smtp.gmail.com", smtp_port: 465, smtp_secure: true, oauth_hint: "google_gmail" };
const o365 = { imap_host: "outlook.office365.com", imap_port: 993, imap_secure: true, smtp_host: "smtp.office365.com", smtp_port: 587, smtp_secure: false, oauth_hint: "microsoft_graph" };
const yahoo = { imap_host: "imap.mail.yahoo.com", imap_port: 993, imap_secure: true, smtp_host: "smtp.mail.yahoo.com", smtp_port: 465, smtp_secure: true };
const icloud = { imap_host: "imap.mail.me.com", imap_port: 993, imap_secure: true, smtp_host: "smtp.mail.me.com", smtp_port: 587, smtp_secure: false };
const zoho = { imap_host: "imap.zoho.com", imap_port: 993, imap_secure: true, smtp_host: "smtp.zoho.com", smtp_port: 465, smtp_secure: true };

const KNOWN = {
  "gmail.com": gmail, "googlemail.com": gmail,
  "outlook.com": o365, "hotmail.com": o365, "live.com": o365, "msn.com": o365, "office365.com": o365,
  "yahoo.com": yahoo, "ymail.com": yahoo,
  "icloud.com": icloud, "me.com": icloud, "mac.com": icloud,
  "zoho.com": zoho, "zohomail.com": zoho,
};

/**
 * Which managed provider runs a domain's mailboxes, read off its MX.
 *
 * ONE list, used twice: `autodiscover` turns a hit into transport settings, and
 * the connect path uses the same hit to refuse a password where the provider no
 * longer accepts one. A second copy of these patterns would drift, and the
 * symptom of that drift is a mailbox that autodiscovers as Microsoft and is then
 * waved through as IMAP with a password that cannot work.
 */
const MX_PROVIDERS = [
  { key: "google", match: /google|googlemail|aspmx/, settings: gmail },
  { key: "microsoft", match: /outlook|office365|protection\.outlook/, settings: o365 },
  { key: "zoho", match: /zoho/, settings: zoho },
];

/** Consumer domains whose provider is known without a lookup. */
const CONSUMER_PROVIDERS = {
  "gmail.com": "google", "googlemail.com": "google",
  "outlook.com": "microsoft", "hotmail.com": "microsoft", "live.com": "microsoft",
  "msn.com": "microsoft", "office365.com": "microsoft",
};

/**
 * `{ key, source }` naming who runs this domain's mailboxes, or null when it is
 * an ordinary mail host (cPanel, a private server) or cannot be determined.
 *
 * A resolver failure returns null — "we could not tell", never "nobody". Callers
 * gate on a POSITIVE answer only, so a DNS hiccup can never block a connection
 * that would otherwise have worked.
 */
async function hostedProviderOf(domain) {
  const d = String(domain || "").trim().toLowerCase().replace(/^.*@/, "");
  if (!d) return null;
  if (CONSUMER_PROVIDERS[d]) return { key: CONSUMER_PROVIDERS[d], source: "known" };
  let mxHosts = "";
  try {
    mxHosts = (await dns.resolveMx(d)).map((m) => String(m.exchange || "").toLowerCase()).join(" ");
  } catch {
    return null;
  }
  const hit = MX_PROVIDERS.find((p) => p.match.test(mxHosts));
  return hit ? { key: hit.key, source: "mx", mx: mxHosts } : null;
}

/**
 * The cPanel preset.
 *
 * The first tenant runs cPanel, and this programme deliberately does one provider
 * properly rather than four adequately — so the single most common setup in the
 * target market gets a one-click answer instead of five fields to guess at.
 *
 * cPanel mail is predictable to the point of being boring, which is exactly why
 * a preset works: `mail.<domain>`, IMAP 993 over SSL, SMTP 465 over SSL, and the
 * username is the FULL email address, not the local part. That last one is the
 * single most common reason a cPanel mailbox fails to authenticate, so it is
 * returned explicitly rather than left for the user to work out from a rejection.
 */
function cpanelPreset(email) {
  const domain = String(email || "").split("@").pop().trim().toLowerCase();
  if (!domain || !domain.includes(".")) {
    throw new AppError("VALIDATION_ERROR", "A full email address is needed to work out the cPanel settings.", 422);
  }
  return {
    email, domain, source: "cpanel-preset",
    imap_host: `mail.${domain}`, imap_port: 993, imap_secure: true,
    smtp_host: `mail.${domain}`, smtp_port: 465, smtp_secure: true,
    auth_user: email,
    note: "cPanel mailboxes authenticate with the full email address as the username, not just the part before the @.",
  };
}

/** TLS-connect probe: true if host:port accepts a TLS handshake within `ms`. */
function probe(host, port, ms = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; try { socket.destroy(); } catch { /* @silent:teardown the socket may already be gone; the probe verdict is the useful answer */ } resolve(ok); } };
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => finish(true));
    socket.setTimeout(ms, () => finish(false));
    socket.on("error", () => finish(false));
  });
}

async function firstReachable(hosts, port) {
  for (const h of hosts) {
     
    if (await probe(h, port)) return h;
  }
  return null;
}

async function autodiscover({ email } = {}) {
  const domain = String(email || "").split("@")[1]?.toLowerCase();
  if (!domain) throw new AppError("VALIDATION_ERROR", "a full email address is required", 422);

  if (KNOWN[domain]) return { source: "known", provider: domain, ...KNOWN[domain] };

  let mxHosts = "";
  // @silent:parse — a domain with no usable MX answer falls through to the
  // convention guess below, which is the defined fallback for exactly this case.
  try { mxHosts = (await dns.resolveMx(domain)).map((m) => m.exchange.toLowerCase()).join(" "); } catch { /* @silent:parse no MX; the convention guess below is the fallback */ }
  const hosted = MX_PROVIDERS.find((p) => p.match.test(mxHosts));
  if (hosted) return { source: `mx:${hosted.key}`, ...hosted.settings };

  // Convention: prefer a host that actually answers TLS on 993 / 465.
  const imap_host = (await firstReachable([`imap.${domain}`, `mail.${domain}`], 993)) || `mail.${domain}`;
  const smtpSecureHost = await firstReachable([`smtp.${domain}`, `mail.${domain}`], 465);
  return {
    source: mxHosts ? "convention+mx" : "convention",
    imap_host, imap_port: 993, imap_secure: true,
    smtp_host: smtpSecureHost || `smtp.${domain}`,
    smtp_port: smtpSecureHost ? 465 : 587,
    smtp_secure: Boolean(smtpSecureHost),
  };
}

module.exports = { autodiscover, cpanelPreset, hostedProviderOf };
