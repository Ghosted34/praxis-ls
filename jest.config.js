"use strict";

module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/server.js",
    "!src/jobs/workers.js",
  ],
  coverageDirectory: "coverage",
  /**
   * TC-Q1 — the threshold is on FUNCTIONS and BRANCHES, never lines or
   * statements, and that is the entire finding rather than a stylistic choice.
   *
   * The audit measured lines at 40.68% against functions at 13.12%. Every
   * `*.routes.js` in the repo reports 100% statements with 0% functions — 99 of
   * them — because requiring the file registers the routes and that is all the
   * statement counter is seeing. A gate set on lines or statements would
   * therefore be satisfied by IMPORTING files, and would read as healthy while
   * measuring nothing. Only 66 of 855 files are at literally 0% statements,
   * which is what makes the codebase look far better instrumented than it is.
   *
   * ONLY `functions`, and only at 13 — the figure the audit actually MEASURED
   * (13.12%). There is no `branches` floor here on purpose: nobody has measured
   * branch coverage on this repo, and a threshold set to a number someone
   * guessed either fails the build the first time it runs or passes forever
   * without meaning anything. Both outcomes end with the gate being deleted.
   *
   * This floor is a RATCHET, not a target. Its only job is to stop coverage
   * going backwards from the audited baseline. Add `branches`, and raise
   * `functions`, once CI has printed a real current number — TC-CI3 makes it
   * print the summary on every run, which is the whole point of measuring it
   * there before setting a target on it.
   */
  coverageThreshold: {
    global: { functions: 13 },
  },
  setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.js"],
  testTimeout: 15000,
  clearMocks: true,
};
