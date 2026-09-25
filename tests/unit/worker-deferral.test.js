"use strict";
/**
 * PR-5: a call part that waits for its tenant's fair share (or for the
 * provider limiters) moves itself to the delayed set and throws BullMQ's
 * DelayedError. That is the queue working, not a failure: the worker wrapper
 * must not log it as "job threw" at ERROR, or count it as a failed job,
 * or a busy tenant would flood the error log with every deferral.
 */
const mockWorkers = [];
jest.mock("bullmq", () => {
  const actual = jest.requireActual("bullmq");
  return {
    ...actual,
    Worker: class {
      constructor(name, processor) {
        this.name = name;
        this.processor = processor;
        mockWorkers.push(this);
      }
      on() { return this; }
    },
  };
});
jest.mock("../../src/config/redis", () => ({ createConnection: () => ({}), initRedis: async () => {}, closeRedis: async () => {} }));
jest.mock("../../src/config/logger", () => ({
  ...jest.requireActual("../../src/config/logger"),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { DelayedError } = require("bullmq");
const { logger } = require("../../src/config/logger");
const metrics = require("../../src/shared/observability/metrics");
const workers = require("../../src/jobs/workers");

test("a DelayedError is passed to BullMQ without an ERROR log or a failure count", async () => {
  const entry = workers.PROCESSORS.find((p) => p.name === "call-transcribe-part");
  entry.handler = async () => { throw new DelayedError(); };
  workers.startWorkers();
  const w = mockWorkers.find((x) => x.name === "call-transcribe-part");
  const before = JSON.stringify(metrics.snapshot());
  await expect(w.processor({ id: "j1", name: "part", data: { tenantMeta: { slug: "acme" }, env: "live" } }, "tok"))
    .rejects.toBeInstanceOf(DelayedError);
  expect(logger.error.mock.calls.filter((c) => c[1] === "job threw")).toHaveLength(0);
  const after = JSON.stringify(metrics.snapshot());
  expect(after.includes("\"outcome\":\"error\"")).toBe(before.includes("\"outcome\":\"error\""));
});

test("the token reaches the handler (it needs it to move itself to delayed)", async () => {
  const entry = workers.PROCESSORS.find((p) => p.name === "call-transcribe-part");
  let seen = null;
  entry.handler = async (_job, token) => { seen = token; return "ok"; };
  const w = mockWorkers.find((x) => x.name === "call-transcribe-part");
  await w.processor({ id: "j2", name: "part", data: { tenantMeta: { slug: "acme" }, env: "live" } }, "tok-2");
  expect(seen).toBe("tok-2");
});
