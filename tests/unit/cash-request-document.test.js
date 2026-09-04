"use strict";

/**
 * The cash request and its payment receipt AS DOCUMENTS — what they must say,
 * and what they must never claim.
 *
 * WHAT THESE PIN, and why each is a defect that has already happened once in
 * this codebase or in the system it replaces.
 *
 * 1. BOTH DOC TYPES ARE REGISTERED. `COSTING` had a template and a projection
 *    and was never in `DOC_TYPES`, so `assertDocType` threw 422 and
 *    `document_vault.capture()` refused the one document its module made: the
 *    sheet could be previewed and printed and could never be FILED. A registry
 *    test is the only thing that keeps that from coming back, and this module
 *    now ships two documents rather than one.
 *
 * 2. THE VOUCHER SHOWS THE BUDGET IT DRAWS ON. A cash request is a draw
 *    against an approved costing (12771). Without the columns the approving
 *    authority signs an amount with no way to know whether the file has it —
 *    which is the whole reason the budget ledger was built.
 *
 * 3. AND OMITS THEM WHEN THERE IS NO BUDGET. An overhead request has no
 *    costing; three columns of dashes teach the reader to skip the block on
 *    the requests that do have it.
 *
 * 4. NO RAW ENUM ON A4. The legacy printed `SUBMITTED_FOR_VALIDATION` at a
 *    person. Statuses leave the rules as a {fr, en} pair.
 *
 * 5. THE JUSTIFICATION OBLIGATION IS ON THE PAPER. Whoever takes cash against
 *    a ticked line owes a receipt back (Q17), and that duty belongs on the
 *    page they sign, not only on the screen it was raised from.
 *
 * 6. THREE SEALS, NOT FOUR. The owner's rule: the requestor, the approving
 *    authority and the disbursing authority. Validating is a visa.
 *
 * 7. THE SEAL ATTESTS TO THE BUDGET LINK AND THE OBLIGATION, AND NOT TO THE
 *    LIVE LEDGER. Re-pointing an approved claim at a different budget line
 *    moves no figure on the page; clearing a justification tick erases a duty
 *    somebody signed for. Both must break the seal. What the file has LEFT
 *    changes as other requests are approved, so hashing it would report an
 *    untouched voucher as amended on somebody else's action.
 *
 * 8. THE RECEIPT CARRIES THE BALANCE, AND IT IS ATTESTED. A receipt whose
 *    balance could be restated afterwards proves nothing about what is owed.
 *
 * Every assertion reads the OUTPUT of a template or the RETURN of a pure
 * function. Reading the plumbing is what let an unregistered doc type survive.
 */

const registry = require("../../src/services/documents/templates/registry");
const kit = require("../../src/services/documents/templates/kit");
const canonical = require("../../src/services/signatures/canonical");
const rules = require("../../src/modules/costing/cash_request/cash_request.rules");
const service = require("../../src/modules/costing/cash_request/cash_request.service");
const {
  DOC_TYPES,
  isDocType,
  assertDocType,
  moduleKeyForDocType,
  signaturePolicyFor,
} = require("../../src/modules/vault/document_vault/document_vault.types");

const VOUCHER = registry.get("CASH_REQUEST");
const RECEIPT = registry.get("CASH_PAYMENT_RECEIPT");

/** The entity as the RENDERER receives it — derived lines, not raw columns. */
const ENTITY = {
  legal_name: "SMART LOGISTICS AND SERVICES LTD",
  address_lines: ["1030, Avenue Douala Manga Bell, Bali", "PO Box 5120, Douala, Cameroun"],
  identifiers: [{ kind: "RCCM", number: "RC/DLA/2021/B/2060" }, { kind: "NIU", number: "M042116033580Q" }],
  city: "Douala",
  niu: "M042116033580Q",
};

const cfgFor = (language, extra = {}) => kit.mergeCfg({}, { language, ...extra });

/**
 * The document WITHOUT its stylesheet. `kit.shell` inlines a stylesheet whose
 * comments are legitimately in English, so a grep over the raw string finds
 * English words on a French document that never prints one.
 */
const body = (html) => String(html).replace(/<style>[\s\S]*?<\/style>/g, "");

