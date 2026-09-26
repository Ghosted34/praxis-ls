"use strict";
/**
 * The platform call check's TURN allocation (calls audit PR-7, O5) against a
 * REAL coturn: a credential signed like the API's allocates a relay address,
 * a wrong secret is refused with 401, and a relay that is not there times out.
 *
 * Opt-in like tests/integration/turn-relay.test.js: RUN_TURN_TESTS=1 with
 * `turnserver` on PATH and a non-loopback IPv4 (TURN_TEST_RELAY_IP, else the
 * first one found).
 */
const os = require("os");
const { spawn, spawnSync } = require("child_process");

const has = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
const IP = process.env.TURN_TEST_RELAY_IP
  || Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;
const enabled = process.env.RUN_TURN_TESTS === "1" && has("turnserver") && !!IP;
const maybe = enabled ? describe : describe.skip;
jest.mock("../../src/config/env", () => {
  const real = jest.requireActual("../../src/config/env");
  return { ...real, config: { ...real.config } };
});
const PORT = 34790;
const RELAY_SHARED = "probe-integration-shared";

// Signed exactly as the API signs a caller's (smartcomm.turn.service).
const { config } = require("../../src/config/env");
const turn = require("../../src/modules/smartcomm/smartcomm.turn.service");
const signed = (shared) => {
  config.TURN_CREDENTIAL_SECRET = shared;
  return turn.signedLabel({ id: "canary-test", ttlSeconds: 120 });
};

maybe("the TURN probe against a real relay", () => {
  let relay;
  const { allocate } = require("../../src/services/platform/turn-probe");
  beforeAll(async () => {
    relay = spawn("turnserver", [
      "-n", "--listening-port", String(PORT), "--listening-ip", IP, "--relay-ip", IP,
      "--use-auth-secret", `--static-auth-secret=${RELAY_SHARED}`, "--realm", "turn.test",
      "--no-tls", "--no-dtls", "--no-cli", "--log-file", "stdout",
    ], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 1500));
  });
  afterAll(() => relay && relay.kill());

  test("a credential signed with the relay's secret allocates, and is released", async () => {
    const out = await allocate({ host: IP, port: PORT, allowPrivate: true, ...signed(RELAY_SHARED) });
    expect(out).toMatchObject({ ok: true, relayed: expect.stringMatching(/^\d+\.\d+\.\d+\.\d+:\d+$/) });
  });

  test("a wrong secret is refused with 401", async () => {
    expect(await allocate({ host: IP, port: PORT, allowPrivate: true, ...signed("not-the-one-the-relay-has") })).toMatchObject({ ok: false, code: 401 });
  });

  test("a relay that is not there times out", async () => {
    expect(await allocate({ host: IP, port: PORT + 3, allowPrivate: true, ...signed(RELAY_SHARED), timeoutMs: 1000 })).toMatchObject({ ok: false });
  });
});
