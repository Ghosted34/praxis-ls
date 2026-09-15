"use strict";
/**
 * Three defects found auditing the corporate-entity write and read paths, none
 * of which produced an error at the time they happened.
 *
 *   1. A SECOND `is_primary` row. "Primary" is read with `.find(x =>
 *      x.is_primary)` — the letterhead's address block, its identifier list,
 *      the contact a document is addressed to. Nothing demoted the previous
 *      primary, so with two rows the `find` returned whichever the list's
 *      ORDER BY put first and the letterhead printed one of two RCCM numbers
 *      with nothing to say it had chosen.
 *
 *   2. An empty string NULLING a column by accident. `blankToUndefined` maps
 *      `""` to undefined but leaves the KEY on the parsed object, and pg turns
 *      undefined into NULL — so `""` cleared a child's column while the entity
 *      master's own service treated the same input as "not filled in". One
 *      input, two opposite meanings on sibling endpoints.
 *
 *   3. `GET /entities/:id/documents` gated at MOD-01 `edit` to protect rows
 *      that `GET /entities/:id/360` handed out in full at `view`. The gate's
 *      own comment described a redaction that was never implemented.
 */
const {
  buildResource,
  entityResourceSpecs,
} = require("../../src/modules/master/_shared/nested");
const entityAi = require("../../src/modules/master/corporate_entity/corporate_entity.ai");
const {
  redactDocument,
  DOCUMENT_CONFIDENTIAL_FIELDS,
} = require("../../src/modules/master/entity-360.service");

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
  resolveActorId: jest.fn(async (_c, id) => id || null),
}));

/**
 * A pg client that answers the shapes `buildResource` needs and records every
 * statement, so the assertions are about the SQL actually issued.
 */
