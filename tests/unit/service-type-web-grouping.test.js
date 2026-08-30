"use strict";

/**
 * The public services list, folded into pillars (migration 12755).
 *
 * The fold lives in its own module precisely so it can be pinned without a
 * database: every case below is a shape the SQL can genuinely produce, and the
 * two that matter are the ones a flat list could not express at all — an
 * ungrouped service, and a service whose pillar has been retired. Both must
 * still reach the page. A services page that silently drops a service the
 * tenant published is worse than one with no pillars.
 */

const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "../..");
const { groupServices } = require("../../src/modules/operations/service_type_web_public/service_type_web_public.service");

/** A row as the LEFT JOIN yields it. `g` null = ungrouped or retired pillar. */
const row = (service, group = null) => ({
  service_type_id: service,
  name_en: service,
  group_id: group ? `gid-${group}` : null,
  group_key: group,
  group_name_fr: group ? `${group}-fr` : null,
  group_name_en: group ? `${group}-en` : null,
  group_icon: group ? `icon-${group}` : null,
});

const id = (r) => ({ service_type_id: r.service_type_id });
const names = (out) => out.groups.map((g) => g.key);
const members = (out, i) => out.groups[i].services.map((s) => s.service_type_id);

describe("groupServices", () => {
  it("folds services under their pillar, in row order", () => {
    const out = groupServices(
      [row("a", "freight"), row("b", "freight"), row("c", "value")],
      id,
    );
    expect(names(out)).toEqual(["freight", "value"]);
    expect(members(out, 0)).toEqual(["a", "b"]);
    expect(members(out, 1)).toEqual(["c"]);
  });

  it("carries the pillar's labels and icon onto the group, once", () => {
    const out = groupServices([row("a", "freight"), row("b", "freight")], id);
    expect(out.groups[0]).toMatchObject({
      key: "freight",
      name_fr: "freight-fr",
      name_en: "freight-en",
      icon: "icon-freight",
    });
    expect(out.groups).toHaveLength(1);
  });

  it("collects ungrouped services into a trailing null-key group", () => {
    // The state every tenant is in the day the column ships.
    const out = groupServices([row("a", "freight"), row("x"), row("y")], id);
    expect(names(out)).toEqual(["freight", null]);
    expect(members(out, 1)).toEqual(["x", "y"]);
  });

  it("never drops a service whose pillar was retired", () => {
    // ON g.is_active = true means a retired pillar yields all-NULL g columns,
    // which is indistinguishable from ungrouped — and must be, not dropped.
    const out = groupServices([row("orphan")], id);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].key).toBeNull();
    expect(members(out, 0)).toEqual(["orphan"]);
  });

  it("does not merge a pillar named with an empty string into the leftovers", () => {
    // The reason the ungrouped bucket is keyed by a Symbol. A sentinel string
    // would collide here and quietly swallow a real pillar.
    const empty = { ...row("a", "x"), group_key: "", group_id: "gid-x" };
    const out = groupServices([empty, row("z")], id);
    expect(out.groups).toHaveLength(2);
    expect(out.groups[0].key).toBe("");
    expect(members(out, 0)).toEqual(["a"]);
    expect(out.groups[1].key).toBeNull();
  });

  it("does not merge a pillar literally keyed 'null'", () => {
    const nully = { ...row("a", "x"), group_key: "null", group_id: "gid-x" };
    const out = groupServices([nully, row("z")], id);
    expect(names(out)).toEqual(["null", null]);
  });

  it("applies the caller's mapper rather than leaking the row", () => {
    const out = groupServices([row("a", "freight")], (r) => ({ mapped: r.name_en }));
    expect(out.groups[0].services[0]).toEqual({ mapped: "a" });
  });

  it("returns no groups for no rows, and tolerates a nullish list", () => {
    expect(groupServices([], id)).toEqual({ groups: [] });
    expect(groupServices(null, id)).toEqual({ groups: [] });
  });
});

describe("migration 12755", () => {
  const sql = fs.readFileSync(
    path.join(repo, "migrations/tenant/12755_service_type_web_group.sql"),
    "utf8",
  );

  it("makes group_id nullable and SET NULL, so retiring a pillar keeps its services", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES service_type_web_group\(group_id\) ON DELETE SET NULL/);
    expect(sql).not.toMatch(/group_id[^;]*ON DELETE CASCADE/);
  });

  it("constrains accent to token names, never a hex", () => {
    expect(sql).toMatch(/CHECK \(accent IN \('PRIMARY', 'ACCENT', 'SUCCESS'\)\)/);
    // A stored hex would bake one tenant's palette into another tenant's data.
    expect(sql).not.toMatch(/DEFAULT '#/);
  });

  it("keeps the read path indexed on the columns it orders by", () => {
    expect(sql).toMatch(/ix_service_type_web_profile_group[\s\S]*group_id, sort_order/);
    expect(sql).toMatch(/ix_service_type_web_group_order/);
  });
});