/**
 * Money is formatted with `toLocaleString("fr-FR")`, whose thousands separator
 * is U+202F (narrow no-break space) — not the space a test literal contains.
 */
const norm = (html) => String(html).replace(/[\u00a0\u202f\u2009]/g, " ");

const draw = (tpl) => (patch = {}, language = "en") =>
  norm(body(tpl.build({ ...JSON.parse(JSON.stringify(tpl.sampleData)), ...patch }, cfgFor(language), ENTITY, null)));
const voucher = draw(VOUCHER);
const receipt = draw(RECEIPT);

/** A seal as `seal-view.build` hands it to a template: `reason` is a resolved
 *  string, not a {fr, en} pair — the templates must accept both. */
const seal = (reason, name) => ({
  forParty: "SMART LOGISTICS AND SERVICES LTD",
  position: { n: 1, of: 3 },
  reason,
  signerName: name,
  signerRole: "Finance Director",
  signedAt: "27 July 2026",
  method: "Signed from your account",
  docRef: "DF-2026-0007",
  contentHash: "a".repeat(64),
  code: "ABCD-1234",
  qrSvg: "<svg></svg>",
});

/* ── 1. The doc types exist ─────────────────────────────────────────────── */

describe("the cash request and its receipt are registered doc types", () => {
  test("the vault accepts both — capture() refuses anything unregistered", () => {
    expect(isDocType("CASH_REQUEST")).toBe(true);
    expect(isDocType("CASH_PAYMENT_RECEIPT")).toBe(true);
    expect(assertDocType("CASH_PAYMENT_RECEIPT")).toBe("CASH_PAYMENT_RECEIPT");
  });

  test("reading a receipt follows its parent's grant, not the Settings grant", () => {
    // `moduleKeyForDocType` falls back to MOD-70 for anything unregistered, so
    // an unregistered receipt would be readable only by whoever administers the
    // application — and by everyone who does.
    expect(moduleKeyForDocType("CASH_PAYMENT_RECEIPT")).toBe("MOD-49");
    expect(moduleKeyForDocType("CASH_REQUEST")).toBe("MOD-49");
    expect(DOC_TYPES.CASH_PAYMENT_RECEIPT.module).toBe("costing/cash_request");
  });

  test("both are signable and wet-signable, and neither is certified", () => {
    for (const dt of ["CASH_REQUEST", "CASH_PAYMENT_RECEIPT"]) {
      const p = signaturePolicyFor(dt);
      expect(p.signable).toBe(true);
      // Money changes hands at a window, sometimes against paper — unlike a
      // costing, which never leaves the building.
      expect(p.allowsWet).toBe(true);
      // Certification is bought per envelope and is for documents a stranger
      // relies on. Both of these are internal treasury paper.
      expect(p.allowsQes).toBe(false);
    }
  });

  test("a document with no canonical payload cannot be sealed at all", () => {
    expect(canonical.isSignable("CASH_REQUEST")).toBe(true);
    expect(canonical.isSignable("CASH_PAYMENT_RECEIPT")).toBe(true);
  });
});

/* ── 2. The status is said out loud ─────────────────────────────────────── */

describe("the enum never reaches the page", () => {
  test("the rules answer with a pair, never a joined string", () => {
    expect(rules.statusWords("PARTIALLY_DISBURSED")).toEqual({ fr: "Partiellement payée", en: "Part paid" });
    // An unknown status echoes rather than resolving to a blank: a request in a
    // state nobody has named must still print something a reader can report.
    expect(rules.statusWords("WHAT")).toEqual({ fr: "WHAT", en: "WHAT" });
  });

  test("the English half is word-for-word the register's own label", () => {
    // A request the list calls "Part paid" must not print "Partially
    // disbursed" on the paper the same person signs.
    expect(rules.statusWords("APPROVED").en).toBe("To disburse");
    expect(rules.statusWords("CLOSED_SHORT").en).toBe("Settled short");
  });

  test("the voucher prints the words and not the code", () => {
    const html = voucher({ status: "PARTIALLY_DISBURSED", status_words: rules.statusWords("PARTIALLY_DISBURSED") });
    expect(html).toContain("Part paid");
    expect(html).not.toContain("PARTIALLY_DISBURSED");
  });
});

