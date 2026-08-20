/**
 * Public RBL lookups. No paid feed (Q35): the host list is configuration, so
 * adding a commercial feed later is a setting, not a code change.
 *
 * PURE given a resolver. Tests inject a stub; production uses dns/promises.
 */
"use strict";

const DEFAULT_HOSTS = ["zen.spamhaus.org", "bl.spamcop.net", "b.barracudacentral.org"];

function reverseIpv4(ip) {
  const parts = String(ip || "").split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reverse().join(".");
}

function hostsFrom(envList) {
  if (!envList) return DEFAULT_HOSTS.slice();
  return String(envList).split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * @param {string} ip
 * @param {object} [opts]
 * @param {string[]} [opts.hosts]
 * @param {function} [opts.resolve]  async (name) => string[]  throws ENOTFOUND when clean
 */
async function checkRbl(ip, { hosts = DEFAULT_HOSTS, resolve } = {}) {
  const rev = reverseIpv4(ip);
  if (!rev) {
    return { ok: null, ip, listings: [], hint: "RBL checks need an IPv4 sending address." };
  }
  const lookup = resolve || defaultResolve;
  const listings = [];
  for (const host of hosts) {
    const name = `${rev}.${host}`;
    try {
      const addrs = await lookup(name);
      if (addrs && addrs.length) listings.push({ host, listed: true, records: addrs });
      else listings.push({ host, listed: false, records: [] });
    } catch (err) {
      const code = err && err.code;
      if (code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN") {
        listings.push({ host, listed: false, records: [] });
      } else {
        listings.push({ host, listed: null, error: code || err.message });
      }
    }
  }
  const listed = listings.filter((l) => l.listed === true);
  const unknown = listings.filter((l) => l.listed === null);
  let verdict = "PASS";
  if (listed.length) verdict = "FAIL";
  else if (unknown.length === listings.length) verdict = "UNKNOWN";
  return {
    ok: verdict === "PASS" ? true : verdict === "FAIL" ? false : null,
    verdict,
    ip,
    listings,
    hint: listed.length
      ? `This IP is listed on ${listed.map((l) => l.host).join(", ")}. Mail from it will be refused or junked until you request delisting.`
      : undefined,
  };
}

async function defaultResolve(name) {
  const dns = require("dns/promises");
  return dns.resolve4(name);
}

module.exports = { checkRbl, reverseIpv4, hostsFrom, DEFAULT_HOSTS };
