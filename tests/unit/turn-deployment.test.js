"use strict";
/**
 * Calls audit C1 and C3: the coturn deployment.
 *
 *   C3  coturn never read TURNSHAREKEY, so every credential the API minted was
 *       refused; there was no realm, no external IP and no TLS listener.
 *   C1  with host networking and no denied peers, any credential holder could
 *       relay to 169.254.169.254 (cloud metadata) or 172.17.0.1 / 127.0.0.1
 *       (Postgres and Redis on this host).
 *   PR-4 PR-3's list also denied the relay's own public address, and its
 *       private ranges cover its own private address behind cloud NAT, so a
 *       call with BOTH callers relayed (client -> TURN -> TURN -> client) got
 *       403. The relay's own addresses are now allowed, nothing else is.
 *       TURN_LISTENING_IP binds one address, so TLS can take 443 on a second
 *       IP while nginx keeps the main one.
 *
 * The entrypoint renders coturn's config. It is run here with a stand-in
 * `turnserver` that prints the config it was handed, so the rendered file is
 * asserted exactly. tests/integration/turn-relay.test.js runs the real relay.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const ROOT = path.join(__dirname, "..", "..");
const ENTRYPOINT = path.join(ROOT, "docker", "coturn", "docker-entrypoint.sh");

function render(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-"));
  const fake = path.join(dir, "turnserver");
  // Prints the file after -c, and the file's mode, then exits.
  fs.writeFileSync(fake, '#!/bin/sh\nstat -c "MODE=%a" "$2"\ncat "$2"\n', { mode: 0o755 });
  const out = spawnSync("sh", [ENTRYPOINT], {
    env: {
      PATH: process.env.PATH,
      TURNSERVER_BIN: fake,
      TURN_CONF: path.join(dir, "turnserver.conf"),
      ...env,
    },
    encoding: "utf8",
  });
  return { status: out.status, stdout: out.stdout, stderr: out.stderr, lines: out.stdout.split("\n") };
}

const BASE = { TURN_CREDENTIAL_SECRET: "s3cret-value", TURN_REALM: "turn.example.com" };

describe("coturn entrypoint (C3: credentials coturn can verify)", () => {
  test("uses the REST scheme with the API's shared secret, and a realm", () => {
    const r = render(BASE);
    expect(r.status).toBe(0);
    expect(r.lines).toEqual(expect.arrayContaining([
      "use-auth-secret",
      "static-auth-secret=s3cret-value",
      "realm=turn.example.com",
      "fingerprint",
    ]));
    expect(r.stdout).not.toMatch(/TURNSHAREKEY/);
  });

  test("the secret is written to a file only its owner can read, not argv", () => {
    const r = render(BASE);
    expect(r.lines[0]).toBe("MODE=600");
  });

  test.each([
    [{ TURN_REALM: "turn.example.com" }, /TURN_CREDENTIAL_SECRET/],
    [{ TURN_REALM: "turn.example.com", TURN_CREDENTIAL_SECRET: "__set_me__" }, /TURN_CREDENTIAL_SECRET/],
    [{ TURN_CREDENTIAL_SECRET: "x" }, /TURN_REALM/],
    [{ ...BASE, TURN_TLS_PORT: "5349" }, /TURN_TLS_CERT/],
    [{ ...BASE, TURN_USER_QUOTA: "12; rm -rf" }, /not a number/],
    [{ ...BASE, TURN_EXTERNAL_IP: "203.0.113.7\nallow-loopback-peers" }, /not an IP address/],
    [{ ...BASE, TURN_EXTERNAL_IP: "203.0.113.7/10.0.0.5/1" }, /public\/private/],
    [{ ...BASE, TURN_LISTENING_IP: "203.0.113.8 relay-ip=0.0.0.0" }, /not an IP address/],
    [{ ...BASE, TURN_LISTENING_IP: "127.0.0.1" }, /TURN_LISTENING_IP/],
    [{ ...BASE, TURN_LISTENING_IP: "0.0.0.0" }, /TURN_LISTENING_IP/],
  ])("refuses to start when misconfigured (%#)", (env, message) => {
    const r = render(env);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(message);
  });

  test("with a public address it advertises it and allows it as a peer (relay to relay)", () => {
    const r = render({ ...BASE, TURN_EXTERNAL_IP: "203.0.113.7" });
    expect(r.lines).toEqual(expect.arrayContaining(["external-ip=203.0.113.7", "allowed-peer-ip=203.0.113.7"]));
    expect(r.lines).not.toContain("denied-peer-ip=203.0.113.7");
  });

  test("behind 1:1 cloud NAT (public/private) it allows both of its own addresses", () => {
    const r = render({ ...BASE, TURN_EXTERNAL_IP: "203.0.113.7/10.0.0.5" });
    expect(r.lines).toContain("external-ip=203.0.113.7/10.0.0.5");
    expect(r.lines.filter((l) => l.startsWith("allowed-peer-ip="))).toEqual([
      "allowed-peer-ip=203.0.113.7",
      "allowed-peer-ip=10.0.0.5",
    ]);
  });

  test("TURN_LISTENING_IP binds that one address for listening and relay, and allows it", () => {
    const r = render({ ...BASE, TURN_LISTENING_IP: "203.0.113.8" });
    expect(r.lines).toEqual(expect.arrayContaining([
      "listening-ip=203.0.113.8",
      "relay-ip=203.0.113.8",
      "allowed-peer-ip=203.0.113.8",
    ]));
  });

  test("a second IP behind NAT: listening on the private one, each own address allowed once", () => {
    const r = render({ ...BASE, TURN_EXTERNAL_IP: "203.0.113.8/10.0.0.6", TURN_LISTENING_IP: "10.0.0.6" });
    expect(r.lines).toEqual(expect.arrayContaining(["listening-ip=10.0.0.6", "relay-ip=10.0.0.6"]));
    expect(r.lines.filter((l) => l.startsWith("allowed-peer-ip="))).toEqual([
      "allowed-peer-ip=203.0.113.8",
      "allowed-peer-ip=10.0.0.6",
    ]);
  });

  test("without an address of its own to name it binds everything and allows nothing", () => {
    const r = render(BASE);
    expect(r.stdout).not.toMatch(/listening-ip|relay-ip|allowed-peer-ip|external-ip/);
  });

  test("a TLS listener for turns: when a port and certificate are given", () => {
    const r = render({ ...BASE, TURN_TLS_PORT: "5349", TURN_TLS_CERT: "/c.pem", TURN_TLS_KEY: "/k.pem" });
    expect(r.lines).toEqual(expect.arrayContaining(["tls-listening-port=5349", "cert=/c.pem", "pkey=/k.pem"]));
    expect(r.lines).not.toContain("no-tls");
  });

  test("TLS on 443 on its own IP: the listener binds only that address", () => {
    const r = render({ ...BASE, TURN_TLS_PORT: "443", TURN_TLS_CERT: "/c.pem", TURN_TLS_KEY: "/k.pem", TURN_LISTENING_IP: "203.0.113.8" });
    expect(r.lines).toEqual(expect.arrayContaining(["tls-listening-port=443", "listening-ip=203.0.113.8"]));
    expect(r.lines.filter((l) => l.startsWith("listening-ip="))).toEqual(["listening-ip=203.0.113.8"]);
  });
});

describe("coturn entrypoint (C1: the relay cannot reach private networks)", () => {
  const r = render(BASE);
  const denied = r.lines.filter((l) => l.startsWith("denied-peer-ip=")).map((l) => l.slice(15));

  test.each([
    "0.0.0.0-0.255.255.255",
    "10.0.0.0-10.255.255.255",
    "100.64.0.0-100.127.255.255",
    "127.0.0.0-127.255.255.255",
    "169.254.0.0-169.254.255.255",
    "172.16.0.0-172.31.255.255",
    "192.168.0.0-192.168.255.255",
    "::1",
    "fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
    "fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
  ])("denies %s", (range) => {
    expect(denied).toContain(range);
  });

  test("allowing its own addresses removes no deny range (metadata, bridge, loopback, private)", () => {
    const own = render({ ...BASE, TURN_EXTERNAL_IP: "203.0.113.7/10.0.0.5", TURN_LISTENING_IP: "10.0.0.5" });
    const ownDenied = own.lines.filter((l) => l.startsWith("denied-peer-ip=")).map((l) => l.slice(15));
    expect(ownDenied).toEqual(denied);
    // Exact addresses only: never a range, never loopback.
    for (const l of own.lines.filter((x) => x.startsWith("allowed-peer-ip="))) {
      const value = l.slice("allowed-peer-ip=".length);
      expect(value).toMatch(/^[0-9a-f:.]+$/i);
      expect(value).not.toMatch(/^127\.|^::1$/);
    }
    expect(own.stdout).not.toMatch(/allow-loopback-peers/);
  });

  // Every option the entrypoint may write, checked by hand against the
  // `long_options` table of coturn 4.18.0 (src/apps/relay/mainrelay.c), the
  // pinned image. coturn skips an unknown config line with a warning, so a
  // misspelt hardening option would silently not apply: add a new one here
  // only after checking it against the pinned version.
  const CHECKED_4_18 = new Set([
    "listening-port", "realm", "use-auth-secret", "static-auth-secret", "fingerprint",
    "no-multicast-peers", "no-tcp-relay", "stale-nonce", "min-port", "max-port",
    "user-quota", "total-quota", "max-bps", "log-file", "simple-log", "denied-peer-ip",
    "external-ip", "tls-listening-port", "cert", "pkey", "no-tls",
    "allowed-peer-ip", "listening-ip", "relay-ip",
  ]);

  test("every option written is one checked against the pinned coturn", () => {
    for (const env of [BASE, { ...BASE, TURN_EXTERNAL_IP: "203.0.113.7/10.0.0.5", TURN_LISTENING_IP: "10.0.0.5", TURN_TLS_PORT: "443", TURN_TLS_CERT: "/c", TURN_TLS_KEY: "/k" }]) {
      const keys = render(env).lines.filter((l) => l && !l.startsWith("MODE=")).map((l) => l.split("=")[0]);
      for (const k of keys) expect(CHECKED_4_18.has(k) ? k : `unchecked option: ${k}`).toBe(k);
    }
  });

  test("no TCP relay, no multicast peers, quotas and a bandwidth cap", () => {
    expect(r.lines).toEqual(expect.arrayContaining([
      "no-tcp-relay",
      "no-multicast-peers",
      "user-quota=12",
      "total-quota=400",
      "max-bps=64000",
    ]));
    expect(r.stdout).not.toMatch(/allow-loopback-peers/);
  });
});

describe("docker-compose `turn` service", () => {
  const compose = yaml.load(fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8"));
  const turn = compose.services.turn;

  test("runs the entrypoint, not coturn's bare flags", () => {
    expect(turn.entrypoint).toEqual(["/bin/sh", "/usr/local/bin/praxis-turn-entrypoint.sh"]);
    expect(turn.volumes).toContain("./docker/coturn/docker-entrypoint.sh:/usr/local/bin/praxis-turn-entrypoint.sh:ro");
    expect(turn.command).toBeUndefined();
    expect(JSON.stringify(turn.environment)).not.toMatch(/TURNSHAREKEY/);
  });

  test("the image is pinned by version and digest", () => {
    expect(turn.image).toMatch(/^coturn\/coturn:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  });

  test("the health check makes a real allocation, on the listening IP when one is set", () => {
    const check = turn.healthcheck.test.join(" ");
    expect(check).toMatch(/turnutils_uclient -W/);
    expect(check).toContain('-c "$${TURN_LISTENING_IP:-127.0.0.1}"');
    expect(turn.environment.TURN_LISTENING_IP).toBe("${TURN_LISTENING_IP:-}");
  });

  test("every variable the service reads is in env.js", () => {
    const envSrc = fs.readFileSync(path.join(ROOT, "src", "config", "env.js"), "utf8");
    for (const key of Object.keys(turn.environment)) {
      expect(envSrc).toMatch(new RegExp(`\\n\\s+${key}:`));
    }
  });
});

describe("scripts/turn-setup.sh (the one-time production setup), .env half", () => {
  const SETUP = path.join(ROOT, "scripts", "turn-setup.sh");
  function run(dir, args) {
    return spawnSync("sh", [SETUP, ...args, "--env-only"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH } });
  }
  const envOf = (dir) => Object.fromEntries(fs.readFileSync(path.join(dir, ".env"), "utf8").split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

  test("generates the shared secret once, and never rotates an existing one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-setup-"));
    fs.copyFileSync(path.join(ROOT, ".env.example"), path.join(dir, ".env"));
    expect(run(dir, ["--host", "turn.example.com"]).status).toBe(0);
    const first = envOf(dir);
    expect(first.TURN_CREDENTIAL_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(first.TURN_HOST).toBe("turn.example.com");
    expect(first.TURN_REALM).toBe("turn.example.com");
    expect(run(dir, ["--host", "turn.example.com"]).status).toBe(0);
    expect(envOf(dir).TURN_CREDENTIAL_SECRET).toBe(first.TURN_CREDENTIAL_SECRET);
    expect(fs.readdirSync(dir).some((f) => f.startsWith(".env.bak-turn-"))).toBe(true);
  });

  test("TLS defaults to 5349 (443 is nginx's) with paths as seen inside the relay", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-setup-"));
    fs.writeFileSync(path.join(dir, ".env"), "TURN_CREDENTIAL_SECRET=__set_me__\n");
    expect(run(dir, ["--host", "turn.example.com", "--tls-from", "/etc/letsencrypt/live/turn.example.com"]).status).toBe(0);
    expect(envOf(dir)).toEqual(expect.objectContaining({
      TURN_TLS_PORT: "5349", TURN_TLS_DIR: "/etc/praxis/turn-tls",
      TURN_TLS_CERT: "/etc/turn-tls/fullchain.pem", TURN_TLS_KEY: "/etc/turn-tls/privkey.pem",
    }));
  });

  test("refuses a host that is not a hostname", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-setup-"));
    fs.writeFileSync(path.join(dir, ".env"), "\n");
    const out = run(dir, ["--host", "turn.example.com;reboot"]);
    expect(out.status).toBe(1);
    expect(out.stderr).toMatch(/not a hostname/);
  });

  describe("TLS on 443 on an IP of its own (--listening-ip)", () => {
    /** A bin dir with stand-ins for `ss` (the given listeners) and, optionally, `nginx`. */
    function fakeBin(listeners, { nginx = false } = {}) {
      const bin = fs.mkdtempSync(path.join(os.tmpdir(), "turn-bin-"));
      const rows = listeners.map(([local, proc]) => `LISTEN 0 511 ${local} 0.0.0.0:* users:(("${proc}",pid=1,fd=6))`);
      fs.writeFileSync(path.join(bin, "ss"), `#!/bin/sh\ncat <<'ROWS'\n${rows.join("\n")}\nROWS\n`, { mode: 0o755 });
      if (nginx) fs.writeFileSync(path.join(bin, "nginx"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      return bin;
    }
    function runWith(bin, args) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-setup-"));
      fs.writeFileSync(path.join(dir, ".env"), "TURN_CREDENTIAL_SECRET=__set_me__\n");
      const out = spawnSync("sh", [SETUP, "--host", "turn.example.com", ...args, "--env-only"], {
        cwd: dir, encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}` },
      });
      return { ...out, dir };
    }
    const TLS = ["--tls-from", "/etc/letsencrypt/live/turn.example.com", "--tls-port", "443"];

    test("writes TURN_LISTENING_IP and the 443 TLS settings", () => {
      const out = runWith(fakeBin([["203.0.113.7:443", "nginx"]]), [...TLS, "--listening-ip", "203.0.113.8"]);
      expect(out.status).toBe(0);
      expect(envOf(out.dir)).toEqual(expect.objectContaining({ TURN_LISTENING_IP: "203.0.113.8", TURN_TLS_PORT: "443" }));
    });

    test.each([
      ["nginx on the same IP", [["203.0.113.8:443", "nginx"]]],
      ["nginx on every IPv4 address (plain `listen 443`)", [["0.0.0.0:443", "nginx"]]],
      ["a dual-stack wildcard", [["*:443", "nginx"]]],
    ])("fails before changing anything when 443 is taken on that IP: %s", (_label, listeners) => {
      const out = runWith(fakeBin(listeners), [...TLS, "--listening-ip", "203.0.113.8"]);
      expect(out.status).toBe(1);
      expect(out.stderr).toMatch(/TCP port 443 is already taken on 203\.0\.113\.8/);
      expect(out.stderr).toMatch(/listen <main-ip>:443/);
      expect(fs.readFileSync(path.join(out.dir, ".env"), "utf8")).not.toMatch(/TURN_LISTENING_IP/);
    });

    test("an IPv6-only listener, another IP, another port or coturn itself is not a clash", () => {
      const out = runWith(fakeBin([
        ["[::]:443", "nginx"], ["203.0.113.7:443", "nginx"], ["203.0.113.8:80", "nginx"], ["203.0.113.8:443", "turnserver"],
      ]), [...TLS, "--listening-ip", "203.0.113.8"]);
      expect(out.status).toBe(0);
    });

    test("without --listening-ip, any listener on the TLS port is a clash", () => {
      const out = runWith(fakeBin([["203.0.113.7:443", "nginx"]]), TLS);
      expect(out.status).toBe(1);
      expect(out.stderr).toMatch(/TCP port 443 is already taken on this host/);
    });

    test("warns about nginx on 443 only when nginx is here and no IP of its own is given", () => {
      const warned = runWith(fakeBin([], { nginx: true }), TLS);
      expect(warned.stderr).toMatch(/nginx is on this host and holds 443/);
      const ownIp = runWith(fakeBin([], { nginx: true }), [...TLS, "--listening-ip", "203.0.113.8"]);
      expect(ownIp.stderr).not.toMatch(/nginx is on this host/);
      expect(ownIp.status).toBe(0);
      if (spawnSync("sh", ["-c", "command -v nginx || pgrep -x nginx"]).status !== 0) {
        expect(runWith(fakeBin([]), TLS).stderr).not.toMatch(/nginx is on this host/);
      }
    });

    test("refuses an --listening-ip or --external-ip that is not an address", () => {
      expect(runWith(fakeBin([]), ["--listening-ip", "203.0.113.8;reboot"]).stderr).toMatch(/not an IP address/);
      expect(runWith(fakeBin([]), ["--external-ip", "203.0.113.8 x"]).stderr).toMatch(/not 'public' or 'public\/private'/);
    });

    test("a re-run keeps the listening IP already in .env", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-setup-"));
      fs.writeFileSync(path.join(dir, ".env"), "TURN_CREDENTIAL_SECRET=__set_me__\nTURN_LISTENING_IP=203.0.113.8\n");
      const out = spawnSync("sh", [SETUP, "--host", "turn.example.com", ...TLS, "--env-only"], {
        cwd: dir, encoding: "utf8", env: { PATH: `${fakeBin([["203.0.113.7:443", "nginx"]])}:${process.env.PATH}` },
      });
      expect(out.status).toBe(0);
      expect(envOf(dir).TURN_LISTENING_IP).toBe("203.0.113.8");
    });

    test("--external-ip public/private is written as given", () => {
      const out = runWith(fakeBin([]), ["--external-ip", "203.0.113.7/10.0.0.5"]);
      expect(out.status).toBe(0);
      expect(envOf(out.dir).TURN_EXTERNAL_IP).toBe("203.0.113.7/10.0.0.5");
    });
  });
});

describe("scripts/turn-check.sh knows the relay's own addresses", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "turn-check.sh"), "utf8");

  test("checks relay to relay with two allocations (-y)", () => {
    expect(src).toMatch(/turnutils_uclient|UCLIENT/);
    expect(src).toMatch(/-y -n 1 -m 1/);
    expect(src).toMatch(/pass "relay to relay/);
  });

  test("defaults to the listening IP, and probes its own private address's neighbour", () => {
    expect(src).toContain('HOST="${1:-${TURN_LISTENING_IP:-127.0.0.1}}"');
    expect(src).toMatch(/neighbours/);
  });
});
