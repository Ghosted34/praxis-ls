/**
 * PHONE PRECEDENCE, and the "where do I fix this?" links.
 *
 * Two things here are easy to get subtly wrong and hard to notice:
 *
 *   1. The phone override. `12759` gave `employee` phone columns, and the
 *      profile keeps its own as an override. Reading them in the wrong order
 *      silently rewrites the signature of everyone who typed a number before
 *      the columns existed — a change nobody asked for and nobody is told about.
 *   2. The gap links. A link offered to someone without the grant lands them on
 *      a 403, which reads as the product being broken rather than as "this is
 *      not yours to fix".
 */
"use strict";

const { resolve } = require("../../src/modules/mail/signature/signature.resolve");
const { gaps, href, SOURCES } = require("../../src/modules/mail/signature/signature.gaps");

const ALL = { hr: true, entity: true, brand: true, template: true };

function model(overrides = {}) {
  return resolve({
    entity: { entity_id: "e-1", legal_name: "Smart LS" },
    template: { layout: { kind: "card" }, copy_en: { motto: "M" } },
    ...overrides,
  }, "en");
}

describe("phone precedence (Q14, resolved by 12759)", () => {
  test("the staff record supplies the number when nothing is overridden", () => {
    const m = model({
      employee: { full_name: "A", phone_desk: "HR-DESK", phone_mobile: "HR-MOB" },
      profile: {},
    });
    expect(m.contact.phone_desk).toBe("HR-DESK");
    expect(m.contact.phone_mobile).toBe("HR-MOB");
  });

  /**
   * The direction that matters. A person whose desk line is the switchboard and
   * whose signature should show their direct line has no other way to say so,
   * so a value they typed must not be replaced the moment HR fills one in.
   */
  test("a profile value overrides the staff record", () => {
    const m = model({
      employee: { full_name: "A", phone_desk: "SWITCHBOARD" },
      profile: { phone_desk: "DIRECT-LINE" },
    });
    expect(m.contact.phone_desk).toBe("DIRECT-LINE");
  });

  test("a blank override is not an override", () => {
    const m = model({
      employee: { full_name: "A", phone_desk: "HR-DESK" },
      profile: { phone_desk: "" },
    });
    expect(m.contact.phone_desk).toBe("HR-DESK");
  });

  test("each number resolves independently", () => {
    const m = model({
      employee: { full_name: "A", phone_desk: "HR-DESK", phone_mobile: "HR-MOB" },
      profile: { phone_mobile: "MY-MOB" },
    });
    expect(m.contact.phone_desk).toBe("HR-DESK");
    expect(m.contact.phone_mobile).toBe("MY-MOB");
  });

  test("a SYSTEM block still carries no personal number", () => {
    const m = model({
      system: true,
      employee: { phone_desk: "HR-DESK", phone_mobile: "HR-MOB" },
      profile: { phone_mobile: "MY-MOB" },
    });
    expect(m.contact.phone_desk).toBeNull();
    expect(m.contact.phone_mobile).toBeNull();
  });
});

describe("email — the sending mailbox wins", () => {
  /**
   * A signature that printed the HR address while the message went out from a
   * shared box would contradict the From header the recipient can see, and
   * "reply to the address in the signature" would land somewhere nobody reads.
   */
  test("the mailbox beats the staff record", () => {
    const m = model({
      employee: { full_name: "A", email: "hr@smartls.cm" },
      mailbox: { email_address: "ops@smartls.cm" },
    });
    expect(m.contact.email).toBe("ops@smartls.cm");
  });

  test("the staff record fills the line when there is no mailbox", () => {
    const m = model({ employee: { full_name: "A", email: "hr@smartls.cm" } });
    expect(m.contact.email).toBe("hr@smartls.cm");
  });
});

describe("gaps — what is missing and where to fix it", () => {
  test("a fully-populated signature reports nothing", () => {
    const m = resolve({
      employee: {
        full_name: "A", job_title: "T",
        phone_desk: "1", phone_mobile: "2", email: "a@b.cm",
      },
      entity: {
        entity_id: "e-1", legal_name: "Smart LS", street_line: "St",
        po_box: "BP 1", website: "w.cm",
      },
      template: { layout: { kind: "card" }, copy_en: { motto: "M" } },
      logo: "data:image/png;base64,AA",
    }, "en");
    expect(gaps(m, ALL)).toEqual([]);
  });

  test("a blank signature reports every field, each with an owner", () => {
    const found = gaps(model(), ALL).map((g) => g.key);
    expect(found).toEqual(expect.arrayContaining([
      "job_title", "phone_desk", "phone_mobile", "email",
      "address_line", "po_box", "website", "logo",
    ]));
    for (const g of gaps(model(), ALL)) {
      expect(g.owner).toBeTruthy();
      expect(g.label).toBeTruthy();
    }
  });

  /** Offering a link into a 403 reads as a broken product. */
  test("without the grant a company gap names who to ask instead of linking", () => {
    const g = gaps(model(), {}).find((x) => x.key === "po_box");
    expect(g.href).toBeNull();
    expect(g.actionable).toBe(false);
    expect(g.owner).toBe("an administrator");
  });

  test("with the grant the same gap links to the exact tab and field", () => {
    const g = gaps(model(), ALL).find((x) => x.key === "po_box");
    expect(g.actionable).toBe(true);
    expect(g.href).toContain("/master/corporate-entities/e-1");
    expect(g.href).toContain("tab=Contacts");
    expect(g.href).toContain("field=po_box");
  });

  /** A person can always fix their own phone, grants or not — that is what the
   *  self-service surface is for. */
  test("a personal gap is always actionable", () => {
    const g = gaps(model(), {}).find((x) => x.key === "phone_desk");
    expect(g.actionable).toBe(true);
    expect(g.href).toBe("/comms/signatures");
  });

  test("a SYSTEM block reports no missing person", () => {
    const found = gaps(model({ system: true }), ALL).map((g) => g.key);
    expect(found).not.toContain("full_name");
    expect(found).not.toContain("phone_mobile");
  });

  /**
   * A route with an unfilled `:param` is a 404, not a link. It degrades to the
   * BARE list page — with no `?tab=`/`?field=`, because those name a tab and an
   * input that exist on the dossier and not on the list, and a query string
   * pointing at neither is noise in the address bar.
   */
  test("an entity route with no entity id degrades to the bare list page", () => {
    const link = href(SOURCES.po_box, { entityId: null });
    expect(link).not.toContain(":entityId");
    expect(link).toBe("/master/corporate-entities");
  });

  test("every source declares a route, a label and an owner", () => {
    for (const [key, src] of Object.entries(SOURCES)) {
      // `key` is folded into the message so a failure names the offender —
      // jest's expect takes no second argument, unlike vitest's.
      expect({ key, route: typeof src.route }).toEqual({ key, route: "string" });
      expect({ key, absolute: src.route.startsWith("/") }).toEqual({ key, absolute: true });
      expect({ key, label: Boolean(src.label) }).toEqual({ key, label: true });
      expect({ key, owner: Boolean(src.owner) }).toEqual({ key, owner: true });
      expect(["self", "hr", "entity", "brand", "template"]).toContain(src.scope);
    }
  });
});
