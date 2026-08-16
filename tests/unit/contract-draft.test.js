"use strict";
/**
 * Drafting a contract (0700).
 *
 * ── WHAT THESE PROTECT ─────────────────────────────────────────────────────
 *
 * A contract is the one document where a helpful model is dangerous. Rounding a
 * salary, "tidying" a notice period or filling in a probation length nobody
 * agreed invents a term the employer will then SIGN. So:
 *
 *   · the terms are passed in as facts and written to their own columns by the
 *     caller, never parsed back out of the prose;
 *   · a fact that was not given produces NO CLAUSE rather than a guess;
 *   · a model that fails, or returns three lines, falls back to a template that
 *     is itself a real contract — and the row records which produced it, so
 *     nobody signs a template believing a model reviewed it.
 *
 * The template path is the one exercised in full here: it is what a tenant with
 * no AI vendor actually gets, and it has to be signable after editing.
 */

const drafter = require("../../src/modules/hr/hr_contract/hr_contract.draft");
const llm = require("../../src/services/ai/llm.service");
const { addMonths } = require("../../src/modules/hr/hr_contract/hr_contract.service");

const FULL = {
  kind: "EMPLOYMENT",
  employee_name: "Ada Mbarga",
  job_title: "Customs Clearance Officer",
  department: "Operations",
  entity_name: "Praxis Logistics SARL",
  entity_country: "CM",
  effective_on: "2026-09-01",
  gross_salary: 450000,
  salary_currency: "XAF",
  probation_months: 3,
  notice_days: 30,
  working_hours: "08:00–17:00, Monday to Friday",
  place_of_work: "Douala",
  sop_titles: ["Staff Handbook", "Code of Conduct"],
};

