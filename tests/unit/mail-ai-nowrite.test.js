"use strict";
const fs = require("fs");
const path = require("path");
const dir = path.resolve(__dirname, "../../src/modules/mail/assist");

describe("no AI path writes a business table", () => {
  test("assist.service never calls a create/update service", () => {
    const src = fs.readFileSync(path.join(dir, "assist.service.js"), "utf8");
    expect(src).not.toMatch(/require\(".*final_invoice/);
    expect(src).not.toMatch(/require\(".*costing/);
    expect(src).not.toMatch(/INSERT INTO invoice/);
    expect(src).not.toMatch(/INSERT INTO costing/);
  });
});