describe("the public list route", () => {
  const src = fs.readFileSync(
    path.join(repo, "src/modules/operations/service_type_web_public/service_type_web_public.routes.js"),
    "utf8",
  );
  const repoSrc = fs.readFileSync(
    path.join(repo, "src/modules/operations/service_type_web/service_type_web.repo.js"),
    "utf8",
  );

  it("delegates the fold rather than inlining it", () => {
    expect(src).toContain("grouping.groupServices(");
  });

  it("exposes the claim and accent the cards close on", () => {
    expect(src).toMatch(/claim_fr: row\.claim_fr/);
    expect(src).toMatch(/accent: row\.accent/);
  });

  it("selects the pillar through a LEFT JOIN, with is_active in the ON", () => {
    // In the WHERE it would become an inner join and drop ungrouped services.
    expect(repoSrc).toMatch(/LEFT JOIN service_type_web_group g\s*\n?\s*ON g\.group_id = p\.group_id AND g\.is_active = true/);
    expect(repoSrc).toMatch(/ORDER BY g\.sort_order ASC NULLS LAST/);
  });

  it("takes group_id from the join, not from the profile", () => {
    // p.group_id stays set when the pillar is retired; g.group_id goes NULL,
    // which is what the fold reads to route the service to the leftovers.
    expect(repoSrc).toMatch(/g\.group_id, g\.key AS group_key/);
  });
});

/**
 * Three lists must agree or a field silently stops working: the validator's
 * profileFields (what the API accepts), the service's WRITABLE (what it passes
 * on) and the repo's PROFILE_COLUMNS (what it writes). This is the same parity
 * guard corporate-entity-create.test.js keeps over the master shape, and it is
 * the reason adding group_id/claim/accent needed three edits rather than one.
 */
describe("profile field parity", () => {
  const validator = require("../../src/modules/operations/service_type_web/service_type_web.validator");
  const service = require("../../src/modules/operations/service_type_web/service_type_web.service");
  const webRepo = require("../../src/modules/operations/service_type_web/service_type_web.repo");

  const schemaKeys = Object.keys(validator.schemas.upsertProfile.shape).sort();

  it("keeps validator, WRITABLE and PROFILE_COLUMNS identical", () => {
    expect([...service.WRITABLE].sort()).toEqual(schemaKeys);
    expect([...webRepo.PROFILE_COLUMNS].sort()).toEqual(schemaKeys);
  });

  it("carries the 12755 fields end to end", () => {
    for (const key of ["group_id", "claim_fr", "claim_en", "accent"]) {
      expect(schemaKeys).toContain(key);
      expect(service.WRITABLE).toContain(key);
      expect(webRepo.PROFILE_COLUMNS).toContain(key);
    }
  });

  it("accepts only token names for accent, never a hex", () => {
    const s = validator.schemas.upsertProfile;
    expect(s.safeParse({ accent: "ACCENT" }).success).toBe(true);
    expect(s.safeParse({ accent: "#EE7D04" }).success).toBe(false);
  });

  it("lets group_id be cleared, because ungrouped still renders", () => {
    expect(validator.schemas.upsertProfile.safeParse({ group_id: null }).success).toBe(true);
  });
});

describe("pillar validation", () => {
  const { schemas } = require("../../src/modules/operations/service_type_web/service_type_web.validator");

  it("constrains key to an anchor-safe slug", () => {
    // key is what /services#<key> lands on; spaces and punctuation break the
    // jump links the page hero depends on.
    expect(schemas.createGroup.safeParse({ key: "freight", name_fr: "Fret" }).success).toBe(true);
    expect(schemas.createGroup.safeParse({ key: "value-added", name_fr: "x" }).success).toBe(true);
    expect(schemas.createGroup.safeParse({ key: "Freight Solutions!", name_fr: "x" }).success).toBe(false);
    expect(schemas.createGroup.safeParse({ key: "-leading", name_fr: "x" }).success).toBe(false);
  });

  it("requires a French name — the fallback every renderer reads", () => {
    expect(schemas.createGroup.safeParse({ key: "freight" }).success).toBe(false);
    expect(schemas.createGroup.safeParse({ key: "freight", name_fr: "" }).success).toBe(false);
  });

  it("refuses an empty update rather than answering 200 to a caller bug", () => {
    expect(schemas.updateGroup.safeParse({}).success).toBe(false);
    expect(schemas.updateGroup.safeParse({ sort_order: 10 }).success).toBe(true);
  });

  it("rejects unknown keys instead of ignoring them", () => {
    expect(schemas.createGroup.safeParse({
      key: "freight", name_fr: "Fret", colour: "#fff",
    }).success).toBe(false);
  });
});

describe("pillar admin routes", () => {
  const src = fs.readFileSync(
    path.join(repo, "src/modules/operations/service_type/service_type.routes.js"),
    "utf8",
  );

  it("registers the literal /web/groups paths before the /:id/web ones", () => {
    const groups = src.indexOf('"/web/groups"');
    const byId = src.indexOf('"/:id/web"');
    expect(groups).toBeGreaterThan(-1);
    expect(byId).toBeGreaterThan(-1);
    expect(groups).toBeLessThan(byId);
  });

  it("gates reads on view and every write on edit", () => {
    // From the section comment, not the path string: slicing at the path
    // starts *inside* router.get(, so the verb token is already behind us.
    const block = src.slice(src.indexOf("── Pillars (12755)"), src.indexOf('"/:id/web"'));
    expect(block).toMatch(/router\.get\([\s\S]*?requirePermission\(MODULE, "view"\)/);
    for (const verb of ["post", "patch", "delete"]) {
      expect(block).toMatch(new RegExp(`router\\.${verb}\\([\\s\\S]*?requirePermission\\(MODULE, "edit"\\)`));
    }
  });

  it("validates both bodied writes", () => {
    expect(src).toContain("validateCreateGroup");
    expect(src).toContain("validateUpdateGroup");
  });
});