/* ── 3. The budget on every row ─────────────────────────────────────────── */

describe("the voucher shows the budget it draws on", () => {
  test("the owner's three lines, with what each leaves behind", () => {
    const html = voucher();
    expect(html).toContain("Budget");
    expect(html).toContain("Claimed");
    expect(html).toContain("Remaining after");
    // Port charges 150 000 claimed in full against a 150 000 budget line.
    expect(html).toContain("150 000 XAF");
    expect(html).toContain("2 500 000 XAF");
    expect(html).toContain("198 000 XAF");
  });

  test("an over-claim prints its negative balance rather than hiding it", () => {
    // The figure the approver must refuse. `assertFundable` enforces it; the
    // paper has to SHOW it, or the refusal arrives with no explanation.
    const html = voucher({
      lines: [{
        label: "Port charges", qty: 1, unit: 200000, tax: null, amount: 200000, claim: 200000,
        justification_required: false,
        budget: { approved: 150000, committed: 0, remaining: 150000, after: -50000 },
      }],
    });
    expect(html).toContain("-50 000 XAF");
  });

  test("an overhead request drops the block entirely rather than printing dashes", () => {
    const html = voucher({
      category: "OVH", costing_ref: null,
      lines: [{ label: "Office supplies", qty: 1, unit: 40000, tax: 19.25, amount: 40000, claim: 47700, justification_required: false, budget: null }],
    });
    expect(html).not.toContain("Remaining after");
    expect(html).not.toContain("Claimed");
    // The claim itself still prints — dropping the budget must not drop the money.
    expect(html).toContain("47 700 XAF");
  });

  test("the costing reference and its revision are on the page", () => {
    // The legacy's COSTING REF row: a reader who queries a figure needs to know
    // which sheet it came from, and which version of it was approved.
    expect(voucher()).toContain("CST-2026-0012 · rév. 2");
    // Revision 1 is the only revision — printing "rév. 1" is noise.
    expect(voucher({ costing_revision: 1 })).toContain("CST-2026-0012");
    expect(voucher({ costing_revision: 1 })).not.toContain("rév. 1");
  });
});

/* ── 4. The requisitioner ───────────────────────────────────────────────── */

describe("the legacy's requisitioner grid, kept", () => {
  test("name, matricule, department and job title", () => {
    const html = voucher();
    expect(html).toContain("SLAS-137");
    expect(html).toContain("Chef de quai");
    expect(html).toContain("Opérations");
  });

  test("the name is printed once, not twice", () => {
    // `parties` already carries it in bold with their contact; a grid that
    // repeats it is how a reader learns the grid is padding.
    const html = voucher();
    expect(html.match(/Jean Mballa/g)).toHaveLength(1);
  });

  test("a requester with no employee record drops the grid entirely", () => {
    // `factsGrid` drops empty cells and `ruledBlock` drops an empty block, so
    // the page shrinks rather than printing three dashes at a cashier who is
    // trying to match a face to a row.
    const html = voucher({ requisitioner: { name: "Jean Mballa", staff_no: null, department: null, job_title: null } });
    expect(html).toContain("Jean Mballa");
    expect(html).not.toContain("Staff no.");
    expect(html).not.toContain("Requisitioner");
  });
});

/* ── 5. The justification obligation ────────────────────────────────────── */

