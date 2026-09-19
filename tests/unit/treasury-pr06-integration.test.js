"use strict";

const treasury360 = require("../../src/modules/master/treasury-360.service");
const treasuryAccountService = require("../../src/modules/master/treasury_account/treasury_account.service");
const treasuryAccountRepo = require("../../src/modules/master/treasury_account/treasury_account.repo");
const journalService = require("../../src/modules/finance/journal_entry/journal_entry.service");

describe("Treasury PR-06 integration: Timeline, Reversals, KPIs, Search & Pagination", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Timeline actor resolution (Audit #4)", () => {
    test("returns human-readable actor name, email, or System when user is null", async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({
          rows: [
            {
              audit_id: "l-1",
              action: "treasury_account.created",
              actor_user_id: "u-1",
              actor_name: "Jane Doe",
              actor_email: "jane@example.com",
              before_snapshot: null,
              after_snapshot: { label: "Main Bank" },
              occurred_at: "2026-05-01T10:00:00Z",
            },
            {
              audit_id: "l-2",
              action: "treasury_account.verified",
              actor_user_id: null,
              actor_name: "System",
              actor_email: null,
              before_snapshot: null,
              after_snapshot: { is_verified: true },
              occurred_at: "2026-05-01T11:00:00Z",
            },
          ],
        }),
      };

      const rows = await treasury360._timeline(mockClient, "t-1");
      expect(rows).toHaveLength(2);
      expect(rows[0].actor_name).toBe("Jane Doe");
      expect(rows[0].actor_email).toBe("jane@example.com");
      expect(rows[1].actor_name).toBe("System");
    });
  });

  describe("Treasury transaction reversal (Audit #5)", () => {
    test("rejects reversal if entry does not belong to treasury account CoA code", async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      };
      jest.spyOn(treasuryAccountRepo, "get").mockResolvedValue({
        treasury_account_id: "t-1",
        coa_code: "521101",
      });

      await expect(
        treasuryAccountService.reverseEntry(mockClient, {
          accountId: "t-1",
          entryId: "entry-foreign",
          reason: "Mistake",
          actor: { user_id: "u-1" },
        }),
      ).rejects.toThrow(/Journal entry does not belong to this treasury account/);
    });

    test("delegates to journalService.reverse when entry belongs to treasury account", async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [{ line_id: "line-1", status: "validated" }] }),
      };
      jest.spyOn(treasuryAccountRepo, "get").mockResolvedValue({
        treasury_account_id: "t-1",
        coa_code: "521101",
      });
      jest.spyOn(journalService, "reverse").mockResolvedValue({
        reversal_entry_id: "rev-1",
        entry: { entry_no: 99 },
      });

      const res = await treasuryAccountService.reverseEntry(mockClient, {
        accountId: "t-1",
        entryId: "entry-valid",
        reason: "Duplicate charge",
        actor: { user_id: "u-1" },
      });

      expect(journalService.reverse).toHaveBeenCalledWith(mockClient, {
        entryId: "entry-valid",
        reason: "Duplicate charge",
        actor: { user_id: "u-1" },
      });
      expect(res.reversal_entry_id).toBe("rev-1");
    });
  });

  describe("Server-side search and pagination in repo.list (Audit #11)", () => {
    test("applies search text across label, CoA, account number, bank name, MoMo number", async () => {
      let executedSql = "";
      let executedParams = [];
      const mockClient = {
        query: jest.fn().mockImplementation((sql, params) => {
          executedSql = sql;
          executedParams = params;
          if (sql.includes("COUNT(*)")) {
            return { rows: [{ total: 1 }] };
          }
          return { rows: [{ treasury_account_id: "t-1", label: "Ecobank Operations" }] };
        }),
      };

      const result = await treasuryAccountRepo.list(mockClient, {
        search: "Ecobank",
        limit: 10,
        offset: 0,
      });

      expect(executedSql).toContain("ILIKE");
      expect(executedParams).toContain("%Ecobank%");
      expect(result).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });
  });

  describe("Treasury 360 load and reconciliation KPI (Audit #14, #16, #17)", () => {
    test("computes unreconciled count from unmatched lines and open reconciliations", async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql) => {
          if (sql.includes("FROM treasury_account t")) {
            return {
              rows: [{
                treasury_account_id: "t-1",
                label: "Main Account",
                coa_code: "521101",
                currency: "XAF",
                opening_balance: 50000,
              }],
            };
          }
          if (sql.includes("COALESCE(SUM(jl.debit),0)::numeric AS debit_all")) {
            return {
              rows: [{
                debit_all: 100000,
                credit_all: 20000,
                debit_mtd: 10000,
                credit_mtd: 5000,
                debit_ytd: 100000,
                credit_ytd: 20000,
              }],
            };
          }
          if (sql.includes("SELECT COUNT(*)::int AS cnt FROM bank_statement_line")) {
            return { rows: [{ cnt: 3 }] };
          }
          if (sql.includes("SELECT COUNT(*)::int AS cnt FROM bank_reconciliation")) {
            return { rows: [{ cnt: 1 }] };
          }
          return { rows: [] };
        }),
      };

      jest.spyOn(treasuryAccountRepo, "listDocuments").mockResolvedValue([]);
      jest.spyOn(treasuryAccountRepo, "listSignatories").mockResolvedValue([]);

      const dossier = await treasury360.load(mockClient, { id: "t-1" });
      expect(dossier).not.toBeNull();
      expect(dossier.kpis.unreconciled_count).toBe(4); // 3 unmatched lines + 1 open recon
      expect(dossier.kpis.balance).toBe(130000); // 50000 opening + (100000 - 20000) posted
      expect(dossier.kpis.mtd.net).toBe(5000); // 10000 - 5000
    });
  });
});
