"use strict";

const dnsCheck = require("../mail/dns-check");
const { parseDmarc } = require("./dmarc");
const { checkRbl, hostsFrom } = require("./rbl");
const { checkPtr } = require("./ptr");
const { toRow, regression } = require("./evaluate");
const repo = require("./deliverability.repo");
const { emitEvent } = require("../../../shared/events/emit");
const { config } = require("../../../config/env");
const notify = require("../../notification/notification.service");

const dns = require("dns/promises");

async function checkDmarc(domain) {
  try {
    const txts = await dns.resolveTxt(`_dmarc.${domain}`);
    const joined = (txts || []).map((t) => t.join(""));
    const rec = joined.find((t) => /v=dmarc1/i.test(t));
    if (!rec) {
      return {
        ok: false,
        hint: `No DMARC record at _dmarc.${domain}. Add a TXT record starting with v=DMARC1; p=none; rua=mailto:postmaster@${domain} to start monitoring spoofing.`,
      };
    }
    const parsed = parseDmarc(rec);
    return { ok: parsed.ok, record: parsed.raw, reading: parsed.reading, parsed };
  } catch (err) {
    const code = err && err.code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN") {
      return {
        ok: false,
        hint: `No DMARC record at _dmarc.${domain}. Add a TXT record starting with v=DMARC1; p=none to start monitoring.`,
      };
    }
    return { ok: null, error: code || err.message, hint: "DMARC check could not complete right now." };
  }
}

async function resolveIpv4(host) {
  if (!host) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  try {
    const addrs = await dns.resolve4(host);
    return addrs[0] || null;
  } catch {
    return null;
  }
}

async function checkOne(client, domain, { smtpHost = null, ip = null } = {}) {
  const base = await dnsCheck.checkDomain(domain, { smtpHost });
  const dmarc = await checkDmarc(domain);
  const sendingIp = ip || await resolveIpv4(smtpHost);
  const ptr = sendingIp ? await checkPtr(sendingIp) : { ok: null, hint: "No sending IP to check PTR against." };
  const rbl = sendingIp
    ? await checkRbl(sendingIp, { hosts: hostsFrom(config.MAIL_RBL_HOSTS) })
    : { ok: null, hint: "No sending IP to check RBLs against." };

  const rows = [
    toRow(domain, "MX", base.mx),
    toRow(domain, "SPF", base.spf),
    toRow(domain, "DKIM", base.dkim, { selector: base.dkim && base.dkim.selector }),
    toRow(domain, "DMARC", dmarc),
    toRow(domain, "PTR", ptr),
    toRow(domain, "RBL", rbl),
  ];

  const stored = [];
  const regressions = [];
  for (const row of rows) {
    const prev = await repo.previous(client, domain, row.record);
    const saved = await repo.insertCheck(client, row);
    stored.push(saved);
    if (regression(prev, saved)) {
      regressions.push({ domain, record: row.record, from: prev.verdict, to: saved.verdict, suggestion: saved.suggestion });
    }
  }

  if (regressions.length) {
    await emitEvent(client, {
      eventTypeKey: "deliverability.regressed", moduleKey: "MOD-70",
      entityRef: `domain:${domain}`,
      payload: { domain, regressions },
    }).catch(() => { /* @silent:storage the FAIL row is the record */ });
    await notifyMod70(client, domain, regressions).catch(() => { /* @silent:storage */ });
  }

  return { domain, checks: stored, regressions, checked_at: new Date().toISOString() };
}

async function notifyMod70(client, domain, regressions) {
  // CEOs always; everyone else with Settings view is reached by the event
  // catalogue once a workflow is bound. A wrong join against the permission
  // table would silently notify nobody — the regression row is still stored.
  const { rows } = await client.query(
    `SELECT user_id FROM app_user WHERE is_ceo = true AND status = 'ACTIVE'`,
  );
  const ids = rows.map((r) => r.user_id);
  if (!ids.length) return;
  const what = regressions.map((g) => `${g.record} ${g.from}→${g.to}`).join(", ");
  await notify.notifyMany(client, ids, {
    eventTypeKey: "deliverability.regressed",
    title: `Deliverability: ${domain} regressed`,
    body: `${domain}: ${what}. Mail from this domain will start bouncing or landing in junk until DNS is fixed.`,
    entityRef: `domain:${domain}`,
    priority: "HIGH",
  });
}

async function checkAll(client) {
  const domains = await repo.sendingDomains(client);
  const smtpHost = await repo.sendingIp(client);
  const results = [];
  for (const domain of domains) {
    results.push(await checkOne(client, domain, { smtpHost }));
  }
  return { domains: domains.length, results };
}

const dashboard = (client) => repo.latestByDomain(client);
const history = (client, domain, q) => repo.history(client, domain, q);

module.exports = { checkOne, checkAll, checkDmarc, dashboard, history };
