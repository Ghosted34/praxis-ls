#!/usr/bin/env node
/**
 * Report the state of a tenant's approval engine — the answer to "why is nothing
 * waiting for me?" without opening a SQL client.
 *
 * Prints, per environment (live + sandbox, because a chain configured in one is
 * invisible in the other):
 *   · every workflow, whether it is active, and its ordered steps with the role,
 *     scope, capability and amount band each step binds to;
 *   · which of the six integrated events have NO workflow — those auto-approve,
 *     so nothing ever reaches the queue;
 *   · pending approval tasks, and whether they are actionable (a task whose
 *     assigned role has nobody in it, or whose module nobody holds approve on,
 *     is a task that will sit there forever);
 *   · scope nodes with no members, since a step routed to an empty branch has
 *     no one who can decide it.
 *
 * Strictly read-only. Diagnostic sibling of scripts/tenant/feature-report.js.
 *
 *   node scripts/tenant/approval-report.js --slug=smartls
 *   node scripts/tenant/approval-report.js --all
 */
"use strict";

const { config } = require("../../src/config/env");
const m = require("../../src/services/platform/migrator");

const a = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const mm = s.match(/^--([^=]+)=(.*)$/);
    return mm ? [mm[1], mm[2]] : [s.replace(/^--/, ""), true];
  }),
);

/** The events whose modules call executor.start — the ones that need a chain. */
const INTEGRATED = [
  "costing.submitted",
  "invoice.issued",
  "disbursal.requested",
  "po.issued",
  "supplier_invoice.matched",
  "payroll.status_changed",
];

const money = (v) => (v === null || v === undefined ? null : Number(v).toLocaleString("en-US"));

function band(s) {
  const lo = money(s.min_amount_xaf);
  const hi = money(s.max_amount_xaf);
  if (lo === null && hi === null) return "any amount";
  if (lo !== null && hi !== null) return `${lo}–${hi} XAF`;
  return lo !== null ? `≥ ${lo} XAF` : `≤ ${hi} XAF`;
}

async function listSlugs() {
  const pf = m.client(config.DB_NAME);
  await pf.connect();
  try {
    const { rows } = await pf.query(
      "SELECT slug FROM platform.tenant WHERE status IN ('LIVE','PROVISIONING','SUSPENDED') ORDER BY slug",
    );
    return rows.map((r) => r.slug);
  } finally {
    await pf.end();
  }
}

