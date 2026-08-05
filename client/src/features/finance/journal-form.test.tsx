/**
 * The journal-entry form — the first screen on `<Form>` + a shared schema.
 *
 * These assert the thing the migration was FOR, which is not "the form still
 * works". It is that the form's idea of a postable entry is now the ledger's
 * idea, byte for byte, because both call `@praxis/shared`'s `ledger` module.
 *
 * The version this replaces computed its own answer and got it wrong in three
 * ways an operator felt — see the component's header. Each of those three is a
 * test below, and each one FAILS against the old boolean:
 *
 *     const linesValid = lines.every((l) => l.account_code && (num(l.debit) > 0 || num(l.credit) > 0));
 *
 * That is audit F12 in one line: the client re-implementing rules the API owns.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ledger, journalEntry } from "@shared";

/* ── the shared rules, directly ────────────────────────────────────────────── */

const L = (account_code: string, debit?: string | number, credit?: string | number) => ({
  account_code,
  debit,
  credit,
});

describe("ledger rules (the client half of @praxis/shared)", () => {
  it("accepts a balanced two-line entry", () => {
    expect(ledger.checkPostable([L("521", 1000), L("4191", undefined, 1000)])).toEqual({ ok: true });
  });

  it("REJECTS A LINE WITH BOTH SIDES — the old form accepted it", () => {
    // `debit > 0 || credit > 0` is true here, so the old boolean said "valid",
    // Post was enabled, and the server returned LINE_ONE_SIDE.
    const r = ledger.checkPostable([L("521", 100, 100), L("4191", undefined, 100)]);
    expect(r).toMatchObject({ ok: false, code: "LINE_ONE_SIDE", line: 0 });
  });

  it("REJECTS MORE THAN TWO DECIMALS — the old form never checked", () => {
    const r = ledger.checkPostable([L("521", "33.333"), L("4191", undefined, "33.333")]);
    expect(r).toMatchObject({ ok: false, code: "INVALID_AMOUNT", line: 0 });
  });

  it("REJECTS COMPENSATION — the old form never checked", () => {
    // Balanced, one side per line, and still not postable: KB §23.6 forbids an
    // account being both debited and credited in one entry.
    const r = ledger.checkPostable([L("521", 1000), L("521", undefined, 400), L("4191", undefined, 600)]);
    expect(r).toMatchObject({ ok: false, code: "COMPENSATION" });
  });

  it("reports the FIRST problem and which line it is on", () => {
    // An operator fixes one thing at a time; five messages about one mistyped
    // number is noise.
    const r = ledger.checkPostable([L("521", 1000), L("", undefined, 1000)]);
    expect(r).toMatchObject({ ok: false, code: "LINE_NO_ACCOUNT", line: 1 });
  });

  it("sums in minor units, so float drift cannot unbalance a balanced entry", () => {
    // 0.1 + 0.2 === 0.30000000000000004.
    expect(ledger.checkPostable([L("521", 0.1), L("571", 0.2), L("4191", undefined, 0.3)])).toEqual({ ok: true });
  });

  it("treats an empty string as an empty side, which is what a form holds", () => {
    expect(ledger.checkPostable([L("521", "1000", ""), L("4191", "", "1000")])).toEqual({ ok: true });
  });

  it("needs at least two lines", () => {
    expect(ledger.checkPostable([L("521", 1000)])).toMatchObject({ ok: false, code: "ENTRY_TOO_FEW_LINES" });
  });
});

/* ── the schema, as the form uses it ───────────────────────────────────────── */

describe("journalEntry.post — the same object the API parses with", () => {
  const valid = {
    entity_id: "11111111-1111-4111-8111-111111111111",
    journal_code: "VT",
    entry_date: "2026-07-01",
    source_doc_ref: "INV-1",
    lines: [
      { account_code: "521", debit: "1000" },
      { account_code: "4191", credit: "1000" },
    ],
  };

  it("coerces a form's strings to the numbers the API stores", () => {
    const out = journalEntry.post.parse(valid);
    expect(out.lines[0].debit).toBe(1000);
    // An untouched side is absent, not 0 — the ledger's one-side rule reads it.
    expect(out.lines[0].credit).toBeUndefined();
  });

  it("REJECTS AN IMPOSSIBLE DATE, which the old regex accepted", () => {
    // `new Date("2026-02-31")` rolls over to 3 March and reports success, so a
    // naive check posts the entry to the wrong period.
    const r = journalEntry.post.safeParse({ ...valid, entry_date: "2026-02-31" });
    expect(r.success).toBe(false);
  });

  it("requires a journal, by code or by id", () => {
    const { journal_code: _omitted, ...withoutJournal } = valid;
    const r = journalEntry.post.safeParse(withoutJournal);
    expect(r.success).toBe(false);
    // Pointed at a field the form actually renders — an error with no reachable
    // path renders nowhere.
    expect(r.success === false && r.error.issues[0].path).toEqual(["journal_code"]);
  });

  it("requires at least two lines", () => {
    expect(journalEntry.post.safeParse({ ...valid, lines: [valid.lines[0]] }).success).toBe(false);
  });
});

/* ── the form itself ───────────────────────────────────────────────────────── */

const postJournalEntry = vi.fn();
vi.mock("@/lib/finance-api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    today: () => "2026-07-01",
    loadEntities: async () => [{ id: "11111111-1111-4111-8111-111111111111", label: "SmartBox", code: "SBX" }],
    loadPostableAccounts: async () => [
      { id: "521", label: "521 — Banque" },
      { id: "4191", label: "4191 — Clients avances" },
    ],
    postJournalEntry: (...args: unknown[]) => postJournalEntry(...args),
  };
});

async function renderForm() {
  const { JournalsPage } = await import("./journals");
  const { renderScreen } = await import("@/test/screen-harness");
  const r = renderScreen(<JournalsPage />, { routes: { "/journal-entries": [] } });
  await userEvent.click(await screen.findByRole("button", { name: /post entry/i }));
  return r;
}

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});

describe("JournalEntryForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens with two lines and Post disabled — an empty entry is not postable", async () => {
    await renderForm();
    const post = screen.getByRole("button", { name: /save draft|validate & post/i });
    expect(post).toBeDisabled();
    expect(screen.getAllByRole("combobox", { name: /^Account, line/ })).toHaveLength(2);
  });

  it("EVERY FIELD IS LABELLED — <Field> does it, not each call site", async () => {
    // F4: 565 Field sites, 0 with a label→control association. The line inputs
    // are visually label-less by design and still carry a name.
    await renderForm();
    expect(screen.getByRole("textbox", { name: /Source document ref/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Debit, line 1" })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Credit, line 2" })).toBeInTheDocument();
  });

  it("says WHY it is not postable, in the ledger's own words", async () => {
    await renderForm();
    const status = screen.getAllByRole("status").find((n) => /at least two lines|choose an account/i.test(n.textContent ?? ""));
    expect(status).toBeDefined();
  });

  it("keeps Post disabled for a line with BOTH sides filled", async () => {
    // The regression the old boolean allowed through to the server.
    await renderForm();
    await userEvent.type(screen.getByRole("spinbutton", { name: "Debit, line 1" }), "100");
    await userEvent.type(screen.getByRole("spinbutton", { name: "Credit, line 1" }), "100");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save draft|validate & post/i })).toBeDisabled(),
    );
  });

  it("has no axe violations", async () => {
    const { container } = await renderForm();
    expect(await axe(container)).toHaveNoViolations();
  });
});
