/**
 * THE DEEP-LINK CONTRACT: exact field, or no link at all.
 *
 * The rule these pin was a product decision, stated plainly: "If you can't take
 * me to the particular field and tab do not take me anywhere." The code that
 * preceded it did the opposite — an unresolvable route degraded to its list
 * page, so "your website is missing" landed on a list of every entity, which
 * cannot even say which one the signature was printed from.
 *
 * The reason it degraded rather than refused was that nothing carried the ids a
 * precise route needs. Three of these tests are really about that: the model now
 * carries the entity, the employee and the address row it rendered from, and the
 * gap list turns them into a URL that opens a modal on a field.
 */
"use strict";

const { gaps, href, SOURCES } = require("../../src/modules/mail/signature/signature.gaps");

/** A model with every id resolvable and every field blank. */
const full = (over = {}) => ({
  entity_id: "ent-1",
  entity_source: "employee",
  template_id: "tpl-1",
  person: { employee_id: "emp-1" },
  contact: {},
  company: { address_id: "addr-1" },
  ...over,
});

const ALL = { hr: true, entity: true, brand: true, template: true };
const find = (model, key, can = ALL) => gaps(model, can).find((g) => g.key === key);

describe("a link lands on the control or is not offered", () => {
  test("website opens the entity's own form, not the list", () => {
    const g = find(full(), "website");
    expect(g.href).toBe(
      "/master/corporate-entities?edit=entity&row=ent-1&field=website",
    );
    expect(g.precise).toBe(true);
  });

  test("a missing job title opens THAT person's record", () => {
    const g = find(full(), "job_title");
    // focus= selects the person in the list, edit= opens their dialog,
    // field= puts the caret in the input. All three, or it is not a link.
    expect(g.href).toBe(
      "/hr/employees?focus=emp-1&edit=employee&field=job_title",
    );
  });

  test("a P.O. Box opens the address row it was read from", () => {
    const g = find(full(), "po_box");
    expect(g.href).toContain("/master/corporate-entities/ent-1");
    expect(g.href).toContain("edit=addresses");
    expect(g.href).toContain("row=addr-1");
    expect(g.href).toContain("field=po_box");
  });

  test("no address row yet means create one, not give up", () => {
    const g = find(full({ company: { address_id: null } }), "address_line");
    expect(g.href).toContain("row=new");
  });

  /** The rule, stated as a test. */
  test("an id we do not have yields NO link and a written path", () => {
    const g = find(full({ entity_id: null }), "website");
    expect(g.href).toBeNull();
    expect(g.precise).toBe(false);
    // The reader is not left with nothing: they get the location in words.
    expect(g.where).toBe(
      "Master data → Corporate entities → your entity → Edit",
    );
  });

  test("no employee record means no HR link, however good the grants", () => {
    const g = find(full({ person: {} }), "job_title");
    expect(g.href).toBeNull();
    expect(g.where).toContain("HR");
  });

  /**
   * A motto has no "create a template" destination — the motto is authored ON
   * the active template — so an unresolved template is no link rather than
   * `row=new`, which would open a dialog for the wrong thing entirely.
   */
  test("a motto never degrades to creating a template", () => {
    expect(find(full({ template_id: null }), "motto").href).toBeNull();
    expect(find(full(), "motto").href).toContain("row=tpl-1");
  });

  test("every source can say where it lives, linkable or not", () => {
    for (const [key, src] of Object.entries(SOURCES)) {
      expect({ key, where: typeof src.where }).toEqual({ key, where: "string" });
    }
  });
});

describe("which company the card is speaking for", () => {
  /**
   * There is no "primary entity" column on `corporate_entity`, and a signature
   * should not want one: it carries the address of the entity that EMPLOYS the
   * sender. When the staff record names none, the resolver falls back to the
   * oldest active entity — right by luck on a single-entity tenant, and on a
   * group it prints the flagship's address on a subsidiary's mail.
   *
   * Silently. So it is reported.
   */
  test("a fallback entity is reported as a gap of its own", () => {
    const g = find(
      full({ entity_source: "fallback", company: { legal_name: "Someone Else Ltd" } }),
      "entity_link",
    );
    expect(g).toBeDefined();
    expect(g.href).toContain("field=entity_id");
  });

  test("the sender's own entity is not a gap", () => {
    const model = full({
      entity_source: "employee",
      company: { legal_name: "JBS Praxis" },
    });
    expect(find(model, "entity_link")).toBeUndefined();
  });

  test("a SYSTEM block has no person, so no entity to mis-attribute", () => {
    const model = full({
      system: true,
      entity_source: "fallback",
      company: { legal_name: "JBS Praxis" },
    });
    expect(find(model, "entity_link")).toBeUndefined();
  });
});

describe("a gap the caller cannot act on", () => {
  test("carries no link even when every id resolves", () => {
    const g = find(full(), "website", { hr: true }); // no `entity` grant
    expect(g.actionable).toBe(false);
    expect(g.href).toBeNull();
    // Still says where it is — the reader may be asking someone else to do it.
    expect(g.where).toContain("Corporate entities");
  });

  test("a personal field is always the caller's to fix", () => {
    expect(find(full(), "phone_desk", {}).href).toBe(
      "/comms/signatures?field=phone_desk",
    );
  });
});

describe("href is total", () => {
  test("never returns a route with an unsubstituted parameter", () => {
    for (const src of Object.values(SOURCES)) {
      for (const ids of [{}, { entityId: "e" }, { employeeId: "p" }, { entityId: "e", employeeId: "p", templateId: "t" }]) {
        const link = href(src, ids);
        if (link !== null) expect(link).not.toContain(":");
      }
    }
  });
});
