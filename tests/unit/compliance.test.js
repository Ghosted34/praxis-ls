"use strict";
const rules = require("../../src/modules/vault/compliance_flag/compliance_flag.rules");
const service = require("../../src/modules/vault/compliance_flag/compliance_flag.service");

describe("Compliance Checker rules (MOD-65)", () => {
  test("catalogue + severities", () => {
    expect(rules.ruleKeys()).toEqual(expect.arrayContaining([
      "cost_entry.missing_proof", "procurement.unmatched", "regie.aged_unjustified", "debours.tax_violation",
    ]));
    expect(rules.severityOf("debours.tax_violation")).toBe("RED");
    expect(rules.severityOf("cost_entry.missing_proof")).toBe("WARN");
  });
  test("summarize by severity", () => {
    const s = rules.summarize([{ severity: "RED" }, { severity: "WARN" }, { severity: "RED" }]);
    expect(s).toMatchObject({ total: 3, red: 2, warn: 1, clean: false });
    expect(rules.summarize([]).clean).toBe(true);
  });
});

describe("Compliance Checker run (MOD-65)", () => {
  test("raises a RED flag for a débours-with-tax violation", async () => {
    const client = {
      query: async (sql, params = []) => {
        if (/FROM journal_line WHERE is_debours/.test(sql)) return { rows: [{ line_id: "l1", entry_id: "e1" }] };
        if (/INTO compliance_flag/.test(sql)) return { rows: [{ flag_id: "f1", rule_key: params[0], entity_ref: params[1], severity: params[2], message: params[3] }] };
        if (/FROM event_type/.test(sql)) return { rows: [{ is_security_critical: false }] };
        return { rows: [] }; // BEGIN/COMMIT/DELETE/other scans/event_log/audit
      },
    };
    const out = await service.run(client, { rules: ["debours.tax_violation"] });
    expect(out.summary.red).toBe(1);
    expect(out.flags[0].severity).toBe("RED");
    expect(out.flags[0].entity_ref).toBe("journal_line:l1");
  });

  test("clean run when no offenders", async () => {
    const client = { query: async (sql) => (/FROM event_type/.test(sql) ? { rows: [{ is_security_critical: false }] } : { rows: [] }) };
    const out = await service.run(client, { rules: ["regie.aged_unjustified"] });
    expect(out.summary.clean).toBe(true);
    expect(out.flags).toHaveLength(0);
  });
});
