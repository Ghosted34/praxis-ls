"use strict";

/**
 * The call relay, half in the vault and half on the host.
 *
 * `.env` holds thirteen TURN_* variables, read by two different programs. The
 * API reads the host, ports and transports to build the `iceServers` array a
 * browser is handed — a description, which can live in a database. coturn
 * reads the realm, the IPs, the certificate paths and the port range from a
 * file it renders once at start — bindings, which a console cannot change.
 *
 * These tests hold that line. The interesting cases are not "the vault wins"
 * but the three where it must NOT:
 *
 *   - the TLS and UDP ports, because they are coturn's listeners as well as
 *     part of the URL we advertise, and a settable copy would let the console
 *     advertise a port nothing is listening on;
 *   - the shared secret, because the API signs with it and coturn verifies
 *     with it;
 *   - anything at all when the vault is unreachable, because a platform-DB
 *     hiccup must not take calls down.
 */

jest.mock("../../src/config/env", () => {
  const real = jest.requireActual("../../src/config/env");
  return { ...real, config: { ...real.config } };
});
const mockResolve = jest.fn(async () => null);
jest.mock("../../src/services/platform/settings.service", () => ({ resolve: mockResolve }));

const { config } = require("../../src/config/env");
const runtime = require("../../src/services/platform/runtime-config.service");
const turnService = require("../../src/modules/smartcomm/smartcomm.turn.service");

const ENV_KEYS = [
  "STUN_URLS", "TURN_HOST", "TURN_CREDENTIAL_SECRET", "TURN_PORT_UDP", "TURN_PORT_TCP",
  "TURN_TRANSPORTS", "TURN_TLS_PORT", "TURN_REALM", "TURN_EXTERNAL_IP", "TURN_LISTENING_IP",
];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, config[k]]));

/** The host's `.env`, as a deployment that has been through turn-setup.sh. */
function onHost(overrides = {}) {
  Object.assign(config, {
    STUN_URLS: "",
    TURN_HOST: "turn.host.example",
    TURN_CREDENTIAL_SECRET: "host-secret",
    TURN_PORT_UDP: 3478,
    TURN_PORT_TCP: 3478,
    TURN_TRANSPORTS: "udp,tcp",
    TURN_TLS_PORT: 5349,
    TURN_REALM: "turn.host.example",
    TURN_EXTERNAL_IP: "203.0.113.7/10.0.0.5",
    TURN_LISTENING_IP: "",
  }, overrides);
}

/** A saved console row. */
const inVault = (value) => mockResolve.mockResolvedValue({ value, secret: null });

beforeEach(() => {
  onHost();
  mockResolve.mockReset().mockResolvedValue(null);
  runtime.invalidate();
});
afterEach(() => {
  Object.assign(config, saved);
  runtime.invalidate();
});

describe("what the console may set", () => {
  it("falls back to the host's .env when nothing is saved", async () => {
    const relay = await runtime.turn();
    expect(relay.host).toBe("turn.host.example");
    expect(relay.source).toBe("env");
    expect(relay.configured).toBe(true);
  });

  it("prefers the saved host over the host's .env", async () => {
    inVault({ host: "turn.console.example" });
    const relay = await runtime.turn();
    expect(relay.host).toBe("turn.console.example");
    expect(relay.source).toBe("vault");
  });

  it("carries the saved host into the URLs a browser is handed", async () => {
    inVault({ host: "turn.console.example" });
    const ice = turnService.iceConfigFor({ token: "t", ttlSeconds: 120, relay: await runtime.turn() });
    const urls = ice.iceServers.flatMap((s) => s.urls);
    expect(urls.some((u) => u.includes("turn.console.example"))).toBe(true);
    expect(urls.some((u) => u.includes("turn.host.example"))).toBe(false);
  });

  it("takes the advertised TCP port, transports and STUN list", async () => {
    inVault({ port_tcp: 5349, transports: "tcp", stun_urls: "stun:a.example:3478" });
    const relay = await runtime.turn();
    expect(relay.portTcp).toBe(5349);
    expect(relay.transports).toBe("tcp");
    const ice = turnService.iceConfigFor({ token: "t", ttlSeconds: 120, relay });
    expect(ice.iceServers[0]).toEqual({ urls: ["stun:a.example:3478"] });
    // transports: "tcp" means no udp URL at all.
    const turns = ice.iceServers.flatMap((s) => s.urls).filter((u) => u.startsWith("turn:"));
    expect(turns).toEqual(["turn:turn.host.example:5349?transport=tcp"]);
  });
});

