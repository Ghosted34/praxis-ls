#!/usr/bin/env node
/**
 * Money-path seeder (API-driven). The complement to scripts/tenant/seed-sandbox.sql:
 * that one fills master/ops/business data via direct SQL but deliberately does NOT
 * post to the ledger. This one logs in and drives the REAL endpoints so the GL,
 * trial balance, statements and true receivables ageing actually populate:
 *
 *   record advance → create + submit (auto-post) a final invoice → record + post a
 *   receipt → payroll compute → SUBMITTED → APPROVED → VALIDATED (posts the payroll
 *   journal) → asset depreciation.
 *
 * It runs entirely in the SANDBOX schema (X-Praxis-Env: sandbox) and refuses to run
 * against a live tenant. Every step is independent and logged, so a failure in one
 * (e.g. an approval workflow that needs a human) never blocks the rest.
 *
 * Prereqs: the API server is running, and scripts/tenant/seed-sandbox.sql has been
 * applied (this reads the entities/clients/dossiers/dictionary/treasury it created).
 *
 *   node scripts/tenant/seed-money-path.js --slug=smartls --email=admin@smartls.cm --password=secret
 */
"use strict";

const { Pool } = require("pg");
const { config } = require("../../src/config/env");

const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const m = s.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [s.replace(/^--/, ""), true];
  }),
);
const slug = args.slug;
const email = args.email;
const password = args.password;
if (!slug || !email || !password) {
  console.error("usage: node scripts/tenant/seed-money-path.js --slug=<slug> --email=<admin email> --password=<pw>");
  process.exit(1);
}

// Target the running API. Defaults to 127.0.0.1:<PORT> (env PORT, else config,
// else 8080), overridable with --port=<n> or --url=<origin>. NB the server log
// prints the real port on boot ("praxis-ls api listening" { port }). If an Apache
// (XAMPP) is on 8080, pass the Node port here.
const PORT = args.port || process.env.PORT || config.PORT;
// Default host is `localhost` (not 127.0.0.1): on Windows localhost resolves to
// ::1 where Node listens, while 127.0.0.1 (IPv4) may be a different service
// (e.g. Apache/XAMPP on the same port). Override with --url or --host.
const HOSTNAME = args.host || "localhost";
const ORIGIN = (args.url ? String(args.url) : `http://${HOSTNAME}:${PORT}`).replace(/\/+$/, "");
const BASE = ORIGIN.endsWith("/api/tenant") ? ORIGIN : `${ORIGIN}/api/tenant`;
const HEALTH = `${BASE.replace(/\/api\/tenant$/, "")}/api/health`;
const HOST = `${slug}.${config.APP_BASE_DOMAIN}`;
const today = new Date();
const ymd = today.toISOString().slice(0, 10); // YYYY-MM-DD
const period = ymd.slice(0, 7); // YYYY-MM

let token = null;
const ok = (m) => console.log(`  ✓ ${m}`);
const skip = (m) => console.log(`  – ${m}`);
const fail = (m) => console.log(`  ✗ ${m}`);

