/**
 * Slash commands, and the permission model that keeps them honest.
 *
 * THE PROPERTY UNDER TEST, stated once: a command can never read more than the
 * person typing it could read in the UI. The composer is a place where an
 * operator asks the system for data and pastes it into a message that leaves the
 * company, so a missing check is not a broken screen — it is a clerk who cannot
 * open Treasury putting the company's bank details into an email, with nothing
 * in the mail module looking wrong while it happens.
 *
 * The permission cases are TABLE-DRIVEN off the manifest itself, so a command
 * added later is covered the moment it is declared. That is the point: the
 * instructions in mail.commands.js tell a future engineer to add a test case,
 * and this makes the common one automatic so the instruction is about the
 * unusual part.
 */
"use strict";

jest.mock("../../src/shared/cache/identity-cache", () => ({ getGrants: jest.fn(async () => []) }));

// The modules the commands resolve through, mocked at the top rather than with
// doMock inside a test: `resolve` requires them lazily, so the first require
// wins for the rest of the file and a later doMock would silently not apply.
const mockInvoiceGet = jest.fn(async () => ({ invoice_no: "INV-1" }));
const mockDossierGet = jest.fn(async () => ({ file_ref: "SLAS-2026-0001" }));
jest.mock("../../src/modules/finance/final_invoice/final_invoice.service", () => ({ get: (...a) => mockInvoiceGet(...a) }));
jest.mock("../../src/modules/operations/operations_file/operations_file.service", () => ({ get: (...a) => mockDossierGet(...a) }));

const identityCache = require("../../src/shared/cache/identity-cache");
const commands = require("../../src/modules/mail/mail/commands.service");
const manifest = require("../../src/modules/mail/mail/mail.commands");

const GUARDED = manifest.filter((c) => c.module_key);
const OPEN = manifest.filter((c) => !c.module_key);

const USER = { user_id: "u1", role_ids: ["r1"] };
const CEO = { user_id: "ceo", role_ids: [], is_ceo: true };
const grant = (on) => identityCache.getGrants.mockResolvedValue(on ? [{ can_read: true }] : [{ can_read: false }]);

beforeEach(() => {
  jest.clearAllMocks();
  identityCache.getGrants.mockResolvedValue([]);
});

/* ── The manifest itself ──────────────────────────────────────────────────── */

describe("the manifest", () => {
  test("is well formed", () => {
    expect(commands.validateManifest()).toEqual([]);
  });

  test("declares the ten commands that were asked for", () => {
    expect(manifest.map((c) => c.key).sort()).toEqual([
      "bank", "costing", "document", "dossier", "invoice",
      "po", "proforma", "quotation", "signature", "snippet",
    ]);
  });

  test("EVERY MODULE KEY IS ONE THAT ACTUALLY EXISTS", () => {
    // A key absent from platform.module_catalogue has grants for nobody and
    // 403s every non-CEO user — and it looks like a permissions problem rather
    // than a typo. This file was written against a plan whose six suggested
    // keys were five-sixths wrong, which is why the check is here.
    const real = [
      "MOD-09", "MOD-24", "MOD-27", "MOD-29", "MOD-46",
      "MOD-50", "MOD-51", "MOD-60", "MOD-62", "MOD-64", "MOD-66", "MOD-72", "MOD-73",
    ];
    expect(commands.validateManifest(real)).toEqual([]);
  });

  test("every guarded command names both a module and a permission, never one", () => {
    for (const c of GUARDED) {
      expect(c.module_key).toMatch(/^MOD-\d+$/);
      expect(["view", "create", "edit", "delete"]).toContain(c.permission);
    }
  });

  test("the two open commands carry no data access, which is why they need none", () => {
    expect(OPEN.map((c) => c.key).sort()).toEqual(["signature", "snippet"]);
    for (const c of OPEN) expect(c.permission).toBeNull();
  });

  test("every command is bilingual", () => {
    // EN and FR only, per Q26. A command whose French label is missing shows an
    // English one to a French operator, which is worse than not offering it.
    for (const c of manifest) {
      expect(c.label_en).toBeTruthy();
      expect(c.label_fr).toBeTruthy();
      expect(c.describe_en).toBeTruthy();
      expect(c.describe_fr).toBeTruthy();
    }
  });

  test("a duplicate key is caught", () => {
    const dup = [...manifest, manifest[0]];
    jest.isolateModules(() => {
      jest.doMock("../../src/modules/mail/mail/mail.commands", () => dup);
       
      const svc = require("../../src/modules/mail/mail/commands.service");
      expect(svc.validateManifest().join(" ")).toMatch(/duplicate key/);
    });
  });
});

