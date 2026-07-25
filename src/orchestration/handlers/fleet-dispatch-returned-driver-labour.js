/**
 * fleet_dispatch RETURNED → dossier driver-labour cost (Plan A; PRD/KB §6.7,§1093).
 *
 * The PRD's dossier labour = per-job DRIVER TIME booked to 661, dossier-tagged.
 * When a dispatch returns, this attributes the driver's time on that job to the
 * dispatch's dossier: cost = driver daily rate (employee.base_salary ÷ working
 * days) × dispatch duration (check_out → check_in, min 1 day).
 *
 * ANALYTICAL only — NO GL posting. The salary is already in the company-wide 661
 * from the payroll run; this tags the dossier's share for margin (entry_id NULL).
 * IDEMPOTENT on cost_entry.source_ref = 'fleet_dispatch:<id>'. Skips when the
 * dispatch isn't RETURNED, has no dossier, or the driver has no salary on file.
 */
"use strict";

const costRepo = require("../../modules/costing/cost_tracking/cost_tracking.repo");
const { getSetting } = require("../../shared/config/settings");

const round2 = (n) => Math.round(Number(n) * 100) / 100;
function idFromRef(entityRef, prefix) {
  if (!entityRef || typeof entityRef !== "string") return null;
  return entityRef.startsWith(prefix + ":") ? entityRef.slice(prefix.length + 1) : null;
}

module.exports = {
  eventKey: "fleet_dispatch.status_changed",
  handlerKey: "fleet_dispatch.returned:driver-labour",
  feature: null,
  async run(client, event) {
    const id = idFromRef(event.entity_ref, "fleet_dispatch");
    if (!id) return { skipped: "no dispatch ref" };

    const r = await client.query(
      "SELECT fd.status, fd.dossier_id, fd.check_out_at, fd.check_in_at, e.base_salary " +
        "FROM fleet_dispatch fd LEFT JOIN employee e ON e.employee_id = fd.driver_employee_id " +
        "WHERE fd.fleet_dispatch_id = $1",
      [id],
    );
    const fd = r.rows[0];
    if (!fd) return { skipped: "not found" };
    if (fd.status !== "RETURNED") return { skipped: "not returned" };
    if (!fd.dossier_id) return { skipped: "dispatch not tagged to a dossier" };

    const monthly = Number(fd.base_salary || 0);
    if (!(monthly > 0)) return { skipped: "no driver salary on file" };

    const wdSetting = await getSetting(client, "hr", "working_days_per_month", null);
    const workingDays = Number((wdSetting && (wdSetting.value ?? wdSetting.days)) ?? wdSetting) || 22;
    const daily = monthly / workingDays;

    let days = 1;
    if (fd.check_out_at && fd.check_in_at) {
      const ms = new Date(fd.check_in_at).getTime() - new Date(fd.check_out_at).getTime();
      if (ms > 0) days = Math.max(1, Math.ceil(ms / 86400000));
    }
    const amount = round2(daily * days);
    if (!(amount > 0)) return { skipped: "computed cost is zero" };

    const sourceRef = "fleet_dispatch:" + id;
    const exists = await client.query("SELECT 1 FROM cost_entry WHERE source_ref = $1 LIMIT 1", [sourceRef]);
    if (exists.rows.length) return { skipped: "already attributed" };

    const ce = await costRepo.insertCostEntry(client, {
      dossier_id: fd.dossier_id,
      dictionary_item_id: null,
      category: "driver_labour",
      amount,
      entry_id: null, // analytical — the 661 is already in the payroll GL entry
      proof_vault_id: null,
      source_ref: sourceRef,
    });
    return { created: true, amount, days, cost_entry_id: ce.cost_entry_id };
  },
};