describe("what the console may NOT set, whatever is in the row", () => {
  /**
   * The one that would break production quietly: coturn binds the TLS port at
   * start, so a console value would advertise `turns:host:443` while the relay
   * still listens on 5349 and the firewall still drops 443.
   */
  it("ignores a TLS port in the vault — that is coturn's listener", async () => {
    inVault({ tls_port: 443 });
    const relay = await runtime.turn();
    expect(relay.tlsPort).toBe(5349);
    const ice = turnService.iceConfigFor({ token: "t", ttlSeconds: 120, relay });
    expect(ice.iceServers.flatMap((s) => s.urls)).toContain("turns:turn.host.example:5349?transport=tcp");
  });

  it("ignores a UDP port in the vault — also a listener", async () => {
    inVault({ port_udp: 9999 });
    expect((await runtime.turn()).portUdp).toBe(3478);
  });

  /**
   * The secret is not on this object at all. It is a description of the
   * relay — passed around, returned to callers, shaped into a console
   * response — and the one value that must not leak has no business riding
   * along on it. Whoever signs fetches it at the point of signing.
   */
  it("never carries the secret itself, only whether one exists", async () => {
    mockResolve.mockResolvedValue({ value: { secret: "from-the-console" }, secret: "from-the-console" });
    const relay = await runtime.turn();
    expect(relay.secret).toBeUndefined();
    expect(relay.secretSet).toBe(true);
    expect(JSON.stringify(relay)).not.toMatch(/host-secret|from-the-console/);
  });
});

describe("the host-owned half, for display only", () => {
  it("reports what coturn was started with", () => {
    expect(runtime.turnHostOwned()).toEqual({
      realm: "turn.host.example",
      external_ip: "203.0.113.7/10.0.0.5",
      listening_ip: "",
      port_udp: 3478,
      tls_port: 5349,
      secret_set: true,
    });
  });

  it("says whether a secret exists without ever carrying it", () => {
    config.TURN_CREDENTIAL_SECRET = "";
    const out = runtime.turnHostOwned();
    expect(out.secret_set).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/host-secret/);
  });
});

describe("a relay is only configured when both halves are", () => {
  it("is not configured with a host and no secret", async () => {
    config.TURN_CREDENTIAL_SECRET = "";
    expect((await runtime.turn()).configured).toBe(false);
  });

  it("is not configured with a secret and no host", async () => {
    config.TURN_HOST = "";
    expect((await runtime.turn()).configured).toBe(false);
  });
});

describe("a vault that cannot be read", () => {
  /**
   * The platform database is not on the call path and must not become so: a
   * hiccup there costs the console its edits, never the deployment its calls.
   */
  it("degrades to the host's .env rather than losing the relay", async () => {
    mockResolve.mockRejectedValue(new Error("platform db is down"));
    const relay = await runtime.turn();
    expect(relay.host).toBe("turn.host.example");
    expect(relay.configured).toBe(true);
    expect(relay.source).toBe("env");
  });
});

/**
 * These four values are assembled into the `iceServers` URLs handed to every
 * caller's browser, so a bad one is not a bad field — it is an ICE server
 * nobody can reach, on every call, surfacing as "calls do not connect" rather
 * than as anything about this form. The generic platform-setting validator
 * accepts any object, which is right for a store that holds nine unrelated
 * credentials; this shape needs its own check.
 */