describe("the justification tick reaches the paper", () => {
  test("a dagger on the line and one sentence at the foot", () => {
    const html = voucher();
    expect(html).toContain("‡ Port charges");
    expect(html).toContain("must bring back the third-party receipt");
    // The line that owes nothing carries no mark.
    expect(html).toContain(">Terminal handling charges<");
  });

  test("no obliged line, no note — the sentence is not boilerplate", () => {
    const html = voucher({
      lines: [{ label: "Port charges", qty: 1, unit: 150000, tax: null, amount: 150000, claim: 150000, justification_required: false, budget: null }],
    });
    expect(html).not.toContain("third-party receipt");
  });

  test("the catalogue can only tighten the tick, never loosen it", async () => {
    // Q17's floor. It inverts silently: swap the condition and every obliged
    // line simply stops being obliged, with nothing anywhere to notice.
    const client = {
      query: async () => ({
        rows: [
          { dictionary_item_id: "always", receipt_requirement: "ALWAYS_REQUIRED", requires_justification: false },
          { dictionary_item_id: "maybe", receipt_requirement: "CONDITIONALLY_REQUIRED", requires_justification: false },
        ],
      }),
    };
    const out = await service.applyCatalogueObligations(client, [
      // Unticked by the user, but the catalogue always demands a receipt.
      { dictionary_item_id: "always", justification_required: false },
      // "It depends" is not an obligation — a flag raised on a maybe is noise.
      { dictionary_item_id: "maybe", justification_required: false },
      // Ticked by hand on a maybe: the user may always be STRICTER.
      { dictionary_item_id: "maybe", justification_required: true },
      // No catalogue item at all — a free-typed line keeps what it was given.
      { dictionary_item_id: null, justification_required: true },
    ]);
    expect(out.map((l) => l.justification_required)).toEqual([true, false, true, true]);
  });

  test("no dictionary items means no query and the lines come back untouched", async () => {
    let called = false;
    const client = { query: async () => { called = true; return { rows: [] }; } };
    const lines = [{ dictionary_item_id: null, justification_required: false }];
    await expect(service.applyCatalogueObligations(client, lines)).resolves.toEqual(lines);
    expect(called).toBe(false);
  });
});

/* ── 5b. The order the lines are read in ────────────────────────────────── */

describe("lines and payments come back in a meaningful order", () => {
  const repo = require("../../src/modules/costing/cash_request/cash_request.repo");
  /** A client that records the SQL rather than running it. */
  const spy = () => { const sql = []; return { sql, query: async (q) => { sql.push(q); return { rows: [] }; } }; };

  test("lines are ordered by line_no, not by uuid", async () => {
    // This read was `ORDER BY cash_request_line_id` — a uuid: stable, and
    // meaningless. It is not only cosmetic: `applySpend` falls back to matching
    // BY POSITION when a caller sends no line ids, so under the old ordering
    // spend could be recorded against the wrong line, silently, in the one
    // workflow where the numbers are the point.
    const c = spy();
    await repo.listLines(c, "id");
    expect(c.sql[0]).toContain("ORDER BY line_no, cash_request_line_id");
  });

  test("payments carry a tie-break, because the receipt is numbered from it", async () => {
    // `paid_on` is a DATE. Two instalments released on one day would order
    // arbitrarily, and two receipts could each claim to be the second — with
    // two different balances, both sealed.
    const c = spy();
    await repo.listPayments(c, "id");
    expect(c.sql[0]).toContain("ORDER BY paid_on, cash_request_payment_id");
  });
});

/* ── 6. The payments ────────────────────────────────────────────────────── */

describe("a part-paid request says so on paper", () => {
  test("the tranche, the running balance and whether it was acknowledged", () => {
    const html = voucher();
    expect(html).toContain("Disbursements");
    expect(html).toContain("1 000 000 XAF");
    // The balance runs DOWN the column so nobody has to subtract.
    expect(html).toContain("1 848 000 XAF");
    expect(html).toContain("Already disbursed");
    expect(html).toContain("Balance to disburse");
  });

  test("an unacknowledged tranche is named as one — it is what the treasurer chases", () => {
    const html = voucher({
      payments: [{ no: 1, paid_on: "2026-07-28", amount: 1000000, balance: 1848000, received_at: null, received_ack_kind: null }],
    });
    expect(html).toContain("Pending");
  });

  test("an unpaid voucher does not restate its total twice", () => {
    const html = voucher({ payments: [], paid_total: 0, balance: 2848000 });
    expect(html).not.toContain("Already disbursed");
    expect(html).not.toContain("Disbursements");
  });
});

/* ── 7. The seals ───────────────────────────────────────────────────────── */

