#!/usr/bin/env node
/**
 * scripts/local-setup.js — one-shot local bootstrap + boot.
 *
 * Runs the DB steps from doc/SETUP.md (Option A, local/native) in order, then
 * starts the API server. Idempotent: re-running is safe — provision and
 * create-admin are treated as best-effort (a tenant/user that already exists is
 * a warning, not a failure).
 *
 * PREREQUISITES you provide (this script does NOT install these):
 *   - Node 20
 *   - PostgreSQL 16 with extensions: pgcrypto, citext, vector (pgvector)
 *   - Redis 6+  (running and reachable at REDIS_URL)
 *
 * Usage:
 *   node scripts/local-setup.js
 *   node scripts/local-setup.js --slug=smartls --name="Smart Logistics" \
 *        --email=you@example.com --password=secret123 --plan=full
 *
 * Flags:
 *   --slug        tenant slug            (default: smartls)
 *   --name        tenant display name    (default: "Smart Logistics")
 *   --plan        plan key               (default: full)
 *   --email       first admin email      (default: admin@example.com)
 *   --password    first admin password   (default: secret123)
 *   --admin-name  first admin name       (default: "Local Admin")
 *   --skip-install   don't run `npm install`
 *   --no-start       do the DB steps only; don't boot the server
 *   --with-worker    also spawn the BullMQ worker alongside the API
 */
"use strict";

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";
const NPM = isWin ? "npm.cmd" : "npm";

// ── tiny arg parser ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const cfg = {
  slug: opt("slug", "smartls"),
  name: opt("name", "Smart Logistics"),
  plan: opt("plan", "full"),
  email: opt("email", "admin@example.com"),
  password: opt("password", "secret123"),
  adminName: opt("admin-name", "Local Admin"),
  skipInstall: flag("skip-install"),
  noStart: flag("no-start"),
  withWorker: flag("with-worker"),
};

// ── logging ─────────────────────────────────────────────────────────────────
const c = (n, s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);
const step = (n, total, msg) => console.warn(`\n${c(36, `[${n}/${total}]`)} ${c(1, msg)}`);
const ok = (m) => console.warn(`  ${c(32, "✓")} ${m}`);
const warn = (m) => console.warn(`  ${c(33, "!")} ${m}`);
const die = (m) => {
  console.error(`\n  ${c(31, "✗")} ${m}\n`);
  process.exit(1);
};

/** Run an npm script synchronously. Returns true on success. */
function run(label, npmArgs, { fatal = true } = {}) {
  console.warn(`  ${c(90, "$")} ${c(90, `npm ${npmArgs.join(" ")}`)}`);
  const res = spawnSync(NPM, npmArgs, { cwd: ROOT, stdio: "inherit", shell: isWin });
  if (res.status === 0) return true;
  if (fatal) die(`${label} failed (exit ${res.status}). Fix the error above and re-run.`);
  warn(`${label} exited ${res.status} — continuing (usually means it already exists).`);
  return false;
}

// ── main ────────────────────────────────────────────────────────────────────
const TOTAL = cfg.noStart ? 5 : 6;

// 0. Node version sanity
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) die(`Node 20 required; you're on ${process.versions.node}. Run \`nvm use\`.`);

// 1. .env
step(1, TOTAL, "Ensuring .env exists");
const envPath = path.join(ROOT, ".env");
if (!fs.existsSync(envPath)) {
  const examplePath = path.join(ROOT, ".env.example");
  if (!fs.existsSync(examplePath)) die("No .env and no .env.example to copy from.");
  fs.copyFileSync(examplePath, envPath);
  ok("Copied .env.example → .env");
  warn("Edit .env now: set DB_PASSWORD (and TENANT_DB_SUPERUSER[_PASSWORD]) to match your Postgres, then re-run.");
  warn("Keep local hosts: DB_HOST=localhost, REDIS_URL=redis://localhost:6379, NODE_ENV=development.");
} else {
  ok(".env present");
}
// Dev convenience: make localhost resolve to this tenant (no hosts-file edit).
// Only appends when the key is absent, so we never clobber a user's value.
try {
  const envText = fs.readFileSync(envPath, "utf8");
  if (!/^\s*DEV_TENANT_SLUG\s*=/m.test(envText)) {
    fs.appendFileSync(
      envPath,
      `${envText.endsWith("\n") ? "" : "\n"}\n# Dev-only: localhost resolves to this tenant (see host-tenent-resolver.js)\nDEV_TENANT_SLUG=${cfg.slug}\n`,
    );
    ok(`Set DEV_TENANT_SLUG=${cfg.slug} in .env — localhost will resolve to this tenant in development`);
  } else {
    ok("DEV_TENANT_SLUG already set in .env (left untouched)");
  }
} catch (e) {
  warn(`Could not update DEV_TENANT_SLUG in .env: ${e.message}`);
}

