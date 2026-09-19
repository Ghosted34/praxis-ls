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
  // Keep coverage parallelism bounded on GitHub's small runners. The wet-signature
  // PDF/DataMatrix test exercises native canvas + WASM; unbounded workers make
  // the Test step measure memory pressure rather than code correctness.
  maxWorkers: 2,
  /**
   * RESTART A WORKER THAT HAS GROWN PAST 1 GB.
   *
   * A Jest worker is reused across suites and keeps `require.cache` between
   * them, so memory only ever goes UP over a run. Measured with
   * `--logHeapUsage`: workers finish this suite at ~1.35 GB, and the number
   * climbs steadily with the number of files a worker has been handed rather
   * than with any one file's weight — the heaviest reported suites
   * (`ai-workers`, `query-columns`, `entity-child-clear-field`) are simply the
   * ones that happened to run late.
   *
   * That is survivable until it isn't. CI died with:
   *
   *     A jest worker process was terminated by another process:
   *     signal=SIGKILL, exitCode=null
   *
   * — the OOM killer, reported against `ai-readiness.test.js`, a suite that had
   * not changed. THE SUITE NAMED IN THAT MESSAGE IS THE VICTIM, NOT THE CAUSE:
   * the kernel kills whatever is resident when the machine runs out, so the
   * blame lands on whichever file the doomed worker happened to be holding.
   * Chasing that name is how this gets misdiagnosed as a flake and re-run.
   *
   * `workerIdleMemoryLimit` makes Jest restart a worker once it crosses the
   * bound, between suites, so the run has a ceiling instead of a slope. 1 GB
   * leaves room for two workers plus the coverage maps and the parent process
   * inside the runner's budget, and is high enough that restarts are rare
   * rather than a per-file cost.
   *
   * Deliberately NOT `--runInBand` (TC-F2 measured 22.5s serial vs 7.4s
   * parallel and removed it on purpose) and deliberately not a bigger
   * `--max-old-space-size`: raising the ceiling on a slope only moves the
   * failure later, and the next person to add a test file pays for it again.
   */
  workerIdleMemoryLimit: "1GB",
  clearMocks: true,
};
