"use strict";
/** Dossier lifecycle transitions (MOD-29). */
const { canTransition, isTerminal } = require("../../src/modules/operations/operations_file/operations_file.rules");
describe("dossier transitions", () => {
  it("allows the forward path", () => {
    expect(canTransition("OPEN", "IN_PROGRESS")).toBe(true);
    expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
  });
  it("allows cancellation from open/in-progress", () => {
    expect(canTransition("OPEN", "CANCELLED")).toBe(true);
    expect(canTransition("IN_PROGRESS", "CANCELLED")).toBe(true);
  });
  it("rejects illegal / from-terminal transitions", () => {
    expect(canTransition("OPEN", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("CANCELLED", "OPEN")).toBe(false);
  });
  it("flags terminal states", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("OPEN")).toBe(false);
  });
});