describe("three seals on the voucher, and ruled boxes when there are none", () => {
  test("an unsealed voucher can still be signed — by hand, in three places", () => {
    const html = voucher({ seals: [] });
    expect(html).toContain("REQUESTED BY");
    expect(html).toContain("APPROVED BY");
    expect(html).toContain("DISBURSED BY");
    // Validating is a visa, not a signature (owner Q20). A fourth box would
    // misdescribe who decided.
    expect(html).not.toContain("VALIDATED BY");
  });

  test("the seals replace the ruled lines and each names its own decision", () => {
    const html = voucher({
      seals: [seal("Requested", "Jean Mballa"), seal("Approved for payment", "Marie Fotso"), seal("Disbursed", "Paul Ndam")],
    });
    expect(html).toContain("Jean Mballa");
    expect(html).toContain("Approved for payment");
    expect(html).not.toContain("REQUESTED BY");
  });

  test("the transitions that seal are the requestor and the approver, and nobody else", () => {
    // Guards the MAP itself, because adding a key is a one-line change that
    // puts a fourth signature on every voucher this tenant ever prints.
    expect(rules.TRANSITION_SEAL).toEqual({ SUBMITTED: "REQUESTED", APPROVED: "APPROVED_PAYMENT" });
    // VALIDATED is a real state — this is not passing because the status is
    // misspelt. It simply does not sign.
    expect(Object.keys(rules.NEXT)).toContain("VALIDATED");
    expect(rules.TRANSITION_SEAL.VALIDATED).toBeUndefined();
    // The third signatory signs by DISBURSING, not by a status change: money
    // has to actually leave, and the seal belongs to that act.
    expect(rules.DISBURSE_SEAL).toBe("DISBURSED");
    expect(rules.RECEIPT_SEAL).toBe("CASH_RECEIVED");
  });

  test("every reason the code signs under is one the migration seeds", () => {
    // `signInternal` refuses an unlisted `sign_reason` with 422, and the seal
    // is best-effort — so a code that never reached `signature_reason` would
    // lose every signature silently, with one line in the log.
    const sql = require("fs").readFileSync(
      require("path").join(__dirname, "../../migrations/tenant/12773_cash_request_signature_policy.sql"),
      "utf8",
    );
    const used = [...Object.values(rules.TRANSITION_SEAL), rules.DISBURSE_SEAL, rules.RECEIPT_SEAL];
    for (const code of used) {
      // APPROVED_PAYMENT ships with 10772; the other three are seeded here.
      if (code === "APPROVED_PAYMENT") continue;
      expect(sql).toContain(`'${code}'`);
    }
  });
});

/* ── 8. What the voucher's seal attests to ──────────────────────────────── */

describe("the voucher's canonical payload", () => {
  const doc = () => ({
    number: "DF-2026-0007", date: "2026-07-27", status: "APPROVED",
    dossier_ref: "SBX-2026-0001", currency: "XAF", category: "OPS",
    beneficiary: "DHL", cost_center: null, method: "BANK",
    costing_id: "c-1", costing_ref: "CST-2026-0012", costing_revision: 2,
    party: { name: "Jean Mballa", lines: [] },
    lines: [{ label: "Port charges", costing_line_id: "cl-1", qty: 1, unit: 150000, tax: null, justification_required: true, amount: 150000 }],
    totals: { subtotal: 2848000, vat_total: 0, total_payable: 2848000 },
  });

  test("re-pointing a claim at a different budget line breaks the seal", () => {
    // It moves no figure on the page and changes which budget it consumes.
    const before = canonical.hash("CASH_REQUEST", doc());
    const after = doc();
    after.lines[0].costing_line_id = "cl-2";
    expect(canonical.hash("CASH_REQUEST", after)).not.toBe(before);
  });

  test("clearing a justification tick breaks the seal", () => {
    // It erases a duty somebody signed for.
    const before = canonical.hash("CASH_REQUEST", doc());
    const after = doc();
    after.lines[0].justification_required = false;
    expect(canonical.hash("CASH_REQUEST", after)).not.toBe(before);
  });

  test("the live budget and the payments are NOT attested", () => {
    // What the file has left changes as OTHER requests are approved, and each
    // instalment is attested by its own receipt. Hashing either would report an
    // untouched voucher as amended on somebody else's action.
    const before = canonical.hash("CASH_REQUEST", doc());
    const after = doc();
    after.lines[0].budget = { approved: 1, committed: 2, remaining: 3, after: 4 };
    after.payments = [{ no: 1, amount: 1000000 }];
    after.budget_totals = { remaining: 0 };
    expect(canonical.hash("CASH_REQUEST", after)).toBe(before);
  });

  test("a repriced line breaks the seal", () => {
    const before = canonical.hash("CASH_REQUEST", doc());
    const after = doc();
    after.lines[0].unit = 160000;
    expect(canonical.hash("CASH_REQUEST", after)).not.toBe(before);
  });

  test("the STATUS is not attested, where the costing's is", () => {
    /*
     * The one place these two documents must differ, and getting it wrong is
     * silent. A costing ENDS at APPROVED_LOCKED, so hashing its status is
     * hashing a fact that never moves again. A cash request goes on to
     * PARTIALLY_DISBURSED, DISBURSED and JUSTIFIED, days or weeks after the
     * approver signed — so with `status` in the payload every seal on every
     * voucher in the product reads AMENDED the moment the first franc moves.
     *
     * That is not hypothetical: it was the behaviour, found by walking a
     * request through two instalments against a real database. All three seals
     * went AMENDED on the second one.
     */
    const before = canonical.hash("CASH_REQUEST", doc());
    for (const status of ["PARTIALLY_DISBURSED", "DISBURSED", "JUSTIFIED", "CLOSED_SHORT"]) {
      expect(canonical.hash("CASH_REQUEST", { ...doc(), status })).toBe(before);
    }
    // The costing keeps its own, and this is the assertion that says the
    // asymmetry is deliberate rather than an oversight in one of the two.
    const costing = { number: "C-1", date: "2026-01-01", status: "APPROVED_LOCKED", lines: [], totals: {} };
    expect(canonical.hash("COSTING", { ...costing, status: "REJECTED" }))
      .not.toBe(canonical.hash("COSTING", costing));
  });
});

