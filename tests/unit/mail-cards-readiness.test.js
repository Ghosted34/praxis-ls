/**
 * Action-card readiness (§7.3, §7.9 criterion 8).
 *
 * Two of the seven cards existed, both inline in `cards.js`, both requiring a
 * field or two. The rule they exist to enforce is narrow and easy to lose:
 *
 *   "MUST NOT guess a missing value, substitute a default, or open a form
 *    silently missing fields. If the thread does not say the incoterm, the card
 *    says the thread does not say the incoterm."
 *
 * And there are exactly TWO outcomes, never three: ready-and-prefilled, or
 * not-ready-and-specific. A disabled button with no explanation is the third
 * one, and it is the one users complain about because it gives them nothing to
 * act on.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const cards = require("../../src/modules/mail/binding/cards");
const { readinessFrom, CARDS, KEYS } = cards;

const CARD_DIR = path.resolve(__dirname, "../../src/modules/mail/binding/cards");

const facts = (over = {}) => ({
  thread_id: "t-1", entity_ref: "client:c-1",
  client_id: "c-1", client_name: "Camrail",
  dossier_id: null, incoterm: null, delivery_place: null,
  service_type_id: null, supplier_id: null, ...over,
});

function fakeClient(rows = []) {
  return { query: async () => ({ rows }) };
}

/* ── The seven ────────────────────────────────────────────────────────────── */

describe("no card asks for something the schema cannot supply", () => {
  test("none of them asks for a currency", () => {
    // `client_master` has no currency column: the currency of a document is
    // decided by the corporate entity and the finance module's own defaults,
    // not by the counterparty. A card that asked the operator for it would be
    // asking them to answer a question the target module answers better — and
    // `npm run db:check:columns` caught the query that assumed otherwise.
    for (const key of KEYS) {
      expect(CARDS[key].fields.map((f) => f.field)).not.toContain("currency");
    }
  });
});

describe("all seven v1 cards exist, one file each", () => {
  test("the set is exactly what §7.3 names", () => {
    expect(KEYS).toEqual([
      "client", "document_request", "dossier", "invoice",
      "proforma", "purchase_order", "quotation",
    ]);
  });

  test("each is its own file, so adding a card is a file", () => {
    const files = fs.readdirSync(CARD_DIR).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
    expect(files).toHaveLength(KEYS.length);
  });

  test("a shared helper is not mistaken for a card", () => {
    // `_facts.js` provides the fact set; a leading underscore is what keeps it
    // out of the registry.
    expect(KEYS).not.toContain("_facts");
    expect(fs.existsSync(path.join(CARD_DIR, "_facts.js"))).toBe(true);
  });

  test.each(KEYS)("%s declares a label in both languages and a target", (key) => {
    const c = CARDS[key];
    expect(c.label_en).toBeTruthy();
    expect(c.label_fr).toBeTruthy();
    expect(c.target).toMatch(/^\//);
  });

  test.each(KEYS)("%s is read-only — v1 cards never write (Q20)", (key) => {
    expect(readinessFrom(facts(), key).read_only).toBe(true);
  });
});

/* ── The missing-data rule ────────────────────────────────────────────────── */

describe("a card names what it is missing, and never guesses", () => {
  test("proforma on a thread with no incoterm says which two things", () => {
    const r = readinessFrom(facts(), "proforma");
    expect(r.ready).toBe(false);
    expect(r.missing.map((m) => m.field).sort()).toEqual(["delivery_place", "incoterm"]);
    // Not defaulted, not omitted-and-hoped-for: simply absent from the prefill.
    expect(r.prefill.incoterm).toBeUndefined();
    expect(r.prefill.delivery_place).toBeUndefined();
  });

  test("each missing field carries its OWN reason, not a generated one", () => {
    const r = readinessFrom(facts(), "proforma");
    const why = Object.fromEntries(r.missing.map((m) => [m.field, m.why]));
    // "not stated in this thread" and "the dossier has no delivery place yet"
    // send the operator to different places. A generated string says neither.
    expect(why.incoterm).toBe("not stated in this thread");
    expect(why.delivery_place).toBe("the dossier has no delivery place yet");
    expect(new Set(Object.values(why)).size).toBe(r.missing.length);
  });

  test("what IS known is prefilled", () => {
    const r = readinessFrom(facts({ incoterm: "FOB", delivery_place: "Douala" }), "proforma");
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.prefill).toEqual({
      client_id: "c-1", incoterm: "FOB", delivery_place: "Douala",
    });
    expect(r.target).toMatch(/proforma/);
  });

  test("the label is the same whether or not it is ready — never a disabled button", () => {
    const notReady = readinessFrom(facts(), "proforma");
    const ready = readinessFrom(facts({ incoterm: "FOB", delivery_place: "Douala" }), "proforma");
    expect(notReady.label_en).toBe(ready.label_en);
    expect(notReady.target).toBe(ready.target);
    // §7.3: "the button stays labelled 'Create proforma' and opens the module
    // screen prefilled once they are filled".
  });

  test("an empty string counts as missing, not as an answer", () => {
    const r = readinessFrom(facts({ incoterm: "", delivery_place: "Douala" }), "proforma");
    expect(r.missing.map((m) => m.field)).toEqual(["incoterm"]);
  });

  test("an unknown card says so rather than pretending to be ready", () => {
    const r = readinessFrom(facts(), "spaceship");
    expect(r.ready).toBe(false);
    expect(r.missing[0].why).toBe("unknown card");
  });
});

