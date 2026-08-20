/**
 * PTR / reverse DNS for the sending host. Receivers that see a HELO of
 * mail.smartlogistics.cm and a PTR of 1-2-3-4.isp.invalid treat the mail as
 * junk even when SPF passes.
 */
"use strict";

async function checkPtr(ip, { reverse } = {}) {
  const lookup = reverse || defaultReverse;
  try {
    const names = await lookup(ip);
    if (!names || !names.length) {
      return {
        ok: false, verdict: "FAIL", ip, names: [],
        hint: `No PTR record for ${ip}. Ask the host to publish reverse DNS that matches the SMTP HELO name.`,
      };
    }
    return { ok: true, verdict: "PASS", ip, names };
  } catch (err) {
    const code = err && err.code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN") {
      return {
        ok: false, verdict: "FAIL", ip, names: [],
        hint: `No PTR record for ${ip}. Ask the host to publish reverse DNS that matches the SMTP HELO name.`,
      };
    }
    return { ok: null, verdict: "UNKNOWN", ip, names: [], error: code || err.message };
  }
}

async function defaultReverse(ip) {
  const dns = require("dns/promises");
  return dns.reverse(ip);
}

module.exports = { checkPtr };