// NB: NOT global fetch — undici treats Host as a forbidden header and silently
// drops it, so the API would resolve the tenant from the URL's hostname (breaks
// whenever the target isn't <slug>.<domain>, e.g. docker service names).
// node:http/https honour an explicit Host header.
const nodeHttp = require("node:http");
const nodeHttps = require("node:https");
function rawRequest(method, url, headers, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? nodeHttps : nodeHttp;
    const req = lib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, method, headers },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, text: data }));
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function call(method, path, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const res = await rawRequest(method, BASE + path, {
    Host: HOST,
    "X-Praxis-Env": "sandbox",
    "X-Praxis-Tenant": slug, // dev-mode resolver fallback; Host wins in prod
    "Content-Type": "application/json",
    ...(payload !== undefined ? { "Content-Length": Buffer.byteLength(payload) } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, payload);
  const text = res.text;
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || (json && json.message) || text || res.statusText;
    const err = new Error(`${res.status} ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json && json.data !== undefined ? json.data : json;
}
const unwrap = (r) => (Array.isArray(r) ? r : r && Array.isArray(r.data) ? r.data : r && Array.isArray(r.rows) ? r.rows : []);

// Idempotency marker in the sandbox settings store — so a re-run doesn't
// duplicate the advance/invoice/receipt. Cleared by a sandbox wipe. Keyed by
// period, so running in a later month seeds that month afresh.
const MARKER = "/settings/seed/money-path";
async function readMarker() {
  try {
    const v = await call("GET", MARKER);
    return v && (v.value !== undefined ? v.value : v);
  } catch {
    return null;
  }
}
async function writeMarker() {
  try {
    await call("PUT", MARKER, { value: { period, seeded_at: new Date().toISOString() } });
  } catch {
    /* non-fatal — marker is a convenience, not a correctness requirement */
  }
}

/** Refuse to run against a live tenant — the sandbox header is ignored there. */
async function assertSandboxable() {
  const pool = new Pool({
    host: config.DB_HOST, port: config.DB_PORT, database: config.DB_NAME,
    user: config.DB_USER, password: config.DB_PASSWORD,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
  });
  try {
    const { rows } = await pool.query("SELECT is_live, status FROM platform.tenant WHERE slug=$1", [slug]);
    if (!rows.length) throw new Error(`tenant '${slug}' not found in platform registry`);
    if (rows[0].is_live) {
      throw new Error(
        `tenant '${slug}' is LIVE (is_live=true) — the X-Praxis-Env:sandbox header is ignored for live tenants, so this would post to LIVE. Aborting.`,
      );
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  await assertSandboxable();
  ok(`tenant '${slug}' is not live — safe to seed sandbox`);

  // 0. Health preflight — fail fast (and clearly) if we're pointed at the wrong port.
  console.log(`  → API target: ${BASE}  (Host: ${HOST})`);
  try {
    const h = await rawRequest("GET", HEALTH, { Host: HOST });
    if (!h.ok || !/"ok"\s*:\s*true/.test(h.text)) throw new Error("no health JSON");
  } catch {
    throw new Error(
      `API not reachable at ${HEALTH} — the Node server is probably on another port ` +
        `(8080 is likely your Apache/XAMPP). Check the server boot log for "praxis-ls api listening" and pass --port=<n> or --url=<origin>.`,
    );
  }

  // 1. Login
  const auth = await call("POST", "/auth/login", { email, password });
  token = auth && auth.access_token;
  if (!token) {
    if (auth && (auth.requires_2fa || auth.twofa_required || auth.pending)) {
      throw new Error("account has 2FA enabled — use an admin without 2FA for seeding");
    }
    throw new Error("login did not return an access_token");
  }
  ok(`logged in as ${email}`);

  // Idempotency: bail if this period was already seeded (avoids duplicate posts).
  const marker = await readMarker();
  if (marker && marker.period === period) {
    skip(`money-path already seeded for ${period} — wipe the sandbox to reseed`);
    console.log("\nNothing to do. (Ledger was populated on a previous run.)");
    return;
  }

  // 2. Discover the SQL-seeded records
  const entities = unwrap(await call("GET", "/entities"));
  const entity = entities.find((e) => e.code === "SBX") || entities[0];
  if (!entity) throw new Error("no corporate entity found — run seed-sandbox.sql first");
  const entityId = entity.entity_id;

  const clients = unwrap(await call("GET", "/clients"));
  const dossiers = unwrap(await call("GET", "/operations"));
  // Keep entity/client/dossier consistent: pick a dossier in this entity and use
  // that dossier's own client, so all three line up on the invoice.
  const dossier = dossiers.find((d) => d.entity_id === entityId) || dossiers[0];
  const clientId = (dossier && dossier.client_id) || ((clients.find((cl) => cl.entity_id === entityId) || clients[0] || {}).client_id);
  const dossierId = dossier && dossier.dossier_id;
  const clientName = (clients.find((cl) => cl.client_id === clientId) || {}).name;
  const dict = unwrap(await call("GET", "/financial-dictionary"));
  const service = dict.find((d) => d.is_debours === false && d.category === "service") || dict.find((d) => !d.is_debours);
  const treasury = unwrap(await call("GET", "/treasury-accounts"));
  const bank = treasury.find((t) => t.kind === "BANK") || treasury[0];
  ok(`discovered entity=${entity.code} client=${clientName || "—"} dossier=${dossier ? dossier.ref : "—"} dict=${service ? service.code : "—"}`);

  // 3. Customer advance (Dr 521 / Cr 4191)
  try {
    await call("POST", "/proformas/pay", {
      entity_id: entityId, client_id: clientId, dossier_id: dossierId,
      amount: 10000000, treasury_coa: "5211", entry_date: ymd, source_doc_ref: `SEED-ADV-${Date.now()}`,
    });
    ok("recorded customer advance 10,000,000 XAF → 4191");
  } catch (e) {
    fail(`advance: ${e.message}`);
  }

  // 4. Final invoice: draft → submit (posts revenue + VAT, clears advance)
  if (service) {
    try {
      const inv = await call("POST", "/final-invoices", {
        entity_id: entityId, client_id: clientId, dossier_id: dossierId,
        lines: [
          { dictionary_item_id: service.dictionary_item_id, amount: 18000000, label: "Freight & transit services" },
        ],
      });
      const invId = inv && (inv.invoice_id || (inv.invoice && inv.invoice.invoice_id));
      ok(`created draft invoice ${invId}`);
      const submitted = await call("POST", `/final-invoices/${invId}/submit`, {
        entry_date: ymd, source_doc_ref: `SEED-INV-${Date.now()}`,
      });
      if (submitted && submitted.posted) ok(`invoice posted to GL (${submitted.posted.doc_number || "numbered"})`);
      else skip("invoice submitted — awaiting approval chain (post it from the Approvals screen)");
    } catch (e) {
      fail(`invoice: ${e.message}`);
    }
  } else {
    skip("invoice: no service dictionary item found");
  }

  // 5. Receipt: create → post (Dr 521 / Cr 4111)
  try {
    const receipt = await call("POST", "/receivables", {
      client_id: clientId, method: "BANK",
      treasury_account_id: bank ? bank.treasury_account_id : undefined,
      amount: 5000000, received_on: ymd,
    });
    const rid = receipt && receipt.receipt_id;
    await call("POST", `/receivables/${rid}/post`, { entity_id: entityId, entry_date: ymd, source_doc_ref: `SEED-RCPT-${Date.now()}` });
    ok("recorded + posted receipt 5,000,000 XAF → 411 cleared");
  } catch (e) {
    fail(`receipt: ${e.message}`);
  }

  // 6. Payroll run → compute → SUBMITTED → APPROVED → VALIDATED (posts 661/664 → 431/447/422)
  try {
    let runId;
    try {
      const run = await call("POST", "/payroll", { entity_id: entityId, period_code: period });
      runId = run && run.payroll_run_id;
    } catch (e) {
      if (e.status === 409) {
        const runs = unwrap(await call("GET", "/payroll"));
        const existing = runs.find((r) => r.period_code === period && r.entity_id === entityId);
        runId = existing && existing.payroll_run_id;
        skip(`payroll run for ${period} already exists — reusing`);
      } else throw e;
    }
    if (!runId) throw new Error("could not resolve a payroll run id");
    await call("POST", `/payroll/${runId}/compute`, {});
    ok(`payroll ${period} computed`);
    for (const status of ["SUBMITTED", "APPROVED", "VALIDATED"]) {
      try {
        await call("POST", `/payroll/${runId}/status`, { status });
        ok(`payroll → ${status}`);
      } catch (e) {
        skip(`payroll → ${status}: ${e.message} (may need a human approval)`);
        break;
      }
    }
  } catch (e) {
    fail(`payroll: ${e.message}`);
  }

  // 7. Asset depreciation (Dr 6813 / Cr 2845)
  try {
    // Find an asset that actually has an un-posted schedule row (the SQL seed only
    // schedules a couple of months, and only on one asset). Assets created via the
    // API get a full schedule; seeded ones may not.
    const assets = unwrap(await call("GET", "/assets"));
    let target = null;
    let pc = null;
    for (const a of assets) {
      // eslint-disable-next-line no-await-in-loop
      const detail = await call("GET", `/assets/${a.asset_id}`);
      const sched = (detail.schedule || []).find((s) => !s.posted);
      if (sched) {
        target = a;
        pc = sched.period_code;
        break;
      }
    }
    if (target) {
      await call("POST", `/assets/${target.asset_id}/depreciate`, { period_code: pc });
      ok(`depreciated asset ${target.tag || target.label} for ${pc}`);
    } else {
      skip("asset depreciation: no asset with an un-posted schedule");
    }
  } catch (e) {
    fail(`asset depreciation: ${e.message}`);
  }

  await writeMarker();
  console.log("\nMoney-path seed complete. Open Statements / General Ledger (TEST mode) to see the posted entries.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n[money-path] FAILED:", e.message);
    process.exit(1);
  });