function fakeClient({ existing = null, returning = {} } = {}) {
  const calls = [];
  return {
    calls,
    sql: () => calls.map((c) => c.text.replace(/\s+/g, " ").trim()),
    query(text, params) {
      calls.push({ text, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(text)) return { rows: [] };
      // assertParent
      if (/SELECT 1 FROM corporate_entity/.test(text))
        return { rows: [{ "?column?": 1 }] };
      // getById (the `before` read)
      if (/^SELECT \* FROM/.test(text))
        return { rows: existing ? [existing] : [] };
      if (/^(INSERT|UPDATE)/.test(text) && /RETURNING/.test(text))
        return { rows: [returning] };
      return { rows: [] };
    },
  };
}

const specFor = (seg) => entityResourceSpecs().find((r) => r.seg === seg);

const registrations = () => {
  const r = specFor("registrations");
  return buildResource({
    table: r.table,
    pk: r.pk,
    parentCol: "entity_id",
    parentTable: "corporate_entity",
    parentPk: "entity_id",
    moduleKey: "MOD-01",
    label: r.table,
    writable: r.writable,
    touch: r.touch,
    primaryScope: r.primaryScope,
  }).service;
};

describe("only one registration is primary per country", () => {
  it("demotes the previous primary when a new one is ticked", async () => {
    const c = fakeClient({
      existing: { registration_id: "rg1", entity_id: "e1", country_code: "CM" },
      returning: {
        registration_id: "rg1",
        entity_id: "e1",
        country_code: "CM",
        is_primary: true,
      },
    });
    await registrations().update(c, {
      parentId: "e1",
      id: "rg1",
      patch: { is_primary: true },
      actor: {},
    });

    const demote = c.calls.find((x) => /SET is_primary = false/.test(x.text));
    expect(demote).toBeTruthy();
    // Scoped to the entity, to the country, and never to the row just written.
    expect(demote.text.replace(/\s+/g, " ")).toMatch(
      /"entity_id" = \$1 AND "registration_id" <> \$2 AND is_primary AND "country_code" IS NOT DISTINCT FROM \$3/,
    );
    expect(demote.params).toEqual(["e1", "rg1", "CM"]);
  });

  it("scopes by country with IS NOT DISTINCT FROM, so two rows with no country still collide", async () => {
    const c = fakeClient({
      existing: { registration_id: "rg1", entity_id: "e1" },
      returning: {
        registration_id: "rg1",
        entity_id: "e1",
        country_code: null,
        is_primary: true,
      },
    });
    await registrations().update(c, {
      parentId: "e1",
      id: "rg1",
      patch: { is_primary: true },
      actor: {},
    });
    const demote = c.calls.find((x) => /SET is_primary = false/.test(x.text));
    // `= NULL` would match nothing and leave the duplicate standing.
    expect(demote.params).toEqual(["e1", "rg1", null]);
  });

  it("demotes on create too, not only on edit", async () => {
    const c = fakeClient({
      returning: {
        registration_id: "rg2",
        entity_id: "e1",
        country_code: "CM",
        is_primary: true,
      },
    });
    await registrations().create(c, {
      parentId: "e1",
      data: { kind: "NIU", country_code: "CM", is_primary: true },
      actor: {},
    });
    expect(c.calls.some((x) => /SET is_primary = false/.test(x.text))).toBe(
      true,
    );
  });

  it("leaves other rows alone when the request says nothing about primacy", async () => {
    // Editing a primary row's phone number is not a statement about any other
    // row, and silently unticking a sibling would be its own surprise.
    const c = fakeClient({
      existing: { registration_id: "rg1", entity_id: "e1", country_code: "CM" },
      returning: {
        registration_id: "rg1",
        entity_id: "e1",
        country_code: "CM",
        is_primary: true,
      },
    });
    await registrations().update(c, {
      parentId: "e1",
      id: "rg1",
      patch: { number: "X" },
      actor: {},
    });
    expect(c.calls.some((x) => /SET is_primary = false/.test(x.text))).toBe(
      false,
    );
  });

  it("does not demote anything for a collection with no primary flag", async () => {
    expect(specFor("establishments").primaryScope).toBeUndefined();
    expect(specFor("documents").primaryScope).toBeUndefined();
  });
});

describe("an undefined value never writes a column", () => {
  it("leaves an undefined key out of the UPDATE entirely", async () => {
    const c = fakeClient({
      existing: { registration_id: "rg1", entity_id: "e1" },
      returning: { registration_id: "rg1", entity_id: "e1" },
    });
    // What a `""` parses to: the key survives, the value does not. pg would turn
    // that undefined into a NULL and quietly empty the column.
    await registrations().update(c, {
      parentId: "e1",
      id: "rg1",
      patch: { number: "RC/DLA/2021/B/2060", expires_on: undefined },
      actor: {},
    });
    const write = c.calls.find((x) =>
      /^UPDATE entity_registration/.test(x.text),
    );
    expect(write.text).toMatch(/"number" = \$/);
    expect(write.text).not.toMatch(/"expires_on"/);
  });

  it("still writes an explicit null, because that is what clearing means", async () => {
    const c = fakeClient({
      existing: { registration_id: "rg1", entity_id: "e1" },
      returning: { registration_id: "rg1", entity_id: "e1" },
    });
    await registrations().update(c, {
      parentId: "e1",
      id: "rg1",
      patch: { expires_on: null },
      actor: {},
    });
    const write = c.calls.find((x) =>
      /^UPDATE entity_registration/.test(x.text),
    );
    expect(write.text).toMatch(/"expires_on" = \$/);
    expect(write.params).toContain(null);
  });

  it("keeps undefined out of an INSERT, so column defaults still apply", async () => {
    const c = fakeClient({
      returning: { registration_id: "rg2", entity_id: "e1" },
    });
    await registrations().create(c, {
      parentId: "e1",
      data: { kind: "NIU", country_code: undefined },
      actor: {},
    });
    const write = c.calls.find((x) =>
      /^INSERT INTO entity_registration/.test(x.text),
    );
    expect(write.text).not.toMatch(/"country_code"/);
    expect(write.text).toMatch(/"kind"/);
  });
});

describe("a document row a non-governance caller may see", () => {
  const full = {
    document_id: "d1",
    document_type_name: "Attestation de non-redevance",
    title: "Tax clearance 2026",
    issued_on: "2026-01-05",
    expires_on: "2027-01-04",
    scan_status: "VERIFIED",
    is_active: true,
    document_number: "MOD-01-DOC-000041",
    issuing_authority: "Direction Générale des Impôts",
    physical_ref: "Box 12 / folder 3",
    notes: "Original with the notary.",
    rejection_reason: null,
    vault_id: "v1",
    storage_path: "tenants/smartls/entity/d1.pdf",
    vault_hash: "sha256:abc",
    content_hash: "sha256:abc",
  };

  it("keeps what the renewals list and the register need", () => {
    const out = redactDocument(full);
    // That the document exists, what it is, and when it lapses — the reason a
    // view-only user is looking at this page at all.
    expect(out.title).toBe("Tax clearance 2026");
    expect(out.document_type_name).toBe("Attestation de non-redevance");
    expect(out.expires_on).toBe("2027-01-04");
    expect(out.scan_status).toBe("VERIFIED");
    expect(out.redacted).toBe(true);
  });

  it("drops the document's identity and the route to its contents", () => {
    const out = redactDocument(full);
    for (const field of DOCUMENT_CONFIDENTIAL_FIELDS) {
      expect(Object.prototype.hasOwnProperty.call(out, field)).toBe(false);
    }
    // The one that matters most: a path to the scan itself.
    expect(JSON.stringify(out)).not.toContain("tenants/smartls");
    expect(JSON.stringify(out)).not.toContain("MOD-01-DOC-000041");
  });

  it("does not mutate the row it was given", () => {
    const copy = { ...full };
    redactDocument(full);
    expect(full).toEqual(copy);
  });
});

/**
 * The assistant must not be a looser door than the screen.
 *
 * `get_entity_360` and `get_entity_cap_table` asked the service for
 * `governance: true` — the unredacted cap table, shareholders, dates of birth
 * and identity numbers — while declaring `action: "view"`. The module header
 * said they were "registered with an edit permission" and that "the permission
 * is the gate"; neither was true, so MOD-01 `view` (what a Sales user holds to
 * see that an entity exists) answered "who are the shareholders of SLAS and
 * what are their ID numbers", and returned the cap table that
 * `GET /:id/cap-table` refuses at `view` for precisely this reason.
 */
describe("the AI reads are gated like the HTTP routes", () => {
  const readFor = (key) => entityAi.reads.find((r) => r.key === key);

  it.each(["get_entity_360", "get_entity_cap_table"])(
    "%s needs the same grant the dossier's redaction tests",
    (key) => {
      // `edit` maps to can_update in action-authz's COLUMN table, which is the
      // column canSeeGovernance reads and the one the cap-table route requires.
      expect(readFor(key).permission).toEqual({
        module: "MOD-01",
        action: "edit",
      });
    },
  );

  it("leaves the reads that carry no governance data at view", () => {
    for (const key of [
      "list_entities",
      "get_entity",
      "get_entity_renewals",
      "get_entity_letterhead",
    ]) {
      expect(readFor(key).permission.action).toBe("view");
    }
  });

  it("declares a permission on every read and write, so none can default open", () => {
    for (const def of [...entityAi.reads, ...entityAi.writes]) {
      expect(def.permission).toEqual(
        expect.objectContaining({
          module: "MOD-01",
          action: expect.any(String),
        }),
      );
    }
  });

  it("keeps every entity mutation behind a confirmation", () => {
    for (const w of entityAi.writes) expect(w.confirm).toBe(true);
  });
});

/**
 * The renewals list is the other route that reads document rows, and it is
 * gated at `view`. A renewal LABEL falls back to `document_number` when a
 * document has neither a title nor a type name, so an unredacted list put a
 * withheld field straight back on the wire — and made the dossier's own
 * renewals block disagree with `GET /:id/renewals` about the same document.
 */
describe("renewals labels respect the same redaction", () => {
  const renewalRules = require("../../src/modules/master/corporate_entity/corporate_entity.renewals");

  const bare = {
    document_id: "d1",
    title: null,
    document_type_name: null,
    document_number: "MOD-01-DOC-000041",
    expires_on: "2026-01-04",
    is_active: true,
  };

  it("labels a redacted document by what is left, never by its reference", () => {
    const out = renewalRules.renewals(
      { documents: [redactDocument(bare)] },
      "2026-09-10",
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].label).toBe("Document");
    expect(JSON.stringify(out)).not.toContain("MOD-01-DOC-000041");
  });

  it("still names it for a caller who may see it", () => {
    const out = renewalRules.renewals({ documents: [bare] }, "2026-09-10");
    expect(out.items[0].label).toBe("MOD-01-DOC-000041");
  });

  it("defaults to the redacted list when no grant was established", async () => {
    // A call site that forgets to pass `governance` must fail CLOSED. Driven
    // through the service rather than the pure rules, because the default is
    // the thing under test and it lives on the service's signature.
    const service = require("../../src/modules/master/corporate_entity/corporate_entity.service");
    const client = {
      query(text) {
        if (/FROM corporate_entity/.test(text))
          return { rows: [{ entity_id: "e1" }] };
        if (/FROM entity_document/.test(text)) return { rows: [bare] };
        return { rows: [] };
      },
    };

    const withoutGrant = await service.renewals(client, "e1", "2026-09-10");
    expect(withoutGrant.items[0].label).toBe("Document");

    const withGrant = await service.renewals(client, "e1", "2026-09-10", {
      governance: true,
    });
    expect(withGrant.items[0].label).toBe("MOD-01-DOC-000041");
  });
});
