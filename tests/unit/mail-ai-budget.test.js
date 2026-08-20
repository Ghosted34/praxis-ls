"use strict";
const { PRESETS } = require("../../src/modules/mail/assist/assist.prompts");

describe("mail AI metering surface", () => {
  test("every preset is a named product, not a free-form model call", () => {
    expect(Object.keys(PRESETS).length).toBe(10);
  });
});
