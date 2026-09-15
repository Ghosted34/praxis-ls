/**
 * Outbound ROUTE check — "will this message leave the building at all?"
 *
 * Every other check in this module asks whether a message we send will be
 * ACCEPTED once it arrives: SPF, DKIM and DMARC prove identity, PTR and RBL
 * prove reputation. This one asks something earlier, and more embarrassing:
 * whether the relay will route the message to the recipient's real mail server
 * in the first place.
 *
 * ── THE FAILURE THIS NAMES ────────────────────────────────────────────────
 *
 * A shared cPanel/Exim server registers every domain it hosts in
 * `/etc/localdomains` and from then on believes it is the FINAL DESTINATION for
 * that domain's mail. That belief is not re-checked against DNS. So when a
 * tenant hosts their WEBSITE on the same box we relay through, but points their
 * MX at Microsoft 365 or Google Workspace — the single most common arrangement
 * in this market, and the one every "we bought hosting, then moved mail to
 * Microsoft" story produces — outbound mail to that domain is delivered to a
 * LOCAL mailbox on the relay instead of being routed to the real MX.
 *
 * The message never reaches the recipient's provider. Exim answers 250, so
 * `email_send_log` records SENT with a provider message-id, every screen in the
 * product says delivered, and no bounce is ever generated because from the
 * server's point of view nothing failed. Addresses that happen to exist as local
 * cPanel mailboxes appear to work perfectly, which is what makes the bug so hard
 * to see: it fails only for the addresses that live at the real provider.
 *
 * ── WHY DNS IS ENOUGH TO DETECT IT ────────────────────────────────────────
 *
 * We cannot read the relay's Exim configuration from Node, and we should not
 * need shell access to a box to know our own mail is being swallowed. The
 * signature is visible in public DNS alone:
 *
 *     relay host IP   ==  the recipient domain's own A record   (co-hosted)
 *     recipient's MX  ->  an IP that is NOT the relay           (mail is elsewhere)
 *
 * BOTH halves are required, and that is the whole subtlety. Co-hosting on its
 * own is perfectly normal — it is simply a domain whose site and mail both live
 * on our relay, and there the local delivery is CORRECT. A remote MX on its own
 * is the ordinary case for every domain on the internet we do not host. Only the
 * combination — we host the domain, but its mail lives somewhere else — is the
 * trap, and in that combination local delivery is always wrong.
 *
 * `classify` is pure so the decision is testable without a resolver; `checkRoute`
 * is the network wrapper. Every lookup failure degrades to UNKNOWN rather than a
 * verdict: telling an administrator their mail is being swallowed when the
 * resolver merely timed out would be worse than saying nothing.
 */
"use strict";

const dns = require("dns/promises");

const STATES = {
  /** Relay routes this domain's mail onward, or legitimately owns it. */
  OK: "OK",
  /** We host the domain but its mail lives elsewhere — local delivery swallows it. */
  LOCAL_TRAP: "LOCAL_TRAP",
  /** Not enough resolved to judge. Never reported as a fault. */
  UNKNOWN: "UNKNOWN",
};

/** DNS codes that mean "no such record" rather than "could not look up". */
const NO_RECORD = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

const asList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);
const overlap = (a, b) => asList(a).some((x) => asList(b).includes(x));

/**
 * Pure verdict from resolved facts.
 *
 *   relayIps      A records of the SMTP host we send through
 *   recipientIps  A records of the recipient domain itself
 *   mxIps         A records of the recipient domain's MX hosts
 *
 * Returns { state, ok, reason }. `ok` is false ONLY for LOCAL_TRAP — UNKNOWN is
 * an absence of evidence, and callers must not render it as a failure.
 */
