"use strict";
/**
 * Calls audit C1 and C3, and PR-4's relay-to-relay fix, against a REAL coturn:
 * the entrypoint's config starts a relay, a credential signed like the API's
 * allocates, two allocations on the relay reach each other (both callers
 * relayed), and the relay refuses 169.254.169.254, 172.17.0.1, loopback,
 * RFC 1918 and its own private address's neighbour.
 *
 * Opt-in: RUN_TURN_TESTS=1 with `turnserver` and `turnutils_uclient` on PATH
 * (the `coturn` package). The relay binds one non-loopback IPv4 of this
 * machine (TURN_TEST_RELAY_IP, else the first one found). A private one
 * exercises the private half; on a machine without one, add an alias:
 * `ip addr add 10.99.0.7/32 dev lo`. The same checks run on a deployed relay
 * through scripts/turn-check.sh.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

jest.mock("../../src/config/env", () => {
  const real = jest.requireActual("../../src/config/env");
  return { ...real, config: { ...real.config } };
});

const ROOT = path.join(__dirname, "..", "..");
const has = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
const RELAY_IP = process.env.TURN_TEST_RELAY_IP
  || Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === "IPv4" && !a.internal)?.address;
const enabled = process.env.RUN_TURN_TESTS === "1" && has("turnserver") && has("turnutils_uclient") && !!RELAY_IP;
const maybe = enabled ? describe : describe.skip;
const SECRET = "integration-secret";

function startRelay(port, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-it-"));
  return spawn("sh", [path.join(ROOT, "docker", "coturn", "docker-entrypoint.sh")], {
    env: {
      PATH: process.env.PATH,
      TURN_CREDENTIAL_SECRET: SECRET,
      TURN_REALM: "turn.test",
      TURN_PORT_UDP: port,
      TURN_MIN_PORT: "51000",
      TURN_MAX_PORT: "51400",
      TURN_CONF: path.join(dir, "turnserver.conf"),
      ...env,
    },
    stdio: "ignore",
  });
}

function turnCheck(port, env) {
  return spawnSync("sh", [path.join(ROOT, "scripts", "turn-check.sh"), RELAY_IP, port], {
    env: { PATH: process.env.PATH, TURN_CREDENTIAL_SECRET: SECRET, ...env },
    encoding: "utf8",
    timeout: 170_000,
  });
}

function expectRelayChecksPass(out) {
  expect(out.stdout).toMatch(/PASS: allocation and relay to a public peer/);
  expect(out.stdout).toMatch(/PASS: a wrong secret cannot allocate/);
  expect(out.stdout).toMatch(/PASS: relay to relay/);
  expect(out.stdout).toMatch(/PASS: peer 169\.254\.169\.254 refused/);
  expect(out.stdout).toMatch(/PASS: peer 172\.17\.0\.1 refused/);
  expect(out.stdout).toMatch(/PASS: peer 127\.0\.0\.1 refused/);
  expect(out.stdout).not.toMatch(/FAIL/);
  expect(out.stdout).toMatch(/ALL TURN CHECKS PASSED/);
  expect(out.status).toBe(0);
}

const settle = () => new Promise((r) => setTimeout(r, 1500));

maybe("coturn relay, public IP on the interface (real server)", () => {
  const PORT = "23478";
  // The single-address form: this host's own address is what a relayed
  // caller's peer is. Before PR-4 the entrypoint denied it.
  const ENV = { TURN_EXTERNAL_IP: RELAY_IP, TURN_LISTENING_IP: RELAY_IP };
  let server;

  beforeAll(async () => { server = startRelay(PORT, ENV); await settle(); });
  afterAll(() => { if (server) server.kill("SIGTERM"); });

  /** One allocation + a send to a public peer with explicit credentials. */
  function allocateWith(username, password) {
    const out = spawnSync("timeout", ["12", "turnutils_uclient", "-u", username, "-w", password,
      "-p", PORT, "-e", "203.0.113.10", "-n", "1", "-m", "1", "-c", RELAY_IP], { encoding: "utf8" });
    return `${out.stdout}${out.stderr}`;
  }

  test("C3: a credential minted by the API's own code is accepted; expired or altered ones are not", () => {
    const { config } = require("../../src/config/env");
    Object.assign(config, { TURN_HOST: RELAY_IP, TURN_CREDENTIAL_SECRET: SECRET, TURN_PORT_UDP: Number(PORT), STUN_URLS: "" });
    const turn = require("../../src/modules/smartcomm/smartcomm.turn.service");
    const token = turn.newCallToken();
    const ice = turn.iceConfigFor({ token, ttlSeconds: 120 });
    const relay = ice.iceServers.find((x) => x.username);
    expect(relay.username).toMatch(new RegExp(`^\\d+:${token}$`));

    const ok = allocateWith(relay.username, relay.credential);
    expect(ok).toMatch(/tot_send_msgs=1/);
    expect(ok).not.toMatch(/error/i);

    const expired = turn.turnCredential({ token, ttlSeconds: 60, now: Date.now() - 3_600_000 });
    expect(allocateWith(expired.username, expired.password)).toMatch(/Cannot complete Allocation/);

    const tampered = `${relay.username.split(":")[0]}:${turn.newCallToken()}`;
    expect(allocateWith(tampered, relay.credential)).toMatch(/Cannot complete Allocation/);
  }, 60_000);

  test("allocation and relay to relay work; private and metadata peers are refused", () => {
    expectRelayChecksPass(turnCheck(PORT, ENV));
  }, 180_000);
});

maybe("coturn relay behind 1:1 cloud NAT, external-ip public/private (real server)", () => {
  const PORT = "23479";
  // 203.0.113.5 stands in for the elastic IP; coturn maps a peer at it back
  // to RELAY_IP before checking and sending.
  const ENV = { TURN_EXTERNAL_IP: `203.0.113.5/${RELAY_IP}`, TURN_LISTENING_IP: RELAY_IP };
  let server;

  beforeAll(async () => { server = startRelay(PORT, ENV); await settle(); });
  afterAll(() => { if (server) server.kill("SIGTERM"); });

  test("relay to relay works through the public address; the private neighbour stays refused", () => {
    const out = turnCheck(PORT, ENV);
    expectRelayChecksPass(out);
    const [a, b, c, d] = RELAY_IP.split(".").map(Number);
    const privateRelay = a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
    if (privateRelay) {
      const neighbour = `${a}.${b}.${c}.${d < 254 ? d + 1 : d - 1}`;
      expect(out.stdout).toContain(`PASS: peer ${neighbour} refused`);
    }
  }, 180_000);
});
