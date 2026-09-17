"use strict";
/**
 * A person can hold several roles (13850) — the rules that had to change.
 *
 * THE CASE. An owner holds 100% of the shares and acts as the managing director.
 * Before this, `entity_person.role` was a single value, so the same human was
 * two rows or one wrong one — and every reader that asked "is this person a
 * shareholder" or "does this entity have a director" got its answer from that
 * one column. Three readers ask it:
 *
 *   1. `reconcileCapTable` — who counts toward the percentages and the totals;
 *   2. `readiness` — whether the entity has a director or legal representative,
 *      which gates the letterhead's statutory completeness;
 *   3. the dossier's two tables, which split the same rows by role.
 *
 * A second row per role would satisfy (3) by accident and (1)/(2) by luck: two
 * rows are two people to every query that does not know to join them by name.
 * The union is asserted here so all three answer the same way, and the schema is
 * asserted so a bad value is a 422 rather than a CHECK violation surfacing as a
 * 500.
 */
// Exactly how the module reads it in production: the aggregate object off the
// package root, so a key that never made it into `index.js` fails here too.
const { entityCommon } = require("../../packages/shared");
const { personRoles } = require("../../packages/shared/schemas/entity-common");
const rules = require("../../src/modules/master/corporate_entity/corporate_entity.rules");

describe("personRoles — the union of role and role_tags", () => {
  it("returns the primary role when there are no tags", () => {
    expect(personRoles({ role: "DIRECTOR" })).toEqual(["DIRECTOR"]);
    // A row read before 13850 shipped has no key at all.
    expect(personRoles({ role: "SHAREHOLDER", role_tags: null })).toEqual([
      "SHAREHOLDER",
    ]);
    expect(personRoles(undefined)).toEqual([]);
  });

  it("puts the primary role first and de-duplicates the tags", () => {
    expect(
      personRoles({ role: "SHAREHOLDER", role_tags: ["DIRECTOR", "SHAREHOLDER"] }),
    ).toEqual(["SHAREHOLDER", "DIRECTOR"]);
  });

  it("is the same function the shared schema exports", () => {
    expect(entityCommon.personRoles).toBe(personRoles);
  });
});

describe("the person schema accepts role_tags", () => {
  const base = { role: "SHAREHOLDER", full_name: "Massomba Timothee" };

  it("accepts the other roles, and an empty list", () => {
    const ok = entityCommon.personCreate.safeParse({
      ...base,
      role_tags: ["DIRECTOR"],
    });
    expect(ok.success).toBe(true);
    expect(ok.data.role_tags).toEqual(["DIRECTOR"]);

    const cleared = entityCommon.personCreate.safeParse({
      ...base,
      role_tags: [],
    });
    expect(cleared.success).toBe(true);
  });

  it("rejects a role the CHECK constraint would reject", () => {
    const bad = entityCommon.personCreate.safeParse({
      ...base,
      role_tags: ["WIZARD"],
    });
    expect(bad.success).toBe(false);
    expect(bad.error.flatten().fieldErrors.role_tags).toBeDefined();
  });

  it("rejects null rather than letting Postgres raise 23502", () => {
    // The column is NOT NULL DEFAULT '{}'; clearing is `[]`. A null that got
    // through would be a 500 from a constraint the operator cannot see.
    const bad = entityCommon.personCreate.safeParse({ ...base, role_tags: null });
    expect(bad.success).toBe(false);
  });

  it("carries the new key in the shape the client-form gate reads", () => {
    expect(entityCommon.nestedShapeKeys.people).toContain("role_tags");
  });
});

describe("the cap table counts a shareholder by any of their roles", () => {
  const entity = { share_capital: 1_000_000 };

  it("includes an owner whose row is filed under their executive role", () => {
    const cap = rules.reconcileCapTable(
      [
        {
          role: "DIRECTOR",
          role_tags: ["SHAREHOLDER"],
          full_name: "Massomba Timothee",
          share_count: 1000,
          share_nominal_value: 1000,
          ownership_percent: 100,
        },
      ],
      entity,
    );
    expect(cap.holder_count).toBe(1);
    expect(cap.total_percent).toBe(100);
    expect(cap.total_shares).toBe(1000);
    // 1000 × 1000 = the recorded share capital, so nothing is flagged.
    expect(cap.findings).toEqual([]);
  });

  it("still excludes a row that holds neither", () => {
    const cap = rules.reconcileCapTable(
      [{ role: "SECRETARY", role_tags: ["OFFICER"], full_name: "Not an owner" }],
      entity,
    );
    expect(cap.holder_count).toBe(0);
  });

  it("counts the same person once when the primary role is the shareholder one", () => {
    const cap = rules.reconcileCapTable(
      [
        {
          role: "SHAREHOLDER",
          role_tags: ["SHAREHOLDER", "DIRECTOR"],
          full_name: "Massomba Timothee",
          ownership_percent: 100,
        },
      ],
      entity,
    );
    expect(cap.holder_count).toBe(1);
    expect(cap.total_percent).toBe(100);
  });
});

describe("readiness accepts a director recorded as an extra role", () => {
  const entity = {
    legal_name: "Smart Logistics & Services Ltd",
    legal_form: "SARL",
    incorporation_date: "2021-09-21",
    share_capital: 10_000_000,
    email: "info@slas.cm",
  };
  const children = {
    registrations: [{ registration_id: "r1" }],
    addresses: [{ type: "REGISTERED" }],
  };

  it("is satisfied by the owner who is also the director", () => {
    const r = rules.readiness(entity, {
      ...children,
      people: [
        {
          role: "SHAREHOLDER",
          role_tags: ["DIRECTOR"],
          full_name: "Massomba Timothee",
        },
      ],
    });
    expect(r.missing).toEqual([]);
    expect(r.ready).toBe(true);
  });

  it("still reports the gap when nobody is a director", () => {
    const r = rules.readiness(entity, {
      ...children,
      people: [{ role: "SHAREHOLDER", full_name: "Only an owner" }],
    });
    expect(r.missing.map((m) => m.field)).toContain("people");
  });
});