describe("what the console refuses to save", () => {
  // The REAL service: this file mocks it for the vault reads above, and the
  // validation under test is the real module's.
  const settings = jest.requireActual("../../src/services/platform/settings.service");
  const put = (value) => settings.put({ section: "network", key: "turn", value });

  it.each([
    ["a scheme in the host", { host: "turn:turn.example.com" }],
    ["a port in the host", { host: "turn.example.com:3478" }],
    ["a URL in the host", { host: "https://turn.example.com/" }],
    ["a port out of range", { host: "turn.example.com", port_tcp: 70000 }],
    ["a port that is not a number", { host: "turn.example.com", port_tcp: "soon" }],
    ["a transport that is not udp or tcp", { transports: "udp,quic" }],
    ["a STUN entry with no scheme", { stun_urls: "a.example:3478" }],
  ])("refuses %s with a 422", async (_label, value) => {
    await expect(put(value)).rejects.toMatchObject({ status: 422 });
  });

  it("accepts the shape turn-setup.sh produces", () => {
    const rule = settings._test.valueRules["network.turn"];
    expect(rule({ host: "turn.example.com", port_tcp: 3478, transports: "udp,tcp", stun_urls: "stun:turn.example.com:3478" })).toBeNull();
    // An empty form is a deployment that has not been configured yet, not an error.
    expect(rule({})).toBeNull();
  });
});

/**
 * `/settings/:section/:key` puts two URL segments into a map lookup whose
 * result is then CALLED. A plain object literal inherits Object.prototype,
 * so a lookup finding nothing of ours could still hand back a function —
 * `constructor`, `toString`, `valueOf`. Nothing reachable produces one
 * today only because `specKey` always inserts a dot and no prototype member
 * contains one, which is an accident of that helper rather than a check.
 *
 * CodeQL flagged the shape (js/unvalidated-dynamic-method-call) and was
 * right to: it would stop being true the moment anyone joined the id
 * upstream. These pin the own-property test that replaced the accident.
 */
describe("a settings name from the URL cannot reach Object.prototype", () => {
  const settings = jest.requireActual("../../src/services/platform/settings.service");

  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"])(
    "%s is not a settable or testable setting",
    async (inherited) => {
      // Neither half of the pair, nor a pre-joined id, may find an inherited
      // member — and `test()` must answer "no test available", not invoke it.
      const out = await settings.test(inherited, inherited);
      expect(out).toMatchObject({ ok: false });
      expect(String(out.error)).toMatch(/no test available/);
    },
  );

  it("returns null for an inherited name rather than a callable", () => {
    const { lookupSpec, spec, valueRulesById } = settings._test;
    for (const inherited of ["constructor", "toString", "valueOf", "__proto__"]) {
      expect(lookupSpec(spec, inherited, inherited)).toBeNull();
      expect(lookupSpec(valueRulesById, inherited, inherited)).toBeNull();
      // And with the id pre-joined, which is the shape that would break the
      // dot-always-present accident this replaced.
      expect(lookupSpec(spec, inherited, "")).toBeNull();
    }
  });

  it("has no inherited string keys to reach in the first place", () => {
    // The point of a Map over an object literal: there is no prototype chain
    // for a URL-supplied name to walk.
    const { spec, valueRulesById } = settings._test;
    for (const registry of [spec, valueRulesById]) {
      expect(registry).toBeInstanceOf(Map);
      expect(registry.get("constructor")).toBeUndefined();
      expect(registry.get("toString")).toBeUndefined();
    }
  });

  it("still finds a real entry, so the fix is not a blanket no", () => {
    const { lookupSpec, spec, valueRulesById } = settings._test;
    expect(lookupSpec(spec, "network", "turn")).toBeTruthy();
    expect(typeof lookupSpec(valueRulesById, "network", "turn")).toBe("function");
  });
});