/* ── Permission: the table-driven part ────────────────────────────────────── */

describe.each(GUARDED.map((c) => [c.key, c.module_key]))("/%s (%s)", (key, moduleKey) => {
  test("IS REFUSED WITHOUT THE GRANT, with a 403 rather than a silent empty block", async () => {
    grant(false);
    await expect(commands.run({}, USER, key, {}, {}))
      .rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
  });

  test("asks about the module it declared, not about mail", async () => {
    grant(false);
    await commands.run({}, USER, key, {}, {}).catch(() => {});
    expect(identityCache.getGrants).toHaveBeenCalledWith({}, expect.objectContaining({ module: moduleKey }));
  });

  test("an anonymous caller is refused", async () => {
    grant(true);
    await expect(commands.run({}, {}, key, {}, {})).rejects.toMatchObject({ status: 403 });
  });

  test("is offered as unavailable, with a reason, rather than hidden", async () => {
    grant(false);
    const entry = (await commands.list({}, USER, {})).find((c) => c.key === key);
    expect(entry.available).toBe(false);
    expect(entry.unavailable_reason).toMatch(/do not have access/i);
  });

  test("is offered when the grant is held", async () => {
    grant(true);
    const entry = (await commands.list({}, USER, {})).find((c) => c.key === key);
    // /signature is declared but not built yet, so it stays unavailable even
    // with every grant — see the manifest.
    expect(entry.available).toBe(key !== "signature");
  });
});

describe("permission edges", () => {
  test("A CEO HOLDS EVERYTHING — the same rule the route gate applies", async () => {
    grant(false);
    expect(await commands.holds({}, CEO, "MOD-09", "view")).toBe(true);
  });

  test("a command with no module needs nothing beyond being signed in", async () => {
    expect(await commands.holds({}, USER, null, null)).toBe(true);
  });

  test("a grant on a DIFFERENT action does not open the command", async () => {
    // The manifest asks for `view`, which reads can_read. Holding create only
    // must not be enough.
    identityCache.getGrants.mockResolvedValue([{ can_create: true, can_read: false }]);
    expect(await commands.holds({}, USER, "MOD-09", "view")).toBe(false);
  });

  test("THE LIST IS A HINT AND run() IS THE GATE", async () => {
    // A client can call run directly whatever the menu showed it, so the check
    // has to be in both places rather than only in the one the UI uses.
    grant(true);
    const offered = await commands.list({}, USER, {});
    expect(offered.find((c) => c.key === "bank").available).toBe(true);
    grant(false);
    await expect(commands.run({}, USER, "bank", { id: "acc-1" }, {})).rejects.toMatchObject({ status: 403 });
  });

  test("an unknown command is a 404, not a crash", async () => {
    await expect(commands.run({}, USER, "nonsense", {}, {})).rejects.toMatchObject({ status: 404 });
  });

  test("a declared-but-unbuilt command refuses honestly", async () => {
    // Better than being absent: a command that silently does not exist is a
    // support ticket, and /signature is coming in the next release.
    grant(true);
    await expect(commands.run({}, USER, "signature", {}, {}))
      .rejects.toMatchObject({ code: "NOT_ENABLED", message: expect.stringMatching(/next release/i) });
  });
});

/* ── The list ─────────────────────────────────────────────────────────────── */

describe("the command menu", () => {
  test("returns every command, marked, rather than omitting the ones you cannot run", async () => {
    // Someone told about /bank by a colleague who finds nothing when they type
    // it files a bug. Someone who sees it greyed out with a reason does not.
    grant(false);
    const list = await commands.list({}, USER, {});
    expect(list).toHaveLength(manifest.length);
    expect(list.every((c) => c.key && c.label && c.description)).toBe(true);
  });

  test("speaks French when asked", async () => {
    grant(true);
    const fr = await commands.list({}, USER, { lang: "fr" });
    expect(fr.find((c) => c.key === "invoice").label).toBe("Facture");
    expect(fr.find((c) => c.key === "dossier").label).toBe("Statut du dossier");
  });

  test("falls back to English for anything else", async () => {
    grant(true);
    const de = await commands.list({}, USER, { lang: "de" });
    expect(de.find((c) => c.key === "invoice").label).toBe("Invoice");
  });

  test("says which command attaches a file rather than inserting data", async () => {
    grant(true);
    const list = await commands.list({}, USER, {});
    expect(list.filter((c) => c.attaches).map((c) => c.key)).toEqual(["document"]);
  });
});

/* ── Rendering ────────────────────────────────────────────────────────────── */

