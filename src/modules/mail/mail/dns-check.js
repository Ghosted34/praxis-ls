/**
 * DNS deliverability checks for the mail-setup wizard (Comms → Setup guide).
 *
 * Zoho-style: verify what can be verified automatically — MX, SPF and DKIM
 * lookups against the sending domain — and hand the UI a clear per-record
 * verdict. Where a lookup is IMPOSSIBLE (resolver failure, provider-only
 * verification), the verdict is `ok: null` and the wizard falls back to a
 * self-check tick, per the product decision "max auto-verify, self-check only
 * where practically impossible".
 *
 * Shape returned by `checkDomain`:
 *   { domain, mx, spf, dkim, done, checked_at }
 *   each record: { ok: true | false | null, ...details }
 *     ok:true   — record present (and for SPF/DKIM, the record value)
 *     ok:false  — definitively missing, with a suggested value / hint
 *     ok:null   — could not be checked (resolver error); self-check territory
 *
 * `smtpHost` (from the tenant's resolved transport) only sharpens the
 * suggestions: relay presets for known ESPs (SendGrid/SES/Mailgun/…), an
 * `include:` for the SMTP host's own domain, or a plain `mx` record.
 */
"use strict";
const dns = require("dns/promises");

/** DNS codes that mean "no such record" rather than "could not look up". */
const NO_RECORD = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

const DKIM_SELECTORS = [
  "default", "dkim", "google", "selector1", "selector2", "s1", "s2", "k1",
  "mail", "smtp", "email", "cpanel", "x",
];

/** Known relays → SPF include + where DKIM gets enabled (their dashboard). */
const RELAYS = [
  { match: /sendgrid/i, include: "sendgrid.net", dkimHint: "Enable DKIM in SendGrid → Settings → Sender Authentication, then verify again." },
  { match: /amazonses|amazonaws/i, include: "amazonses.com", dkimHint: "Verify the domain in SES and enable Easy DKIM, then verify again." },
  { match: /mailgun/i, include: "mailgun.org", dkimHint: "Publish the DKIM record Mailgun shows under Sending → Domains." },
  { match: /mailjet/i, include: "spf.mailjet.com", dkimHint: "Validate the domain in Mailjet — SPF & DKIM values are under Domain authentication." },
  { match: /mandrill|mailchimp/i, include: "spf.mandrillapp.com", dkimHint: "Verify the sending domain in Mandrill and enable DKIM." },
  { match: /postmark/i, include: "spf.mtasv.net", dkimHint: "Add a Sender Signature in Postmark and copy its DKIM record to DNS." },
  { match: /zoho|zillum/i, include: "zoho.com", dkimHint: "Zoho Mail publishes DKIM automatically for its domains — check the admin console, then verify again." },
  { match: /outlook|office365|protection\.outlook/i, include: "spf.protection.outlook.com", dkimHint: "Enable DKIM for the domain in Microsoft 365 (Defender → Email authentication), then verify again." },
  { match: /google|gmail/i, include: "_spf.google.com", dkimHint: "Generate DKIM in Google Workspace (Apps → Gmail → Authenticate email); its selector is 'google'." },
];

const relayFor = (host) => RELAYS.find((r) => r.match.test(String(host || ""))) || null;

/** Last two labels of a hostname — right for the OHADA region (co.cm, .cm…). */
const domainOf = (host) => {
  const parts = String(host || "").toLowerCase().split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(".") : null;
};

/** Strip the left-most label ("mail.x.cm" → "x.cm"); null when already bare. */
const parentOf = (domain) => {
  const parts = String(domain).split(".");
  return parts.length > 2 ? parts.slice(1).join(".") : null;
};

const readTxt = async (name) => {
  try {
    return { found: true, txts: await dns.resolveTxt(name) };
  } catch (err) {
    if (NO_RECORD.has(err.code)) return { found: false, txts: [] };
    throw err;
  }
};