function classify({ relayIps, recipientIps, mxIps, hasMx = true } = {}) {
  const relay = asList(relayIps);
  const recipient = asList(recipientIps);
  const mx = asList(mxIps);

  if (!relay.length) {
    return { state: STATES.UNKNOWN, ok: null, reason: "The relay host could not be resolved to an IP." };
  }
  // A domain with no MX at all is not this check's business — it is either
  // broken or mail-less, and either way local delivery is not what is wrong.
  if (!hasMx) {
    return { state: STATES.UNKNOWN, ok: null, reason: "The recipient domain publishes no MX record." };
  }
  if (!recipient.length) {
    return { state: STATES.UNKNOWN, ok: null, reason: "The recipient domain could not be resolved to an IP." };
  }
  // Not co-hosted: the relay has no reason to think it owns this domain.
  if (!overlap(relay, recipient)) {
    return { state: STATES.OK, ok: true, reason: "The relay does not host this domain, so it will route by MX." };
  }
  // Co-hosted AND the relay is itself the mail exchanger — local delivery is the
  // correct answer here, not a trap.
  if (mx.length && overlap(relay, mx)) {
    return { state: STATES.OK, ok: true, reason: "The relay is this domain's own mail server." };
  }
  if (!mx.length) {
    return { state: STATES.UNKNOWN, ok: null, reason: "The recipient's MX hosts could not be resolved to IPs." };
  }
  return {
    state: STATES.LOCAL_TRAP,
    ok: false,
    reason:
      "The relay hosts this domain but its mail is delivered elsewhere. Mail relayed through this "
      + "server is being delivered to a local mailbox instead of the domain's real mail server — "
      + "accepted, never delivered, and never bounced. Set this domain's mail routing on the relay "
      + "to a REMOTE mail exchanger.",
  };
}

async function resolve4(host) {
  if (!host) return [];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [host];
  try {
    return await dns.resolve4(host);
  } catch {
    return [];
  }
}

/** Resolve every MX host of `domain` to IPs. Empty when the domain has no MX. */
async function mxAddresses(domain) {
  let records = [];
  try {
    records = await dns.resolveMx(domain);
  } catch (err) {
    if (NO_RECORD.has(err && err.code)) return { hasMx: false, hosts: [], ips: [] };
    return { hasMx: null, hosts: [], ips: [] };
  }
  const hosts = (records || []).map((r) => String(r.exchange || "").toLowerCase()).filter(Boolean);
  if (!hosts.length) return { hasMx: false, hosts: [], ips: [] };
  const ips = (await Promise.all(hosts.map(resolve4))).flat();
  return { hasMx: true, hosts, ips };
}

/**
 * Live check: does `smtpHost` actually route mail for `recipientDomain` onward?
 *
 * Returns the classification plus everything it resolved, so the UI can show the
 * administrator the same three facts the verdict was drawn from rather than
 * asking them to trust it.
 */
async function checkRoute({ smtpHost, recipientDomain } = {}) {
  const domain = String(recipientDomain || "").trim().toLowerCase().replace(/^.*@/, "");
  if (!smtpHost || !domain) {
    return { ...classify({}), smtp_host: smtpHost || null, domain: domain || null };
  }
  const [relayIps, recipientIps, mx] = await Promise.all([
    resolve4(smtpHost),
    resolve4(domain),
    mxAddresses(domain),
  ]);
  const verdict = classify({
    relayIps,
    recipientIps,
    mxIps: mx.ips,
    hasMx: mx.hasMx !== false,
  });
  return {
    ...verdict,
    smtp_host: smtpHost,
    domain,
    relay_ips: relayIps,
    recipient_ips: recipientIps,
    mx_hosts: mx.hosts,
    mx_ips: mx.ips,
  };
}

/* ── THE SEND-PATH GUARD ───────────────────────────────────────────────────
 *
 * Detection is only half of it. The whole cost of this incident was that the
 * system reported SUCCESS: a message was accepted by the relay, written to
 * `email_send_log` as SENT with a real provider message-id, shown as delivered
 * on every screen, and silently discarded. Nobody learns anything from a lie
 * that confident, and a bounce never comes to correct it.
 *
 * So on the send path the verdict is not advice. A recipient we can prove is
 * unreachable through this relay FAILS, loudly, and is logged FAILED. A visible
 * failure the operator can act on is strictly better than a silent success they
 * cannot. This is the rule for EVERY recipient domain — Microsoft, Google, Zoho
 * or a plain mail host — not a special case for the one that caught us.
 *
 * CACHING, because this sits in front of every OTP, invite and invoice. The
 * answer is a property of DNS, not of the message, so it is cached per
 * relay+domain pair for ten minutes. The steady state costs no lookups at all;
 * a misconfiguration is still caught within ten minutes of appearing. The cache
 * is bounded so a spam run against many domains cannot grow it without limit.
 */
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 500;
const cache = new Map();