/* ── Which cards apply ────────────────────────────────────────────────────── */

describe("cards are offered only where they make sense", () => {
  test("a client thread gets the client-side cards and not the PO", async () => {
    const out = await cards.forThread(fakeClient([{
      email_thread_id: "t-1", entity_ref: "client:c-1", client_id: "c-1", participants: [],
    }]), "t-1");
    const keys = out.cards.map((c) => c.card);
    expect(keys).toContain("proforma");
    expect(keys).toContain("document_request");
    // Offering "raise a purchase order" on a customer complaint is noise.
    expect(keys).not.toContain("purchase_order");
  });

  test("a supplier thread gets the PO and none of the client cards", async () => {
    const out = await cards.forThread(fakeClient([{
      email_thread_id: "t-1", entity_ref: "supplier:s-1", supplier_id: "s-1", participants: [],
    }]), "t-1");
    expect(out.cards.map((c) => c.card)).toEqual(["purchase_order"]);
  });

  test("a thread bound to nothing gets no cards at all", async () => {
    const out = await cards.forThread(fakeClient([{
      email_thread_id: "t-1", entity_ref: null, participants: [],
    }]), "t-1");
    expect(out.cards).toEqual([]);
  });

  test("a dossier-bound thread inherits its client, so client cards still apply", async () => {
    // §7.5: "dossier-bound threads show the dossier first with its client
    // behind it" — a card bound to a file should not have to be told separately
    // who the file belongs to.
    const out = await cards.forThread(fakeClient([{
      email_thread_id: "t-1", entity_ref: "dossier:d-1",
      dossier_id: "d-1", dossier_client_id: "c-1", participants: [],
    }]), "t-1");
    expect(out.cards.map((c) => c.card)).toContain("proforma");
  });

  test("a thread that does not exist yields no cards rather than throwing", async () => {
    const out = await cards.forThread(fakeClient([]), "nope");
    expect(out.cards).toEqual([]);
  });
});

/* ── The budget ───────────────────────────────────────────────────────────── */

describe("rendering every card costs ONE query", () => {
  test("forThread issues a single statement however many cards apply", async () => {
    const calls = [];
    const c = {
      query: async (text, params) => {
        calls.push(text);
        return { rows: [{ email_thread_id: "t-1", entity_ref: "client:c-1", client_id: "c-1", participants: [] }] };
      },
    };
    const out = await cards.forThread(c, "t-1");
    expect(out.cards.length).toBeGreaterThan(3);
    // The reading pane may draw several cards, and §3.6's budget does not stop
    // applying because the drawer is not the thing on screen.
    expect(calls).toHaveLength(1);
  });
});

/* ── Nothing here writes ──────────────────────────────────────────────────── */

describe("v1 cards read (Q20)", () => {
  test("no card file contains a write", () => {
    for (const f of fs.readdirSync(CARD_DIR).filter((n) => n.endsWith(".js"))) {
      const src = fs.readFileSync(path.join(CARD_DIR, f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
    }
  });

  test("the shared fact query is a SELECT and nothing else", () => {
    const src = fs.readFileSync(path.join(CARD_DIR, "_facts.js"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).toMatch(/SELECT/);
    expect(code).not.toMatch(/\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
  });
});
