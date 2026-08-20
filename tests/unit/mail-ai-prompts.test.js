"use strict";
const { PRESETS, ACTIONS, resolvePrompt, resolveAction } = require("../../src/modules/mail/assist/assist.prompts");

describe("ten presets × EN/FR", () => {
  test("all ten resolve in both languages", () => {
    expect(Object.keys(PRESETS)).toHaveLength(10);
    for (const k of Object.keys(PRESETS)) {
      expect(resolvePrompt(k, "en").length).toBeGreaterThan(8);
      expect(resolvePrompt(k, "fr").length).toBeGreaterThan(8);
    }
  });
  test("five actions resolve", () => {
    expect(Object.keys(ACTIONS)).toHaveLength(5);
    expect(resolveAction("to_fr", "en")).toMatch(/French|français/i);
  });
});
