/**
 * Per-user appearance preferences (src/modules/preference).
 *
 * The behaviours worth pinning are the three that a careless refactor breaks
 * silently: absent ≠ null in the PUT body, only typography is writable, and a
 * font-family string is screened before it is written into a style attribute.
 */
"use strict";

const service = require("../../src/modules/preference/preference.service");
const { validateAppearance } = require("../../src/modules/preference/preference.validator");

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
