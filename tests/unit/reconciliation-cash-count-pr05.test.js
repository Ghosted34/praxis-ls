"use strict";

const service = require("../../src/modules/master/reconciliation/reconciliation.service");
const repo = require("../../src/modules/master/reconciliation/reconciliation.repo");

describe("Cash counts PR-05 controls and hardening", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Cash-capability guard (Audit #25)", () => {
    test("rejects physical cash count for non-cash accounts (BANK without custodian)", async () => {
      const mockClient = { query: jest.fn() };
      jest.spyOn(repo, "accountContext").mockResolvedValue({
        treasury_account_id: "t-bank",
        category_code: "BANK",
        requires_custodian: false,
        reconciliation_mode: "BANK_STATEMENT",
      });

      await expect(
        service.recordCashCount(mockClient, {
          treasuryAccountId: "t-bank",
          countedTotal: 1000,
          actor: { user_id: "u1" },
        }),
      ).rejects.toThrow(/Cash counts only apply to cash and petty-cash accounts/);
    });

    test("accepts cash count for cash-capable account (category PETTY_CASH)", async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql) => {
          if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
          return { rows: [] };
        }),
      };
      jest.spyOn(repo, "accountContext").mockResolvedValue({
        treasury_account_id: "t-cash",
        category_code: "PETTY_CASH",
        requires_custodian: true,
        reconciliation_mode: "CASH_COUNT",
        entity_id: "e1",
        coa_code: "571101",
        currency: "XAF",
      });
      jest.spyOn(repo, "ledgerBalanceAsAt").mockResolvedValue(1000);
      jest.spyOn(repo, "insertCashCount").mockResolvedValue({
        cash_count_id: "cc-1",
        treasury_account_id: "t-cash",
        counted_total: 1000,
        status: "DRAFT",
      });

      const res = await service.recordCashCount(mockClient, {
        treasuryAccountId: "t-cash",
        countedTotal: 1000,
        actor: { user_id: "u1" },
      });
      expect(res.cash_count_id).toBe("cc-1");
    });
  });

  describe("Designated custodian attestation (Audit #27)", () => {
    test("rejects attestation if actor is not the designated custodian", async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql, params) => {
          if (sql.includes("SELECT user_id FROM app_user")) {
            return { rows: [{ user_id: params[0] }] };
          }
          return { rows: [] };
        }),
      };
      jest.spyOn(repo, "getCashCount").mockResolvedValue({
        cash_count_id: "cc-1",
        treasury_account_id: "t-cash",
        status: "DRAFT",
        counted_total: 1000,
        ledger_balance: 1000,
        currency: "XAF",
      });
      jest.spyOn(repo, "accountContext").mockResolvedValue({
        treasury_account_id: "t-cash",
        custodian_user_id: "custodian-uuid",
      });

      await expect(
        service.attestCashCount(mockClient, {
          cashCountId: "cc-1",
          actor: { user_id: "other-user-uuid" },
        }),
      ).rejects.toThrow(/Only the designated custodian can attest/);
    });

    test("allows attestation if actor matches designated custodian", async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql, params) => {
          if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
          if (sql.includes("SELECT user_id FROM app_user")) {
            return { rows: [{ user_id: params[0] }] };
          }
          return { rows: [] };
        }),
      };
      jest.spyOn(repo, "getCashCount").mockResolvedValue({
        cash_count_id: "cc-1",
        treasury_account_id: "t-cash",
        status: "DRAFT",
        counted_total: 1000,
        ledger_balance: 1000,
        currency: "XAF",
      });
      jest.spyOn(repo, "accountContext").mockResolvedValue({
        treasury_account_id: "t-cash",
        custodian_user_id: "custodian-uuid",
      });
      jest.spyOn(repo, "updateCashCount").mockResolvedValue({
        cash_count_id: "cc-1",
        status: "ATTESTED",
        custodian_user_id: "custodian-uuid",
      });

      const res = await service.attestCashCount(mockClient, {
        cashCountId: "cc-1",
        actor: { user_id: "custodian-uuid" },
      });
      expect(res.status).toBe("ATTESTED");
    });
  });

  describe("Cash-count approval & variance adjustment (Audit #28)", () => {
    test("requires ATTESTED status before approval", async () => {
      const mockClient = { query: jest.fn() };
      jest.spyOn(repo, "getCashCount").mockResolvedValue({
        cash_count_id: "cc-1",
        status: "DRAFT",
      });

      await expect(
        service.approveCashCount(mockClient, {
          cashCountId: "cc-1",
          actor: { user_id: "u1" },
        }),
      ).rejects.toThrow(/Cash count must be attested before approval/);
    });

    test("approves and creates draft adjustment entry on variance", async () => {
      let createdJournalEntry = false;
      const mockClient = {
        query: jest.fn().mockImplementation((sql) => {
          if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
          if (sql.includes("SELECT journal_id FROM journal")) {
            return { rows: [{ journal_id: "j-od" }] };
          }
          if (sql.includes("SELECT period_id, status FROM accounting_period")) {
            return { rows: [{ period_id: "p1", status: "OPEN" }] };
          }
          if (sql.includes("SELECT COALESCE(MAX(entry_no)")) {
            return { rows: [{ next_no: 42 }] };
          }
          if (sql.includes("INSERT INTO journal_entry")) {
            createdJournalEntry = true;
            return { rows: [{ entry_id: "entry-adj-1", entry_no: 42 }] };
          }
          if (sql.includes("INSERT INTO journal_line")) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };

      jest.spyOn(repo, "getCashCount").mockResolvedValue({
        cash_count_id: "cc-1",
        treasury_account_id: "t1",
        entity_id: "e1",
        counted_on: "2026-05-01",
        status: "ATTESTED",
        counted_total: "900.00",
        ledger_balance: "1000.00",
        difference: "-100.00",
        currency: "XAF",
        variance_reason: "Shortfall observed",
      });
      jest.spyOn(repo, "accountContext").mockResolvedValue({
        treasury_account_id: "t1",
        coa_code: "571101",
        entity_id: "e1",
        currency: "XAF",
      });
      jest.spyOn(repo, "updateCashCount").mockImplementation((client, id, patch) => ({
        cash_count_id: id,
        ...patch,
      }));

      const res = await service.approveCashCount(mockClient, {
        cashCountId: "cc-1",
        proposeAdjustment: true,
        actor: { user_id: "u1" },
      });

      expect(res.status).toBe("APPROVED_LOCKED");
      expect(res.adjustment_entry_id).toBe("entry-adj-1");
      expect(createdJournalEntry).toBe(true);
    });
  });

  describe("Cancellation & same-day recount (Audit #29)", () => {
    test("cancels a draft or attested cash count", async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql) => {
          if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
          return { rows: [] };
        }),
      };
      jest.spyOn(repo, "getCashCount").mockResolvedValue({
        cash_count_id: "cc-1",
        status: "DRAFT",
        variance_reason: null,
      });
      jest.spyOn(repo, "updateCashCount").mockImplementation((client, id, patch) => ({
        cash_count_id: id,
        ...patch,
      }));

      const res = await service.cancelCashCount(mockClient, {
        cashCountId: "cc-1",
        reason: "Count miskeyed, recount needed",
        actor: { user_id: "u1" },
      });

      expect(res.status).toBe("CANCELLED");
      expect(res.variance_reason).toContain("Count miskeyed");
    });

    test("refuses to cancel an APPROVED_LOCKED cash count", async () => {
      const mockClient = { query: jest.fn() };
      jest.spyOn(repo, "getCashCount").mockResolvedValue({
        cash_count_id: "cc-1",
        status: "APPROVED_LOCKED",
      });

      await expect(
        service.cancelCashCount(mockClient, {
          cashCountId: "cc-1",
          reason: "Too late",
          actor: { user_id: "u1" },
        }),
      ).rejects.toThrow(/Cannot cancel an approved and locked cash count/);
    });
  });
});
