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
const { AppError } = require("../../utils/errors");

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

/** TLS-connect probe: true if host:port accepts a TLS handshake within `ms`. */
function probe(host, port, ms = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; try { socket.destroy(); } catch { /* noop */ } resolve(ok); } };
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
  try { mxHosts = (await dns.resolveMx(domain)).map((m) => m.exchange.toLowerCase()).join(" "); } catch { /* no MX */ }
  if (/google|googlemail|aspmx/.test(mxHosts)) return { source: "mx:google", ...gmail };
  if (/outlook|office365|protection\.outlook/.test(mxHosts)) return { source: "mx:microsoft", ...o365 };
  if (/zoho/.test(mxHosts)) return { source: "mx:zoho", ...zoho };

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

module.exports = { autodiscover };
