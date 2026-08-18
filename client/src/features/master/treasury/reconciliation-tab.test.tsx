/**
 * Treasury 360 — the Reconciliation tab.
 *
 * WHAT THIS FILE GUARDS, and why each one is worth a test:
 *
 * 1. NOTHING IS STORED UNTIL A HUMAN ACCEPTS THE PREVIEW. Uploading calls
 *    `preview`, which parses in memory. If the import request could ever be
 *    issued from the upload itself, a mis-parsed statement would reach the
 *    database before anyone had seen a number.
 *
 * 2. A STATEMENT THAT DOES NOT FOOT CANNOT BE IMPORTED FROM THIS SCREEN.
 *    Declared balances disagreeing with the sum of the lines means the file was
 *    misread; every figure derived from it would be fiction. The import control
 *    has to be absent, not merely discouraged.
 *
 * 3. A NEW LAYOUT ASKS, ONCE. The mapping pane must appear for an unknown
 *    header signature and must show what the proposed map DOES to the data —
 *    a column-name dropdown alone gives a treasurer no way to spot a wrong map.
 *
 * 4. AN AMBIGUOUS DATE ORDER IS RAISED IN ITS OWN RIGHT. It is the one parse
 *    fault the footing arithmetic cannot catch downstream, so the UI must not
 *    let it pass silently.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { ReconciliationTab } from "./reconciliation-tab";

const ACCOUNT = {
  treasury_account_id: "t1", label: "Afriland Main", currency: "XAF",
  category_code: "BANK", is_momo: false, is_bank: true,
};
const FILE = { name: "releve.csv", hash: "abc", size: 400, source_kind: "CSV" as const };

/** A preview of a file whose layout is already known and which adds up. */
const READY = {
  status: "READY",
  account: ACCOUNT,
  file: FILE,
  already_imported: null,
  profile: { statement_profile_id: "p1", label: "Afriland First Bank", institution: "Afriland First Bank" },
  line_count: 3,
  duplicate_count: 0,
  rejected: [],
  footing: {
    foots: true, difference: 0, movement: 233000, expected: 233000,
    basis: "DECLARED_BALANCES", reason: "declared closing = declared opening + sum of movements",
  },
  preview: [
    { booking_date: "2026-04-03", amount: 250000, description: "VIR RECU DUPONT SARL", external_ref: "FT26094XYZ12", fee: 0 },
    { booking_date: "2026-04-05", amount: -5000, description: "FRAIS TENUE DE COMPTE", external_ref: null, fee: 0 },
  ],
  source_meta: {},
};

/** The same file, misread: the lines do not agree with the declared balances. */
const DOES_NOT_FOOT = {
  ...READY,
  footing: {
    foots: false, difference: -12000, movement: 221000, expected: 233000,
    basis: "DECLARED_BALANCES",
    reason: "sum of movements is 221000.00 but the declared balances imply 233000.00",
  },
};

/** A layout nobody has confirmed yet. */
const NEEDS_MAPPING = {
  status: "NEEDS_MAPPING",
  account: ACCOUNT,
  file: FILE,
  already_imported: null,
  headers: ["Date d'operation", "Libelle", "Debit", "Credit", "Solde"],
  sample: [],
  message: "This layout has not been seen before.",
  source_meta: {},
  proposal: {
    profile: {
      column_map: {
        booking_date: "Date d'operation", description: "Libelle",
        debit: "Debit", credit: "Credit", running_balance: "Solde",
      },
      sign_convention: "DEBIT_CREDIT_COLUMNS",
      date_format: "DD/MM/YYYY",
      decimal_separator: ",", thousands_separator: " ",
      header_signature: "sig123",
    },
    field_source: { booking_date: "heuristic", debit: "heuristic" },
    field_scores: { booking_date: 1 },
    model_used: false,
    detection: {
      number: { decimalSeparator: ",", thousandsSeparator: " ", confidence: 1, reason: "comma-decimal (French locale)" },
      // Deliberately ambiguous — every sample reads both ways.
      date: { format: "DD/MM/YYYY", confidence: 0.5, ambiguous: true, reason: "every sample is valid read either way" },
    },
    verification: { ok: true, errors: [], warnings: [], stats: {} },
    preview: [
      { booking_date: "2026-04-03", amount: 250000, description: "VIR RECU DUPONT SARL", external_ref: null, fee: 0 },
    ],
    alternatives: { booking_date: [{ header: "Date d'operation", score: 1 }] },
  },
};