describe("what a command inserts", () => {
  const invoice = manifest.find((c) => c.key === "invoice");
  const DATA = {
    invoice_no: "INV-2026-0007", invoice_date: "2026-08-01T00:00:00Z", due_date: "2026-09-30T00:00:00Z",
    total_ttc: 1250000, balance_due: 1250000, currency: "XAF", status: "POSTED",
  };

  test("A BLOCK IS NODES, NEVER AN HTML STRING", () => {
    // The serializer refuses to emit markup from a document, because a TipTap
    // document arrives in a request body. A command that returned HTML would be
    // asking for an exception to that, and there is no exception.
    const { nodes } = invoice.render(DATA, "en");
    expect(JSON.stringify(nodes)).not.toMatch(/<[a-z]/i);
    expect(nodes[0].type).toBe("table");
  });

  test("run() wraps it in an erpBlock with the data pinned NOW", async () => {
    grant(true);
    mockInvoiceGet.mockResolvedValueOnce(DATA);
    const out = await commands.run({}, USER, "invoice", { id: "inv-1" }, {});
    expect(out.node.type).toBe("erpBlock");
    expect(out.node.attrs.command).toBe("invoice");
    expect(Date.parse(out.node.attrs.pinned_at)).toBeGreaterThan(Date.now() - 5000);
  });

  test("renders amounts the way the region writes them, with no minor unit", () => {
    // XAF has no centimes in practice; "1 250 000,00 XAF" reads as an error.
    const flat = JSON.stringify(invoice.render(DATA, "en").nodes);
    expect(flat).toMatch(/1\D250\D000 XAF/);
    expect(flat).not.toMatch(/1250000\.00/);
  });

  test("omits a row it has no value for, rather than printing a blank one", () => {
    const sparse = invoice.render({ invoice_no: "INV-1" }, "en");
    expect(sparse.nodes[0].content).toHaveLength(1);
  });

  test("labels the block in the caller's language", () => {
    expect(invoice.render(DATA, "fr").label).toMatch(/^Facture/);
    expect(invoice.render(DATA, "en").label).toMatch(/^Invoice/);
  });

  test("a snippet renders as prose with no header over it", () => {
    const snippet = manifest.find((c) => c.key === "snippet");
    const out = snippet.render({ body_en: "First para.\n\nSecond para." }, "en");
    expect(out.label).toBeNull();
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes[0].content[0].text).toBe("First para.");
  });
});

/* ── Defaulting to the conversation ───────────────────────────────────────── */

describe("defaulting to the conversation's bound entity", () => {
  test("A COMMAND WITH NO ARGUMENT USES THE THREAD'S BINDING", async () => {
    // Most of the value. An operator reading a thread already bound to a
    // dossier types /dossier and gets THIS one, rather than going to look up a
    // reference to paste into their own message.
    grant(true);
    await commands.run({}, USER, "dossier", {}, { boundEntityRef: "dossier:dos-42" });
    expect(mockDossierGet).toHaveBeenCalledWith({}, "dos-42");
  });

  test("an explicit argument beats the binding", async () => {
    grant(true);
    await commands.run({}, USER, "dossier", { id: "dos-99" }, { boundEntityRef: "dossier:dos-42" });
    expect(mockDossierGet).toHaveBeenCalledWith({}, "dos-99");
  });

  test("a binding of the WRONG KIND is ignored rather than passed as an id", async () => {
    grant(true);
    await expect(commands.run({}, USER, "dossier", {}, { boundEntityRef: "client:cli-1" }))
      .rejects.toMatchObject({ status: 422, message: expect.stringMatching(/Which shipment/i) });
  });

  test("with neither, the user is asked in their own language", async () => {
    grant(true);
    await expect(commands.run({}, USER, "invoice", {}, { lang: "fr" }))
      .rejects.toMatchObject({ status: 422, message: expect.stringMatching(/Quelle facture \?/) });
  });

  test("THE FRENCH AGREES — 'Quel facture' is wrong, and a template cannot know that", async () => {
    // French gender cannot be derived from an English noun, so each command
    // supplies both sentences written out. A product that speaks broken French
    // to a Douala customs desk has told them what it thinks of them.
    grant(true);
    const ask = async (key) => commands.run({}, USER, key, {}, { lang: "fr" })
      .then(() => null, (e) => e.message);
    expect(await ask("invoice")).toMatch(/^Quelle facture \?/);   // feminine
    expect(await ask("dossier")).toMatch(/^Quel dossier \?/);     // masculine
    expect(await ask("quotation")).toMatch(/^Quel devis \?/);
  });
});