async function reportSchema(cli, schema) {
  await cli.query(`SET search_path TO ${schema}, public`);
  const out = [];

  const { rows: workflows } = await cli.query(
    `SELECT w.workflow_id, w.name, w.is_active, et.key AS event_key
       FROM workflow w
       JOIN event_type et ON et.event_type_id = w.event_type_id
      ORDER BY et.key`,
  );

  out.push(`  workflows: ${workflows.length}`);

  for (const w of workflows) {
    // Roles and scopes are IDENTITY data (always the live schema) while the step
    // lives here — so resolve their names against live, not the current schema,
    // or a sandbox report would show every step as "role ?".
    const { rows: steps } = await cli.query(
      `SELECT s.step_seq, s.step_kind, s.capability_code, s.min_amount_xaf, s.max_amount_xaf,
              r.code AS role_code, sc.code AS scope_code,
              (SELECT count(*)::int FROM live.user_role ur WHERE ur.role_id = s.role_id) AS role_holders,
              (SELECT count(*)::int FROM live.user_scope us WHERE us.scope_id = s.scope_id) AS scope_members
         FROM workflow_step s
         LEFT JOIN live.role  r  ON r.role_id   = s.role_id
         LEFT JOIN live.scope sc ON sc.scope_id = s.scope_id
        WHERE s.workflow_id = $1
        ORDER BY s.step_seq`,
      [w.workflow_id],
    );
    out.push(`    ${w.is_active ? "●" : "○"} ${w.event_key} — ${w.name}${w.is_active ? "" : "  [INACTIVE]"}`);
    if (!steps.length) {
      out.push("        ⚠️  no steps — this workflow approves nothing");
    }
    for (const s of steps) {
      const who = s.role_code ? s.role_code : "anyone";
      const where = s.scope_code ? s.scope_code : "company-wide";
      const warn = [];
      if (s.role_code && s.role_holders === 0) warn.push("nobody holds this role");
      if (s.scope_code && s.scope_members === 0) warn.push("nobody in this scope");
      out.push(
        `        ${s.step_seq}. ${s.step_kind} · ${who} · ${where} · ${s.capability_code || "—"} · ${band(s)}` +
          (warn.length ? `   ⚠️  ${warn.join("; ")}` : ""),
      );
    }
  }

  // Integrated events with no chain — the usual reason a queue is empty.
  const { rows: uncovered } = await cli.query(
    `SELECT et.key FROM event_type et
      WHERE et.key = ANY($1::citext[])
        AND NOT EXISTS (SELECT 1 FROM workflow w WHERE w.event_type_id = et.event_type_id AND w.is_active)
      ORDER BY et.key`,
    [INTEGRATED],
  );
  if (uncovered.length) {
    out.push(`  ⚠️  no active chain (these auto-approve, nothing reaches the queue):`);
    for (const u of uncovered) out.push(`        ${u.key}`);
  }

  const { rows: tasks } = await cli.query(
    `SELECT status, count(*)::int AS n FROM approval_task GROUP BY status ORDER BY status`,
  );
  out.push(`  approval tasks: ${tasks.length ? tasks.map((t) => `${t.status}=${t.n}`).join("  ") : "none"}`);

  // A pending task nobody can act on is the failure worth naming.
  const { rows: stuck } = await cli.query(
    `SELECT at.entity_ref, at.module_key, r.code AS role_code,
            (SELECT count(*)::int FROM live.user_role ur WHERE ur.role_id = at.assigned_role_id) AS holders,
            (SELECT count(*)::int FROM live.permission p
              WHERE p.module_key = COALESCE(at.module_key, 'MOD-67') AND p.can_approve) AS approver_roles
       FROM approval_task at
       LEFT JOIN live.role r ON r.role_id = at.assigned_role_id
      WHERE at.status = 'PENDING'
      ORDER BY at.created_at DESC LIMIT 20`,
  );
  for (const s of stuck) {
    const why = [];
    if (s.role_code && s.holders === 0) why.push(`no one holds ${s.role_code}`);
    if (s.approver_roles === 0) why.push(`no role has approve on ${s.module_key || "MOD-67"}`);
    if (why.length) out.push(`  ⚠️  ${s.entity_ref}: ${why.join("; ")}`);
  }

  return out;
}

async function run(slug) {
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    console.warn(`\n=== ${slug} ===`);
    for (const schema of ["live", "sandbox"]) {
      const { rows } = await cli.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`${schema}.workflow`]);
      if (!rows[0] || rows[0].ok !== true) {
        console.warn(`  [${schema}] not migrated — run db:migrate:tenants first`);
        continue;
      }
      console.warn(`  [${schema}]`);
      const lines = await reportSchema(cli, schema);
      for (const l of lines) console.warn(l);
    }

    // Empty scope nodes, resolved once against identity.
    await cli.query("SET search_path TO live, public");
    const { rows: empties } = await cli.query(
      `SELECT s.code, s.name FROM scope s
        WHERE NOT EXISTS (SELECT 1 FROM user_scope us WHERE us.scope_id = s.scope_id)
        ORDER BY s.code`,
    );
    if (empties.length) {
      console.warn(`  scopes with nobody assigned: ${empties.map((e) => e.code).join(", ")}`);
    }
  } finally {
    await cli.end();
  }
}

async function main() {
  if (!a.slug && !a.all) throw new Error("--slug=<slug> or --all is required");
  const slugs = a.all ? await listSlugs() : [a.slug];
  for (const slug of slugs) await run(slug);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis] approval-report FAILED:", e.message);
    process.exit(1);
  });
