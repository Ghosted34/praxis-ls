"use strict";

module.exports = {
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  collectCoverageFrom: ["src/**/*.js", "!src/server.js", "!src/jobs/worker.js"],
  coverageDirectory: "coverage",
  setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.js"],
  testTimeout: 15000,
  clearMocks: true,
};