async function checkRouteCached({ smtpHost, recipientDomain }) {
  const key = `${smtpHost}|${recipientDomain}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await checkRoute({ smtpHost, recipientDomain });
  // Only a settled verdict is worth caching. UNKNOWN usually means the resolver
  // was unhappy, and pinning that for ten minutes would suppress the check
  // exactly when DNS has just come back.
  if (value.state !== STATES.UNKNOWN) {
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + TTL_MS });
  }
  return value;
}

/**
 * The address out of `Name <a@b.cm>`, or the string itself when it is bare.
 *
 * Deliberately NOT a regex. `/<([^>]+)>/` is unanchored, so on a recipient with
 * no `>` the engine restarts `[^>]+` at every `<` and scans to the end each
 * time — quadratic. That matters here and not in general, because this sits on
 * the send path and `to` is whatever a person typed into a compose box: 64KB of
 * `<=<=<=…` held the event loop for 2.6 seconds, and four times the input cost
 * sixteen times the time. CodeQL flagged it as a high-severity ReDoS and was
 * right. Two index lookups and a slice answer the same question in one pass.
 *
 * `lastIndexOf` for the opening bracket, not `indexOf`: a display name may
 * itself contain `<`, and it is the LAST one that opens the address. The regex
 * got this wrong too — on `a<b" <x@y.cm>` it returned `b" <x@y.cm`.
 */
const addressOf = (raw) => {
  const s = String(raw || "").trim().toLowerCase();
  const open = s.lastIndexOf("<");
  if (open === -1) return s;
  const close = s.indexOf(">", open + 1);
  return close === -1 ? s : s.slice(open + 1, close);
};

const domainsOf = (to) => {
  const list = Array.isArray(to) ? to : String(to || "").split(",");
  return [...new Set(
    list
      .map(addressOf)
      .map((a) => a.split("@")[1])
      .filter(Boolean),
  )];
};

/**
 * Throw when this relay would swallow mail for any of `to`.
 *
 * Silent on every other outcome, including UNKNOWN — an unproven suspicion must
 * never stop a message. `err.code` is `MAIL_ROUTE_TRAPPED` so the send log and
 * the UI can key a fix guide off it.
 */
async function assertRoutable({ smtpHost, to }) {
  if (!smtpHost || !to) return;
  for (const domain of domainsOf(to)) {
    let verdict;
    try {
      verdict = await checkRouteCached({ smtpHost, recipientDomain: domain });
    } catch {
      return; // A failing checker must never block mail.
    }
    if (verdict.state !== STATES.LOCAL_TRAP) continue;
    const err = new Error(
      `Mail to ${domain} cannot be delivered through ${smtpHost}. That server hosts `
      + `${domain} and would deliver this message to a local mailbox on itself instead of `
      + `sending it to the domain's real mail server (${verdict.mx_hosts.join(", ") || "its MX"}). `
      + "The message has NOT been sent. Set that domain's mail routing on the relay to a remote "
      + "mail exchanger, or send through a relay that does not host it.",
    );
    err.code = "MAIL_ROUTE_TRAPPED";
    err.details = {
      domain,
      smtp_host: smtpHost,
      relay_ips: verdict.relay_ips,
      mx_hosts: verdict.mx_hosts,
    };
    throw err;
  }
}

/** Test seam — the cache is process-wide and would leak between cases. */
function _resetCache() {
  cache.clear();
}

module.exports = { STATES, classify, checkRoute, checkRouteCached, assertRoutable, _resetCache };
