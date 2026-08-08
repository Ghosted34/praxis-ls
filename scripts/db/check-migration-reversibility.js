#!/usr/bin/env node
/**
 * Guard: every NEW migration declares whether it can be undone.
 *
 * WHY THIS EXISTS — audit DATA 3.5 (High) and TEST-D2 (Critical), 2026-08-04.
 *
 * There is not one down-migration in this repository. 62 tenant migrations and
 * 8 platform migrations, zero reversible. The tooling has no `down` concept at
 * all. Combined with TEST-D2 — migrations ran against production with no backup
 * — a bad migration was simply unrecoverable.
 *
 * scripts/deploy.sh now takes a pg_dump before migrating, which is what makes
 * today survivable. This guard is the other half: it stops the backlog growing.
 *
 * WHAT IT DOES NOT DO, deliberately:
 *
 *   It does not retro-fit down sections to the 70 existing migrations. Writing
 *   an untested `DROP TABLE` for a migration that has already run in production
 *   is worse than having none: it looks like a recovery path and is not one.
 *   The existing files are grandfathered by their number, and the backlog is
 *   tracked as DATA 3.5.
 *
 *   It does not make the migrator execute down sections. Running one
 *   automatically is a data-loss weapon; `scripts/rollback.sh` deliberately
 *   stops and asks a human when it detects destructive DDL. The down block is
 *   documentation of intent that a human applies by hand, which is the honest
 *   level of automation for something irreversible.
 *
 * THE CONVENTION
 *
 * Every migration numbered above the grandfather line must contain ONE of:
 *
 *   -- DOWN
 *   -- DROP INDEX IF EXISTS live.idx_thing;
 *
 *     ...the statements that undo it, commented out. Commented so nothing can
 *     execute them by accident; present so the author has had to think about it
 *     and the next person has a starting point at 3am.
 *
 *   -- IRREVERSIBLE: <reason>
 *
 *     ...for a migration that genuinely cannot be undone — a destructive
 *     backfill, a column drop. Writing the reason is the point: it forces the
 *     author to notice they are doing something one-way, and it tells whoever
 *     is holding the pager that the answer is "restore the dump", not "run the
 *     down".
 *
 * Exit 0 = clean. Exit 1 = a new migration declared neither.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "migrations");
const SCOPES = ["platform", "tenant", "seeds"];

/**
 * The 92 migrations that existed when the convention landed (2026-08-04).
 *
 * Grandfathered by NAME, not by number: platform numbering is not chronological
 * (0040/0050/0060 predate 0032), so a numeric cut-off would exempt the wrong
 * files in one scope and over-apply in another.
 *
 * These are exempt because retro-fitting an UNTESTED down section to a
 * migration that has already run in production is worse than having none — it
 * looks like a recovery path and is not one. The backlog is tracked as
 * DATA 3.5; this guard exists to stop it growing, not to pretend it is cleared.
 *
 * DO NOT add to this list to silence a failure. Adding the `-- DOWN` block to a
 * new migration takes a minute and is the entire point.
 */