describe("the template draft", () => {
  it("states every term it was given, verbatim", () => {
    const body = drafter.templateDraft(drafter.terms(FULL));

    expect(body).toContain("Ada Mbarga");
    expect(body).toContain("Praxis Logistics SARL");
    expect(body).toContain("Customs Clearance Officer");
    expect(body).toContain("2026-09-01");
    // The figure exactly as agreed — not rounded, not reformatted into words.
    expect(body).toContain("450000 XAF");
    expect(body).toContain("3 month(s)");
    expect(body).toContain("30 days");
    expect(body).toContain("Staff Handbook; Code of Conduct");
  });

  it("omits the clause entirely when the fact is missing", () => {
    // The failure this prevents: a salary clause reading "the Employee's gross
    // monthly salary is null XAF", or worse, a plausible number.
    const body = drafter.templateDraft(
      drafter.terms({ employee_name: "Bo Nkemi", entity_name: "Praxis Logistics SARL" }),
    );

    expect(body).not.toMatch(/salary/i);
    expect(body).not.toMatch(/probation/i);
    expect(body).not.toMatch(/hours/i);
    expect(body).not.toMatch(/null|undefined|\[|TBD/i);
    // …but the clauses whose facts ARE known still appear.
    expect(body).toContain("Bo Nkemi");
    expect(body).toMatch(/## Notice/);
  });

  it("says the term is indefinite rather than leaving it unstated", () => {
    const open = drafter.templateDraft(drafter.terms(FULL));
    expect(open).toMatch(/indefinite period/);

    const fixed = drafter.templateDraft(drafter.terms({ ...FULL, end_on: "2027-08-31" }));
    expect(fixed).toContain("2027-08-31");
    expect(fixed).not.toMatch(/indefinite/);
  });

  it("falls back to the statutory notice period when none was agreed", () => {
    const body = drafter.templateDraft(drafter.terms({ ...FULL, notice_days: undefined }));
    expect(body).toContain(`${drafter.DEFAULT_NOTICE_DAYS} days`);
  });
});

describe("tidying what a model returns", () => {
  it("strips a fence, a title and a signature block", () => {
    // All three are supplied by the letterhead template. Left in, the document
    // carries the company name twice and two places to sign — the sort of thing
    // nobody notices until it is printed.
    const raw = [
      "```markdown",
      "# Employment Contract",
      "",
      "## Parties",
      "",
      "This agreement is made between A and B.",
      "",
      "## Signatures",
      "",
      "_______________  Employee",
      "```",
    ].join("\n");

    const out = drafter.tidy(raw);
    expect(out).not.toMatch(/```/);
    expect(out).not.toMatch(/^# /m);
    expect(out).not.toMatch(/Signatures/);
    expect(out).toContain("## Parties");
  });

  it("keeps a body that needs no tidying", () => {
    const body = "## Parties\n\nThis agreement is made between A and B.";
    expect(drafter.tidy(body)).toBe(body);
  });

  it("returns null for nothing", () => {
    expect(drafter.tidy("")).toBeNull();
    expect(drafter.tidy(null)).toBeNull();
  });
});

describe("drafting", () => {
  afterEach(() => jest.restoreAllMocks());

  it("uses the model's text when it wrote a contract", async () => {
    const body = `## Parties\n\n${"This agreement is made between the parties named above. ".repeat(12)}`;
    jest.spyOn(llm, "chat").mockResolvedValue({ text: body, provider: "deepseek" });

    const out = await drafter.draft({}, FULL);

    expect(out.ai_generated).toBe(true);
    expect(out.ai_model).toBe("deepseek");
    expect(out.body_md).toContain("## Parties");
  });

  it("falls back to the template when the model fails, and says so", async () => {
    jest.spyOn(llm, "chat").mockRejectedValue(new Error("no vendor configured"));

    const out = await drafter.draft({}, FULL);

    // Never throws: an HR manager with no AI vendor must still get a document.
    expect(out.ai_generated).toBe(false);
    expect(out.ai_model).toBe("template");
    // And it is a real contract, not a stub.
    expect(out.body_md).toContain("450000 XAF");
    expect(out.body_md).toMatch(/## Notice/);
  });

  it("falls back when the model returns something too short to be a contract", async () => {
    // Handing somebody three lines that LOOK finished is worse than a template.
    jest.spyOn(llm, "chat").mockResolvedValue({ text: "## Parties\n\nSee attached.", provider: "gemini" });

    const out = await drafter.draft({}, FULL);
    expect(out.ai_generated).toBe(false);
    expect(out.ai_model).toBe("template");
  });

  it("tells the model the terms are agreed and must not be altered", async () => {
    let captured = null;
    jest.spyOn(llm, "chat").mockImplementation(async ({ messages }) => {
      captured = messages;
      return { text: "x".repeat(300), provider: "deepseek" };
    });

    await drafter.draft({}, FULL);

    const system = captured.find((m) => m.role === "system").content;
    expect(system).toMatch(/Reproduce them EXACTLY/);
    expect(system).toMatch(/never introduce a term that was not given/i);
    // The facts reach the model as facts, not as suggestions.
    const user = captured.find((m) => m.role === "user").content;
    expect(user).toContain("450000 XAF");
    expect(user).toContain("2026-09-01");
    expect(user).toContain("Staff Handbook");
  });

  it("keeps the temperature low — a contract is not a place for invention", async () => {
    let opts = null;
    jest.spyOn(llm, "chat").mockImplementation(async (o) => {
      opts = o;
      return { text: "x".repeat(300), provider: "deepseek" };
    });
    await drafter.draft({}, FULL);
    expect(opts.temperature).toBeLessThanOrEqual(0.3);
  });
});

describe("the clauses that reach the PDF", () => {
  const { contractArticles } = require("../../src/modules/documents/template/template.service");

  it("turns the drafted body into the articles the renderer wants", () => {
    // THE BUG THIS CLOSES. The EMPLOYMENT_CONTRACT data builder said
    // `articles: []`, so every contract this system generated rendered a
    // letterhead, both parties, a signature block — and NOT ONE CLAUSE. A blank
    // form that looks entirely correct until somebody reads it.
    const body = drafter.templateDraft(drafter.terms(FULL));
    const arts = contractArticles(body);

    expect(arts.length).toBeGreaterThan(3);
    expect(arts.map((a) => a.title)).toEqual(expect.arrayContaining(["Parties", "Term", "Notice"]));
    // The terms survive the split — this is what actually lands on the page.
    expect(arts.map((a) => a.body).join("\n")).toContain("450000 XAF");
  });

  it("keeps text written above the first heading", () => {
    // A human editing the body is entitled to write a sentence at the top
    // without it silently vanishing from the printed contract.
    const arts = contractArticles("This agreement is entered into freely.\n\n## Parties\n\nA and B.");
    expect(arts[0]).toEqual({ title: "", body: "This agreement is entered into freely." });
    expect(arts[1].title).toBe("Parties");
  });

  it("is empty for an undrafted contract rather than one blank article", () => {
    expect(contractArticles(null)).toEqual([]);
    expect(contractArticles("   ")).toEqual([]);
  });
});

describe("when probation ends", () => {
  it("counts whole months from the start date", () => {
    expect(addMonths("2026-09-01", 3)).toBe("2026-12-01");
    expect(addMonths("2026-08-16", 6)).toBe("2027-02-16");
  });

  it("clamps to the end of a shorter month", () => {
    // 31 January + 1 month is 28 February, not 3 March — which is what a naive
    // date roll produces, and it would put the probation deadline after the
    // date the employer actually had to act by.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
  });

  it("returns null when there is nothing to count from", () => {
    expect(addMonths(null, 3)).toBeNull();
    expect(addMonths("2026-09-01", 0)).toBeNull();
    expect(addMonths("not-a-date", 3)).toBeNull();
  });
});