async function checkMx(domain) {
  try {
    const recs = await dns.resolveMx(domain);
    if (!recs.length) {
      return { ok: false, records: [], hint: `The domain has no MX records. Add MX records at your DNS host (${domain}) so mail servers accept it as a sender domain.` };
    }
    return { ok: true, records: recs.map((r) => ({ host: r.exchange, priority: r.priority })) };
  } catch (err) {
    if (NO_RECORD.has(err.code)) {
      return { ok: false, records: [], hint: `No MX records on ${domain}. Sending via a relay can work without MX, but the domain won't receive mail — add MX records to make it a full mailbox domain.` };
    }
    return { ok: null, records: [], error: err.code || err.message, hint: "MX check couldn't complete right now — tick the box below once you've added MX records." };
  }
}

function spfSuggestions(domain, smtpHost) {
  const relay = relayFor(smtpHost);
  if (relay && relay.include) return [`v=spf1 include:${relay.include} ~all`];
  const smtpDomain = domainOf(smtpHost);
  if (smtpDomain && smtpDomain !== domain) return [`v=spf1 mx include:${smtpDomain} ~all`];
  return ["v=spf1 mx ~all"];
}

async function checkSpf(domain, smtpHost) {
  let result;
  try {
    result = await readTxt(domain);
  } catch (err) {
    return { ok: null, error: err.code || err.message, hint: "SPF check couldn't complete right now — tick the box below once you've published the record." };
  }

  let where = domain;
  let txts = result.txts;
  // SPF commonly lives on the parent domain and covers subdomains — check it
  // before declaring the record missing.
  if (!result.found) {
    const parent = parentOf(domain);
    if (parent) {
      try {
        const pr = await readTxt(parent);
        if (pr.found) { txts = pr.txts; where = parent; }
      } catch { /* parent check is best-effort */ }
    }
  }

  const spf = txts.find((t) => t.join("").toLowerCase().startsWith("v=spf1"));
  if (spf) {
    return {
      ok: true,
      record: spf.join(""),
      domain: where,
      note: where !== domain ? `Found on ${where} (applies to ${domain} too)` : undefined,
    };
  }
  return {
    ok: false,
    record: null,
    suggest: spfSuggestions(domain, smtpHost),
    hint: `Add a TXT record on ${domain} with one of the suggested values, then verify again.`,
  };
}

async function checkDkim(domain, smtpHost) {
  const relay = relayFor(smtpHost);
  const results = await Promise.allSettled(
    DKIM_SELECTORS.map(async (sel) => {
      const r = await readTxt(`${sel}._domainkey.${domain}`);
      return r.found ? { sel, txts: r.txts } : null;
    }),
  );
  const found = results.find((r) => r.status === "fulfilled" && r.value);
  if (found) {
    const { sel, txts } = found.value;
    return { ok: true, selector: sel, record: txts.map((t) => t.join("")).join("") };
  }
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length === DKIM_SELECTORS.length) {
    const first = failures[0].reason;
    return { ok: null, error: (first && (first.code || first.message)) || "lookup failed", hint: "DKIM check couldn't complete right now — tick the box below once your provider has published the key." };
  }
  const hint = relay && relay.dkimHint
    ? relay.dkimHint
    : `No DKIM key found under the common selectors. Enable DKIM at your mail provider, or publish a TXT record at <selector>._domainkey.${domain} with the key your provider gives you (template: v=DKIM1; k=rsa; p=<public key>).`;
  return { ok: false, selector: null, record: null, hint };
}

/**
 * Verify a sending domain's deliverability records. Returns the per-record
 * verdicts described in the header; `done` is true only when all three passed
 * an automated check.
 */
async function checkDomain(domain, { smtpHost = null } = {}) {
  const clean = String(domain || "").trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(clean)) {
    throw new Error("Not a domain name");
  }
  const [mx, spf, dkim] = await Promise.all([
    checkMx(clean),
    checkSpf(clean, smtpHost),
    checkDkim(clean, smtpHost),
  ]);
  return {
    domain: clean,
    mx,
    spf,
    dkim,
    done: mx.ok === true && spf.ok === true && dkim.ok === true,
    checked_at: new Date().toISOString(),
  };
}

module.exports = { checkDomain, DKIM_SELECTORS };
