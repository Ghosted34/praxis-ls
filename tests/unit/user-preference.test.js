/**
 * Per-user preferences (src/modules/preference) — appearance and shell.
 *
 * The behaviours worth pinning for APPEARANCE are the three that a careless
 * refactor breaks silently: absent ≠ null in the PUT body, only typography is
 * writable, and a font-family string is screened before it is written into a
 * style attribute.
 *
 * For SHELL it is one behaviour, and it is the one the icon rail is built on:
 * "never chosen" (null) and "deliberately empty" ([]) are different answers,
 * because the first is what makes the rail arrive pre-populated on a first
 * login and the second is what lets someone clear it.
 */
"use strict";

const service = require("../../src/modules/preference/preference.service");
const { validateAppearance, validateShell } = require("../../src/modules/preference/preference.validator");

/** Minimal in-memory stand-in for the `user_preference` table. */
function fakeClient() {
  const rows = new Map(); // `${user}|${section}|${key}` -> value
  return {
    rows,
    query: jest.fn(async (sql, params) => {
      if (/^SELECT/.test(sql.trim())) {
        const [userId, section] = params;
        const out = [];
        for (const [k, value] of rows) {
          const [u, s, key] = k.split("|");
          if (u === userId && s === section) out.push({ key, value });
        }
        return { rows: out };
      }
      if (/^INSERT/.test(sql.trim())) {
        const [userId, section, key, value] = params;
        rows.set(`${userId}|${section}|${key}`, JSON.parse(value));
        return { rows: [] };
      }
      if (/^DELETE/.test(sql.trim())) {
        const [userId, section, key] = params;
        if (key === undefined) {
          for (const k of [...rows.keys()]) {
            if (k.startsWith(`${userId}|${section}|`)) rows.delete(k);
          }
        } else {
          rows.delete(`${userId}|${section}|${key}`);
        }
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    }),
  };
}

const USER = "11111111-1111-1111-1111-111111111111";

describe("user appearance preferences", () => {
  it("returns every key as null when the user has overridden nothing", async () => {
    const c = fakeClient();
    await expect(service.getAppearance(c, USER)).resolves.toEqual({
      fontDisplay: null,
      fontBody: null,
      fontMono: null,
    });
  });

  it("round-trips a saved font", async () => {
    const c = fakeClient();
    const saved = await service.setAppearance(c, { userId: USER, fontBody: '"Lora Variable", Lora, serif' });
    expect(saved.fontBody).toBe('"Lora Variable", Lora, serif');
    await expect(service.getAppearance(c, USER)).resolves.toMatchObject({
      fontBody: '"Lora Variable", Lora, serif',
      fontDisplay: null,
    });
  });

  /**
   * The distinction the whole partial-update contract rests on. If an absent
   * key were treated as null, saving the body font alone would wipe the display
   * and mono overrides — the user changes one dropdown and loses two settings.
   */
  it("leaves untouched keys alone and treats null as a delete", async () => {
    const c = fakeClient();
    await service.setAppearance(c, { userId: USER, fontDisplay: "Inter", fontBody: "Lora", fontMono: "Cascadia" });

    // Absent keys survive.
    const afterPartial = await service.setAppearance(c, { userId: USER, fontBody: "Merriweather" });
    expect(afterPartial).toEqual({ fontDisplay: "Inter", fontBody: "Merriweather", fontMono: "Cascadia" });

    // Explicit null clears exactly one.
    const afterClear = await service.setAppearance(c, { userId: USER, fontBody: null });
    expect(afterClear).toEqual({ fontDisplay: "Inter", fontBody: null, fontMono: "Cascadia" });
  });

  it("treats an empty string like null, so a cleared field inherits rather than blanks", async () => {
    const c = fakeClient();
    await service.setAppearance(c, { userId: USER, fontDisplay: "Inter" });
    await expect(service.setAppearance(c, { userId: USER, fontDisplay: "   " })).resolves.toMatchObject({
      fontDisplay: null,
    });
  });

  it("resets every override in one call", async () => {
    const c = fakeClient();
    await service.setAppearance(c, { userId: USER, fontDisplay: "Inter", fontBody: "Lora", fontMono: "Cascadia" });
    await expect(service.resetAppearance(c, USER)).resolves.toEqual({
      fontDisplay: null,
      fontBody: null,
      fontMono: null,
    });
  });

  /**
   * Colour and logo are the COMPANY's identity. A user who POSTs them should
   * not have them quietly stored — the allow-list is the boundary, so prove
   * that a field outside it never reaches the table.
   */
  it("ignores non-typography fields — a user cannot restyle the brand", async () => {
    const c = fakeClient();
    await service.setAppearance(c, { userId: USER, primary: "#ff0000", logoUrl: "/evil.png", name: "Not Your Corp" });
    expect([...c.rows.keys()]).toHaveLength(0);
  });

  /**
   * The stored value is written straight into a CSS custom property by the
   * client, so it is the one place a stored string can escape into a
   * stylesheet. These are the shapes that would let it.
   */
  it.each([
    ["a closing declaration", 'Inter; background: url(https://evil.example/x)'],
    ["a block escape", 'Inter} body{display:none'],
    ["a remote font fetch", 'url(https://evil.example/f.woff2)'],
    ["an import", '@import "https://evil.example/x.css"'],
    ["a markup break-out", 'Inter</style><script>alert(1)</script>'],
  ])("rejects %s", async (_label, value) => {
    const c = fakeClient();
    await expect(service.setAppearance(c, { userId: USER, fontBody: value })).rejects.toMatchObject({
      status: 422,
      code: "BAD_FONT",
    });
    expect([...c.rows.keys()]).toHaveLength(0);
  });

  it("rejects an over-long stack", async () => {
    const c = fakeClient();
    await expect(service.setAppearance(c, { userId: USER, fontBody: "x".repeat(201) })).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("appearance validator", () => {
  const run = (body) => {
    const req = { body };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    validateAppearance(req, res, next);
    return { req, res, next };
  };

  it("strips keys the caller never sent, preserving absent-vs-null", () => {
    const { req, next } = run({ fontBody: "Lora" });
    expect(next).toHaveBeenCalled();
    expect(Object.keys(req.body)).toEqual(["fontBody"]);
  });

  it("keeps an explicit null — it is how an override is cleared", () => {
    const { req, next } = run({ fontBody: null });
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ fontBody: null });
  });

  it("422s a non-string font", () => {
    const { res, next } = run({ fontBody: 42 });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("tolerates an empty body — a PUT that changes nothing is not an error", () => {
    const { req, next } = run({});
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({});
  });
});

describe("shell preferences", () => {
  it("returns every key as null before the user has arranged anything", async () => {
    const c = fakeClient();
    await expect(service.getShell(c, USER)).resolves.toEqual({
      ribbonPinned: null,
      railPins: null,
      towerPins: null,
      railHintSeen: null,
    });
  });

  it("round-trips the ribbon's pinned state", async () => {
    const c = fakeClient();
    await expect(service.setShell(c, { userId: USER, ribbonPinned: false })).resolves.toMatchObject({
      ribbonPinned: false,
    });
    await expect(service.getShell(c, USER)).resolves.toMatchObject({ ribbonPinned: false });

    await service.setShell(c, { userId: USER, ribbonPinned: true });
    await expect(service.getShell(c, USER)).resolves.toMatchObject({ ribbonPinned: true });
  });

  /**
   * `false` is a value, not an absence. A service that tested truthiness rather
   * than `undefined` would store "pinned" and silently discard every attempt to
   * collapse the ribbon — a bug that reads as "the button does nothing".
   */
  it("stores false rather than treating it as no answer", async () => {
    const c = fakeClient();
    await service.setShell(c, { userId: USER, ribbonPinned: false, railHintSeen: false });
    expect([...c.rows.values()]).toEqual([false, false]);
  });

  /**
   * THE DISTINCTION THE RAIL DEPENDS ON. null means "never chosen", and the
   * client answers that with its starter set; [] means "I cleared it". Collapse
   * the two and either the rail can never be emptied, or it arrives empty on
   * everyone's first login.
   */
  it("keeps 'never chosen' and 'deliberately empty' apart", async () => {
    const c = fakeClient();
    await service.setShell(c, { userId: USER, railPins: [] });
    await expect(service.getShell(c, USER)).resolves.toMatchObject({ railPins: [] });

    await service.setShell(c, { userId: USER, railPins: null });
    await expect(service.getShell(c, USER)).resolves.toMatchObject({ railPins: null });
  });

  it("leaves untouched keys alone", async () => {
    const c = fakeClient();
    await service.setShell(c, { userId: USER, ribbonPinned: false, railPins: ["finance"], railHintSeen: true });
    await expect(service.setShell(c, { userId: USER, railPins: ["finance", "fleet"] })).resolves.toEqual({
      ribbonPinned: false,
      railPins: ["finance", "fleet"],
      towerPins: null,
      railHintSeen: true,
    });
  });

  /** The Control Tower's shortcut grid is a second independent pin list
   *  persisted through the same envelope. Same shape, same "absent vs null"
   *  rule, so the same test coverage applies. */
  it("keeps rail and tower pin lists apart", async () => {
    const c = fakeClient();
    await service.setShell(c, { userId: USER, railPins: ["finance"], towerPins: ["operations", "wms"] });
    await expect(service.getShell(c, USER)).resolves.toMatchObject({
      railPins: ["finance"],
      towerPins: ["operations", "wms"],
    });
    // Clearing one leaves the other in place.
    await service.setShell(c, { userId: USER, towerPins: [] });
    await expect(service.getShell(c, USER)).resolves.toMatchObject({
      railPins: ["finance"],
      towerPins: [],
    });
  });

  it("ignores fields outside the section — this endpoint cannot write a font", async () => {
    const c = fakeClient();
    await service.setShell(c, { userId: USER, fontBody: "Lora", theme: "dark" });
    expect([...c.rows.keys()]).toHaveLength(0);
  });
});

describe("shell validator", () => {
  const run = (body) => {
    const req = { body };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    validateShell(req, res, next);
    return { req, res, next };
  };

  it("accepts an empty pin list — clearing the rail is a legal request", () => {
    const { req, next } = run({ railPins: [] });
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ railPins: [] });
  });

  it("keeps an explicit null apart from an absent key", () => {
    expect(run({ railPins: null }).req.body).toEqual({ railPins: null });
    expect(run({ ribbonPinned: true }).req.body).toEqual({ ribbonPinned: true });
  });

  /** The rail is a strip of icons a dozen tall. A request carrying hundreds is
   *  not a preference, and the row it writes is billed to the tenant. */
  it("422s an unbounded pin list", () => {
    const { res, next } = run({ railPins: Array.from({ length: 40 }, (_, i) => `p${i}`) });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("422s a pin that is not a string", () => {
    const { res } = run({ railPins: [{ to: "/finance" }] });
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("accepts and bounds towerPins the same way as railPins", () => {
    expect(run({ towerPins: [] }).req.body).toEqual({ towerPins: [] });
    expect(run({ towerPins: null }).req.body).toEqual({ towerPins: null });
    // Same 16-item cap as railPins — the Control Tower grid caps at 11 but the
    // envelope is shared, so a client sending a longer list is still bounded.
    const bloated = run({ towerPins: Array.from({ length: 40 }, (_, i) => `p${i}`) });
    expect(bloated.next).not.toHaveBeenCalled();
    expect(bloated.res.status).toHaveBeenCalledWith(422);
  });

  it("422s a non-boolean pinned state", () => {
    const { res } = run({ ribbonPinned: "yes" });
    expect(res.status).toHaveBeenCalledWith(422);
  });
});