/**
 * The harness resolves a fixture by LONGEST PREFIX of the request path, so the
 * preview route has to be keyed more specifically than the statements list it
 * shares a prefix with.
 */
const render = (previewResult: unknown) =>
  renderScreen(
    <ReconciliationTab
      accountId="t1"
      entityId="e1"
      currency="XAF"
      categoryCode="BANK"
      requiresCustodian={false}
    />,
    {
      routes: {
        "/reconciliation/statements/preview": previewResult,
        "/reconciliation/statements": [],
        "/reconciliation": [],
      },
    },
  );

/** Drop a file on the dropzone the way the picker does. */
const upload = async (user: ReturnType<typeof userEvent.setup>, name = "releve.csv") => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(["Date;Libelle\n"], name, { type: "text/csv" }));
};

describe("Treasury · reconciliation tab", () => {
  it("previews an upload rather than importing it — nothing is stored until a person accepts", async () => {
    const user = userEvent.setup();
    render(READY);

    await upload(user);

    // The upload produced a VERDICT to read, not an import: the footing result
    // and the parsed rows are on screen, and committing is a separate,
    // deliberate act still to be taken.
    await screen.findByText(/this statement adds up/i);
    expect(screen.getByText(/VIR RECU DUPONT SARL/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /import this statement/i })).toBeInTheDocument();
  });

  it("refuses to offer an import when the statement does not add up", async () => {
    const user = userEvent.setup();
    render(DOES_NOT_FOOT);

    await upload(user);
    await screen.findByText(/this statement does not add up/i);

    // The arithmetic is spelled out rather than reduced to a warning...
    expect(screen.getByText(/221 000|221,000/)).toBeInTheDocument();
    // ...and there is no way to import it from here at all.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /import this statement/i })).not.toBeInTheDocument());
  });

  it("asks for a column mapping when the layout is new, and shows what the mapping does to the data", async () => {
    const user = userEvent.setup();
    render(NEEDS_MAPPING);

    await upload(user);
    await screen.findByText(/new statement layout/i);

    // The map is editable per field...
    expect(await screen.findByLabelText("booking_date")).toHaveValue("Date d'operation");
    // ...and the parsed RESULT is shown beside it, which is the only way a
    // treasurer can tell a wrong map from a right one.
    expect(screen.getByText(/VIR RECU DUPONT SARL/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm mapping and continue/i })).toBeInTheDocument();
  });

  it("raises an ambiguous date order rather than settling it quietly", async () => {
    const user = userEvent.setup();
    render(NEEDS_MAPPING);

    await upload(user);
    expect(await screen.findByText(/check the date order/i)).toBeInTheDocument();
    // The treasurer is given the choice explicitly.
    expect(screen.getByRole("button", { name: "MM/DD/YYYY" })).toBeInTheDocument();
  });

  it("tells a petty-cash account it reconciles against a count, not a statement", async () => {
    renderScreen(
      <ReconciliationTab
        accountId="t1" entityId="e1" currency="XAF"
        categoryCode="PETTY_CASH" requiresCustodian
      />,
      { routes: { "/reconciliation": [] } },
    );
    // `findBy` rather than `getBy`: the statement list still loads behind the
    // early return, and settling it here keeps the state update inside act().
    expect(await screen.findByText(/reconciles against a physical count/i)).toBeInTheDocument();
  });
});
