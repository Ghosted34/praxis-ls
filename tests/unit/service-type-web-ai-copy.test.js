/**
 * The assistant that drafts a service page.
 *
 * The test that matters is the preservation guarantee. `structure` promises the
 * author's sentences come back byte for byte, and the only reason that promise
 * is keepable is that the model is never handed the prose — it returns heading
 * POSITIONS and `assembleStructured` copies the author's own paragraphs between
 * them. If someone later "simplifies" this by asking the model for the whole
 * document back, these fail, which is the point.
 */
"use strict";

const ai = require("../../src/modules/operations/service_type_web/service_type_web.ai_copy");

const PARAS = [
  "When a shipment is urgent, valuable or moving across borders, arranging a flight is only one part of the logistics.",
  "A successful international air shipment begins long before cargo reaches an airport.",
  "International air freight requires accurate documentation and compliance with applicable export requirements.",
  "When the aircraft arrives, the shipment still has important stages to complete.",
];

describe("assembleStructured — the preservation guarantee", () => {
  test("inserts headings without altering a single paragraph", () => {
    const out = ai.assembleStructured(PARAS, [
      { start_paragraph: 1, title: "From Origin Pickup to Airport" },
      { start_paragraph: 3, title: "Destination and Final Delivery" },
    ]);
    expect(out).toContain("## From Origin Pickup to Airport");
    expect(out).toContain("## Destination and Final Delivery");
    // Every original paragraph survives verbatim.
    for (const p of PARAS) expect(out).toContain(p);
    // And nothing else is prose: strip the headings and the body is the input.
    const back = out
      .split(/\n\s*\n/)
      .filter((b) => !/^##\s/.test(b.trim()))
      .map((b) => b.trim());
    expect(back).toEqual(PARAS);
  });

  test("a heading the model invented for a paragraph that does not exist is dropped", () => {
    const out = ai.assembleStructured(PARAS, [
      { start_paragraph: 99, title: "Nowhere" },
      { start_paragraph: -1, title: "Before the start" },
      { start_paragraph: 1, title: "Real" },
    ]);
    expect(out).not.toContain("Nowhere");
    expect(out).not.toContain("Before the start");
    expect(out).toContain("## Real");
  });

  test("two headings claiming the same paragraph keep the first, not both", () => {
    const out = ai.assembleStructured(PARAS, [
      { start_paragraph: 2, title: "First" },
      { start_paragraph: 2, title: "Second" },
    ]);
    expect(out).toContain("## First");
    expect(out).not.toContain("## Second");
  });

  test("markdown smuggled into a title is reduced to a plain heading", () => {
    const out = ai.assembleStructured(PARAS, [
      { start_paragraph: 1, title: "### Sneaky" },
    ]);
    expect(out).toContain("## Sneaky");
    expect(out).not.toContain("### Sneaky");
  });

  test("no sections at all returns the prose unchanged", () => {
    expect(ai.assembleStructured(PARAS, [])).toBe(PARAS.join("\n\n"));
    expect(ai.assembleStructured(PARAS, undefined)).toBe(PARAS.join("\n\n"));
  });
});

describe("stripStructure — re-running does not stack headings", () => {
  test("drops headings a previous run added, keeping the prose", () => {
    const structured = "## One\n\nBody one.\n\n## Two\n\nBody two.";
    expect(ai.stripStructure(structured)).toBe("Body one.\n\nBody two.");
  });
});

describe("clip", () => {
  test("cuts on a word boundary so a review panel never shows a severed word", () => {
    const out = ai.clip("international air freight coordination", 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out).toBe("international air");
  });

  test("leaves anything already short enough exactly alone", () => {
    expect(ai.clip("Short enough", 100)).toBe("Short enough");
  });
});

describe("parseJson", () => {
  test("reads a fenced block", () => {
    expect(ai.parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  test("reads an object a model wrapped in a sentence", () => {
    expect(ai.parseJson('Here you go: {"a":1} hope that helps')).toEqual({ a: 1 });
  });
  test("returns null rather than throwing on nonsense", () => {
    expect(ai.parseJson("not json at all")).toBeNull();
  });
});

describe("request schema", () => {
  test("a licence is required when working from existing copy", () => {
    expect(ai.schema.safeParse({ source: "existing" }).success).toBe(false);
    expect(ai.schema.safeParse({ source: "existing", licence: "structure" }).success).toBe(true);
  });

  test("drafting from scratch needs no licence — there is no prose to protect", () => {
    expect(ai.schema.safeParse({ source: "scratch" }).success).toBe(true);
  });

  test("tone defaults put operations and search first, marketing light", () => {
    const { data } = ai.schema.safeParse({ source: "scratch" });
    expect(data.tone).toEqual({
      operational: "strong",
      commercial: "light",
      seo: "strong",
      corridor: "light",
      plain: "strong",
    });
  });

  test("an unknown tone axis is refused rather than silently ignored", () => {
    const out = ai.schema.safeParse({
      source: "scratch",
      tone: { operational: "strong", vibes: "strong" },
    });
    expect(out.success).toBe(false);
  });

  test("the five axes are the ones the prompt can actually carry", () => {
    expect(Object.keys(ai.TONE_AXES)).toEqual([
      "operational",
      "commercial",
      "seo",
      "corridor",
      "plain",
    ]);
  });
});

/**
 * "One language did not come back."
 *
 * Reported from the live wizard: Extend one to the other, English → French,
 * structure-only. English came back with seven fields; French silently did not,
 * and the review warned about it without saying why.
 *
 * The cause was a guard, not the model. The French job carries `fromBody` (the
 * English source) and no `body` of its own — that is what "extend" MEANS — but
 * it still entered the structure branch, which reads `body`, found zero
 * paragraphs and returned before ever calling the model. The structure licence
 * exists to preserve prose the author wrote; the extend target has none.
 */
describe("extend one language to the other", () => {
  const llm = require("../../src/services/ai/llm.service");
  const governance = require("../../src/modules/ai/governance/governance.service");
  const ai2 = require("../../src/modules/operations/service_type_web/service_type_web.ai_copy");

  const PROFILE = {
    long_description_en: "First English paragraph.\n\nSecond English paragraph.",
    long_description_fr: "",
  };
  const SERVICE = { name_en: "End to End Sea Freight", name_fr: "Fret maritime" };

  let prompts;
  beforeEach(() => {
    prompts = [];
    jest.spyOn(governance, "canUseFeature").mockResolvedValue({ allowed: true });
    jest.spyOn(governance, "recordUsage").mockResolvedValue(undefined);
    jest.spyOn(llm, "chat").mockImplementation(async ({ messages }) => {
      prompts.push(messages[0].content);
      const french = /in French/.test(messages[0].content);
      // The structure prompt wants positions; the prose prompt wants a body.
      if (/start_paragraph/.test(messages[0].content)) {
        return {
          provider: "test",
          text: JSON.stringify({
            sections: [{ start_paragraph: 1, title: "Second section" }],
            short_description: "EN teaser",
            highlights: ["One", "Two"],
          }),
        };
      }
      return {
        provider: "test",
        text: JSON.stringify({
          long_description: french ? "## Section française\n\nTexte français." : "Rewritten.",
          short_description: french ? "Accroche FR" : "EN teaser",
          highlights: french ? ["Un", "Deux"] : ["One", "Two"],
        }),
      };
    });
  });
  afterEach(() => jest.restoreAllMocks());

  test("French is actually drafted, not silently dropped", async () => {
    const out = await ai2.draft({}, {
      profile: PROFILE,
      serviceType: SERVICE,
      input: {
        source: "existing",
        licence: "structure",
        language_mode: "extend",
        primary: "en",
      },
    });

    expect(out.manual_required).toBe(false);
    // Both languages present, both reported ok.
    expect(out.languages).toEqual([
      { lang: "en", ok: true, mode: "structured" },
      { lang: "fr", ok: true, mode: "written" },
    ]);
    expect(out.proposal.long_description_fr).toContain("Texte français");
    expect(out.proposal.short_description_fr).toBe("Accroche FR");
    // Two model calls, not one.
    expect(prompts).toHaveLength(2);
  });

  test("the English side still keeps its wording word for word", async () => {
    const out = await ai2.draft({}, {
      profile: PROFILE,
      serviceType: SERVICE,
      input: {
        source: "existing", licence: "structure",
        language_mode: "extend", primary: "en",
      },
    });
    // Headings inserted around the author's untouched paragraphs.
    expect(out.proposal.long_description_en).toBe(
      "First English paragraph.\n\n## Second section\n\nSecond English paragraph.",
    );
    // Writing the French did not turn this into "we rewrote your page": the
    // French had nothing of the author's to preserve.
    expect(out.prose_preserved).toBe(true);
  });

  test("a language the author never wrote is skipped, not warned about", async () => {
    const out = await ai2.draft({}, {
      profile: { long_description_en: "Only English here.", long_description_fr: "" },
      serviceType: SERVICE,
      input: { source: "existing", licence: "structure", language_mode: "each" },
    });
    // Only EN was drafted, and nothing claims a failure.
    expect(out.languages).toEqual([{ lang: "en", ok: true, mode: "structured" }]);
    expect(out.languages.some((l) => !l.ok)).toBe(false);
  });
});

/**
 * FAQ pairing.
 *
 * `replaceFaq` requires all four fields on every row, so a row exists only
 * where BOTH languages came back. Pairing by position is sound because each
 * language is asked for the same questions in the same order; truncating to
 * the shorter side is what stops a half-filled row reaching Save and being
 * refused there.
 */
describe("FAQ generation", () => {
  const llm = require("../../src/services/ai/llm.service");
  const governance = require("../../src/modules/ai/governance/governance.service");
  const ai3 = require("../../src/modules/operations/service_type_web/service_type_web.ai_copy");

  function mockBoth({ en, fr }) {
    jest.spyOn(governance, "canUseFeature").mockResolvedValue({ allowed: true });
    jest.spyOn(governance, "recordUsage").mockResolvedValue(undefined);
    jest.spyOn(llm, "chat").mockImplementation(async ({ messages }) => ({
      provider: "test",
      text: JSON.stringify({
        long_description: "## H\n\nBody.",
        short_description: "teaser",
        faq: /in French/.test(messages[0].content) ? fr : en,
      }),
    }));
  }
  afterEach(() => jest.restoreAllMocks());

  test("pairs the two languages into rows the FAQ endpoint accepts", async () => {
    mockBoth({
      en: [
        { question: "What is included?", answer: "Everything to the door." },
        { question: "How long does it take?", answer: "It depends on the lane." },
      ],
      fr: [
        { question: "Que comprend le service ?", answer: "Tout jusqu'à la porte." },
        { question: "Quels sont les délais ?", answer: "Cela dépend de la ligne." },
      ],
    });
    const out = await ai3.draft({}, {
      profile: {}, serviceType: { name_en: "Sea Freight" },
      input: { source: "scratch" },
    });
    expect(out.faq).toHaveLength(2);
    expect(out.faq[0]).toEqual({
      question_en: "What is included?",
      question_fr: "Que comprend le service ?",
      answer_en: "Everything to the door.",
      answer_fr: "Tout jusqu'à la porte.",
      sort_order: 0,
    });
    // Every row carries all four fields — the server's own requirement.
    for (const r of out.faq) {
      for (const k of ["question_en", "question_fr", "answer_en", "answer_fr"]) {
        expect(String(r[k]).length).toBeGreaterThan(0);
      }
    }
  });

  test("an unmatched question is dropped rather than shipped half-empty", async () => {
    mockBoth({
      en: [
        { question: "One?", answer: "Yes." },
        { question: "Two?", answer: "Also yes." },
      ],
      fr: [{ question: "Un ?", answer: "Oui." }],
    });
    const out = await ai3.draft({}, {
      profile: {}, serviceType: { name_en: "Sea Freight" },
      input: { source: "scratch" },
    });
    expect(out.faq).toHaveLength(1);
    expect(out.faq_unavailable).toBeUndefined();
  });

  test("one language only means no FAQ, and says why", async () => {
    jest.spyOn(governance, "canUseFeature").mockResolvedValue({ allowed: true });
    jest.spyOn(governance, "recordUsage").mockResolvedValue(undefined);
    jest.spyOn(llm, "chat").mockResolvedValue({
      provider: "test",
      text: JSON.stringify({
        long_description: "Body.",
        faq: [{ question: "Only English?", answer: "Yes." }],
      }),
    });
    const out = await ai3.draft({}, {
      profile: { long_description_en: "Some English.", long_description_fr: "" },
      serviceType: { name_en: "Sea Freight" },
      input: { source: "existing", licence: "rewrite", language_mode: "each" },
    });
    expect(out.faq).toEqual([]);
    // Named, rather than a section that silently is not there.
    expect(out.faq_unavailable).toBe("single_language");
  });
});
