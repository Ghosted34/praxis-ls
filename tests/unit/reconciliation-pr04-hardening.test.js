"use strict";
/**
 * Reconciliation tab hardening (PR-04, Audit #18-24).
 */
const service = require("../../src/modules/master/reconciliation/reconciliation.service");
const repo = require("../../src/modules/master/reconciliation/reconciliation.repo");

describe("Reconciliation PR-04 hardening", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("manualMatch validation (Audit #21)", () => {
    test("rejects journal line when account code does not match treasury leaf", async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql) => {
          if (sql.includes("SELECT jl.line_id")) {
            return {
              rows: [{
                line_id: "jl-1",
                account_code: "521102",
                debit: 1000,
                credit: 0,
                currency: "XAF",
                entity_id: "e1",
                status: "validated",
              }],
            };
          }
          return { rows: [] };
        }),
      };

      jest.spyOn(repo, "getLine").mockResolvedValue({
        statement_line_id: "sl-1",
        treasury_account_id: "t1",
        amount: 1000,
      });
      jest.spyOn(repo, "accountContext").mockResolvedValue({
        treasury_account_id: "t1",
        coa_code: "521101",
        entity_id: "e1",
        currency: "XAF",
      });

      await expect(
        service.manualMatch(mockClient, {
          statementLineId: "sl-1",
          journalLineId: "jl-1",
          actor: {},
        }),
      ).rejects.toThrow(/does not match treasury account CoA code/);
    });

    test("rejects journal line if not validated", async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql) => {
          if (sql.includes("SELECT jl.line_id")) {
            return {
              rows: [{
                line_id: "jl-1",
                account_code: "521101",
                debit: 1000,
                credit: 0,
                currency: "XAF",
                entity_id: "e1",
                status: "draft",
              }],
            };
          }
          return { rows: [] };
        }),
      };

      jest.spyOn(repo, "getLine").mockResolvedValue({
        statement_line_id: "sl-1",
        treasury_account_id: "t1",
        amount: 1000,
      });
      jest.spyOn(repo, "accountContext").mockResolvedValue({
        treasury_account_id: "t1",
        coa_code: "521101",
        entity_id: "e1",
        currency: "XAF",
      });

      await expect(
        service.manualMatch(mockClient, {
          statementLineId: "sl-1",
          journalLineId: "jl-1",
          actor: {},
        }),
      ).rejects.toThrow(/validated journal entry/);
    });

    test("rejects journal line on entity mismatch", async () => {
      const mockClient = {
        query: jest.fn().mockImplementation((sql) => {
          if (sql.includes("SELECT jl.line_id")) {
            return {
              rows: [{
                line_id: "jl-1",
                account_code: "521101",
                debit: 1000,
                credit: 0,
                currency: "XAF",
                entity_id: "e2",
                status: "validated",
              }],
            };
          }
          return { rows: [] };
        }),
      };

      jest.spyOn(repo, "getLine").mockResolvedValue({
        statement_line_id: "sl-1",
        treasury_account_id: "t1",
        amount: 1000,
      });
      jest.spyOn(repo, "accountContext").mockResolvedValue({
        treasury_account_id: "t1",
        coa_code: "521101",
        entity_id: "e1",
        currency: "XAF",
      });

      await expect(
        service.manualMatch(mockClient, {
          statementLineId: "sl-1",
          journalLineId: "jl-1",
          actor: {},
        }),
      ).rejects.toThrow(/entity does not match/);
    });
  });

  describe("proposeEntryForLine (Audit #23)", () => {
    test("rejects if line already has a proposed draft entry", async () => {
      const mockClient = { query: jest.fn() };
      jest.spyOn(repo, "getLine").mockResolvedValue({
        statement_line_id: "sl-1",
        proposed_entry_id: "je-existing",
      });

      await expect(
        service.proposeEntryForLine(mockClient, {
          statementLineId: "sl-1",
          actor: {},
        }),
      ).rejects.toThrow(/already been proposed/);
    });
  });
});