const GRANDFATHERED = new Set([
    "platform/0001_extensions.sql",
    "platform/0010_tenant_registry.sql",
    "platform/0020_modules_features.sql",
    "platform/0030_platform_ops.sql",
    "platform/0031_platform_rbac.sql",
    "platform/0040_ai_knowledge.sql",
    "platform/0050_platform_settings.sql",
    "platform/0060_ai_vendor.sql",
    "tenant/0001_extensions.sql",
    "tenant/0100_identity.sql",
    "tenant/0110_rbac.sql",
    "tenant/0120_events_workflow.sql",
    "tenant/0130_platform_projection.sql",
    "tenant/0200_coa_dictionary.sql",
    "tenant/0210_tax.sql",
    "tenant/0220_ledger.sql",
    "tenant/0221_ledger_invariants.sql",
    "tenant/0230_treasury_invoicing.sql",
    "tenant/0300_masterdata.sql",
    "tenant/0310_operations.sql",
    "tenant/0320_costing_procurement.sql",
    "tenant/0330_hr_fleet_wms.sql",
    "tenant/0340_vault_comms.sql",
    "tenant/0342_finance_gaps.sql",
    "tenant/0345_commercial.sql",
    "tenant/0350_sales_crm.sql",
    "tenant/0360_hr_breadth.sql",
    "tenant/0370_wms_fleet_depth.sql",
    "tenant/0400_ai.sql",
    "tenant/0410_notifications_ux.sql",
    "tenant/0420_ai_batch.sql",
    "tenant/0430_smartcomm.sql",
    "tenant/0440_settings_gaps.sql",
    "tenant/0441_business_iam_gaps.sql",
    "tenant/0442_credit_note.sql",
    "tenant/0443_pin_login.sql",
    "tenant/0450_comms_channel_flags.sql",
    "tenant/0451_email_inbound.sql",
    "tenant/0452_campaign_templates.sql",
    "tenant/0453_session_refresh_jti.sql",
    "tenant/0460_portal_user.sql",
    "tenant/0461_app_user_whatsapp.sql",
    "tenant/0462_event_orchestration.sql",
    "tenant/0463_cost_entry_source_ref.sql",
    "tenant/0464_ledger_hardening.sql",
    "tenant/0465_attendance_geofence.sql",
    "tenant/0466_employee_earning.sql",
    "tenant/0467_approvals_retrofit.sql",
    "tenant/0468_leave_approval_backfill.sql",
    "tenant/0469_default_workflows.sql",
    "tenant/0470_regie_doc_number.sql",
    "tenant/0470_seed_ai_vendors.sql",
    "tenant/0471_password_reset.sql",
    "tenant/0472_notification_preference.sql",
    "tenant/0473_push_subscription.sql",
    "tenant/0474_notification_category.sql",
    "tenant/0475_hr_discipline_and_avatar.sql",
    "tenant/0475_master_email.sql",
    "tenant/0476_document_lines.sql",
    "tenant/0477_line_item_refs.sql",
    "tenant/0478_geo_place.sql",
    "tenant/0479_dossier_place_refs.sql",
    "tenant/0480_party_address.sql",
    "tenant/0481_ai_conversation_summary.sql",
    "tenant/0482_portal_invite.sql",
    "tenant/0483_email_connection.sql",
    "tenant/0484_email_inbound_enrich.sql",
    "tenant/0485_email_attachment.sql",
    "tenant/0486_ai_disable_stale_ops_action.sql",
    "tenant/0487_approver_capability_backfill.sql",
    "tenant/0488_approval_task_module.sql",
    "tenant/0489_workflow_identity_refs.sql",
    "tenant/0490_department_scope_refs.sql",
    "tenant/0491_purchase_request_approval.sql",
    "tenant/0492_default_workflows_repair.sql",
    "tenant/0493_employee_reports_to.sql",
    "tenant/0494_session_keep_signed_in.sql",
    "seeds/9000_seed_coa.sql",
    "seeds/9010_seed_tax.sql",
    "seeds/9020_seed_rbac_events.sql",
    "seeds/9021_seed_default_permissions.sql",
    "seeds/9022_seed_grant_gaps.sql",
    "seeds/9030_seed_reference.sql",
    "seeds/9040_seed_ai_actions.sql",
    "seeds/9050_seed_settings.sql",
    "seeds/9060_seed_sample_workflow.sql",
    "seeds/9100_seed_platform_catalogue.sql",
    "seeds/9110_seed_platform_features.sql",
    "seeds/9111_fix_feature_defaults.sql",
    "seeds/9112_add_channel_features.sql",
    "seeds/9120_hr_discipline_module.sql",
    "seeds/9130_mail_module.sql"
  ]);

const NUMBERED = /^(\d+)[_-]/;
const HAS_DOWN = /^\s*--\s*DOWN\b/im;
const HAS_IRREVERSIBLE = /^\s*--\s*IRREVERSIBLE\s*:\s*\S+/im;

const problems = [];
let checked = 0;

for (const scope of SCOPES) {
  const dir = path.join(ROOT, scope);
  if (!fs.existsSync(dir)) continue;

  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    if (!NUMBERED.test(file)) continue;
    if (GRANDFATHERED.has(`${scope}/${file}`)) continue;

    checked += 1;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    if (HAS_DOWN.test(sql) || HAS_IRREVERSIBLE.test(sql)) continue;

    problems.push(`${scope}/${file}`);
  }
}

if (problems.length) {
  console.error("Migrations with no reversibility declaration:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error(`
Every migration must say how it is undone, or say that it cannot be.

Add ONE of the following to each file:

  -- DOWN
  -- ALTER TABLE live.thing DROP COLUMN new_col;

    The undo statements, commented out. Commented so nothing runs them by
    accident; present so there is a starting point when it is 3am and the
    deploy has gone wrong.

  -- IRREVERSIBLE: drops customer_note, the data cannot be reconstructed

    For a genuinely one-way change. The reason is the point — it tells whoever
    is on the pager that the answer is "restore the pre-deploy dump"
    (scripts/deploy.sh takes one) rather than "run the down".

Why this is enforced: there are currently ZERO reversible migrations in this
repo (audit DATA 3.5), which is half of why a bad deploy was unrecoverable.
This guard does not fix that backlog — it stops it growing.
`);
  process.exit(1);
}

console.warn(`Migration reversibility: ${checked} checked, all declared.`);
process.exit(0);