// 2. Install deps (needed before the connectivity check can require pg/ioredis)
step(2, TOTAL, "Installing dependencies");
if (cfg.skipInstall) {
  warn("--skip-install set — assuming node_modules is current");
} else {
  run("npm install", ["install"]);
  ok("Dependencies installed");
}

// 3. Best-effort connectivity check (non-fatal — migrate will fail loudly anyway)
step(3, TOTAL, "Checking Postgres + Redis reachability");
require(path.join(ROOT, "node_modules", "dotenv")).config({ path: envPath });
(async () => {
  // Postgres: connect to the maintenance DB so it works even before praxis_platform exists.
  try {
    const { Client } = require(path.join(ROOT, "node_modules", "pg"));
    const su = process.env.TENANT_DB_SUPERUSER || process.env.DB_USER;
    const sp = process.env.TENANT_DB_SUPERUSER_PASSWORD || process.env.DB_PASSWORD;
    const client = new Client({
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT || 5432),
      user: su,
      password: sp,
      database: "postgres",
      connectionTimeoutMillis: 4000,
    });
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    ok(`Postgres reachable at ${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || 5432}`);
  } catch (e) {
    warn(`Postgres check failed: ${e.message}`);
    warn("Make sure Postgres 16 is running and DB_USER/DB_PASSWORD (or TENANT_DB_SUPERUSER*) in .env are correct.");
  }

  // Redis
  try {
    const Redis = require(path.join(ROOT, "node_modules", "ioredis"));
    const r = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 4000,
    });
    await r.connect();
    const pong = await r.ping();
    r.disconnect();
    ok(`Redis reachable (${pong})`);
  } catch (e) {
    warn(`Redis check failed: ${e.message}`);
    warn("Start Redis (WSL: `sudo service redis-server start`) or fix REDIS_URL in .env.");
  }

  runDbStepsAndBoot();
})();

function runDbStepsAndBoot() {
  // 4. Migrate the platform DB (creates praxis_platform if missing, seeds catalogue)
  step(4, TOTAL, "Migrating the platform database");
  run("db:migrate:platform", ["run", "db:migrate:platform"]);
  ok("Platform DB migrated + catalogue seeded");

  // 5. Provision a tenant + bootstrap a login (both best-effort/idempotent)
  step(5, TOTAL, `Provisioning tenant "${cfg.slug}" + admin`);
  run(
    "db:provision",
    ["run", "db:provision", "--", `--slug=${cfg.slug}`, `--name=${cfg.name}`, `--plan=${cfg.plan}`],
    { fatal: false },
  );
  run(
    "tenant:create-admin",
    [
      "run",
      "tenant:create-admin",
      "--",
      `--slug=${cfg.slug}`,
      `--email=${cfg.email}`,
      `--name=${cfg.adminName}`,
      `--password=${cfg.password}`,
    ],
    { fatal: false },
  );
  ok("Tenant provisioned (live + sandbox) and admin bootstrap attempted");

  console.warn(`\n${c(1, "Login you can use:")}`);
  console.warn(`  slug:     ${cfg.slug}`);
  console.warn(`  email:    ${cfg.email}`);
  console.warn(`  password: ${cfg.password}   ${c(90, "(CEO role — bypasses RBAC by design)")}`);

  if (cfg.noStart) {
    console.warn(`\n${c(32, "DB steps done.")} Start the server yourself with:  ${c(1, "npm run dev")}`);
    console.warn(`Worker (separate terminal): ${c(1, "npm run dev:worker")}\n`);
    return;
  }

  // 6. Boot
  step(6, TOTAL, "Starting the API server");
  if (cfg.withWorker) {
    const worker = spawn(NPM, ["run", "dev:worker"], { cwd: ROOT, stdio: "inherit", shell: isWin });
    worker.on("exit", (code) => warn(`worker exited (${code})`));
    ok("Worker spawned alongside the API");
  } else {
    warn("Worker NOT started. Background jobs (PDF/email/FX/AI/régie) won't run.");
    warn("Run it in a second terminal: npm run dev:worker   (or re-run this with --with-worker)");
  }
  console.warn(`  ${c(90, "$")} ${c(90, "npm run dev")}   → http://localhost:8080  (Ctrl-C to stop)\n`);
  const api = spawn(NPM, ["run", "dev"], { cwd: ROOT, stdio: "inherit", shell: isWin });
  api.on("exit", (code) => process.exit(code || 0));
}