/* ── 9. The receipt ─────────────────────────────────────────────────────── */

describe("the payment receipt", () => {
  test("it carries the request, the approval date, what was paid and what is left", () => {
    const html = receipt();
    expect(html).toContain("DF-2026-0007");
    expect(html).toContain("Approved on");
    expect(html).toContain("2026-07-27");
    expect(html).toContain("1 000 000 XAF");
    expect(html).toContain("Balance to disburse");
    expect(html).toContain("1 848 000 XAF");
  });

  test("a request paid in one tranche does not print '1 / 1'", () => {
    const html = receipt({ instalment_count: 1, instalment_no: 1 });
    expect(html).not.toContain("Instalment");
  });

  test("two signatures, not three — the requestor already signed the request", () => {
    const html = receipt({ seals: [] });
    expect(html).toContain("DISBURSED BY");
    expect(html).toContain("RECEIVED BY");
    expect(html).not.toContain("APPROVED BY");
  });

  test("the balance is attested — a receipt whose balance can be restated proves nothing", () => {
    const doc = {
      number: "DF-2026-0007 / R1", date: "2026-07-28", currency: "XAF",
      dossier_ref: "SBX-2026-0001", request_number: "DF-2026-0007",
      request_approved_at: "2026-07-27", party: { name: "Jean Mballa", lines: [] },
      amount: 1000000, request_total: 2848000, paid_to_date: 1000000, balance: 1848000,
      method: "CASH", treasury_account: "Caisse principale",
    };
    const before = canonical.hash("CASH_PAYMENT_RECEIPT", doc);
    expect(canonical.hash("CASH_PAYMENT_RECEIPT", { ...doc, balance: 0 })).not.toBe(before);
    expect(canonical.hash("CASH_PAYMENT_RECEIPT", { ...doc, amount: 999999 })).not.toBe(before);
  });

  test("its number is derived from the request's, so the two read as one file", () => {
    expect(receipt()).toContain("DF-2026-0007 / R1");
  });
});

/* ── 10. Both documents print in French without an English word ─────────── */

describe("a French document prints no English", () => {
  test("the voucher", () => {
    const html = voucher({}, "fr");
    expect(html).toContain("Demande de fonds");
    expect(html).toContain("Reste après");
    expect(html).not.toContain("Remaining after");
    expect(html).not.toContain("TOTAL PAYABLE");
  });

  test("the receipt", () => {
    const html = receipt({}, "fr");
    expect(html).toContain("Reçu de décaissement");
    expect(html).toContain("Reste à décaisser");
    expect(html).not.toContain("Balance to disburse");
  });
});
