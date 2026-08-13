"use strict";

/**
 * Error Command Center — the behaviour that cannot be checked by reading it.
 *
 * doc/TESTING_ErrorMonitor_Module.md §3 carried these as `node -e` one-liners
 * and §7 listed "no Jest specs" as the outstanding gap. A verification
 * procedure that lives in a markdown file is one nobody runs on a Tuesday, and
 * the invariants below are precisely the kind that break silently: nothing
 * throws, nothing 500s, the dashboard simply starts lying.
 *
 * Four properties are load-bearing, in descending order of how quietly they
 * fail:
 *
 *   1. COUNTING IS NOT DEDUPED. The reporter suppresses repeat notifications
 *      for five minutes. If persistence inherited that, occurrence_count would
 *      undercount by everything inside the window, and since every escalation
 *      threshold reads that column, every rule in §5 would silently never fire.
 *   2. SCRUBBING HAPPENS BEFORE EVERYTHING. Not just before the database —
 *      before the fingerprint, the webhook and the AI prompt too.
 *   3. THE DELAY CLOCK ARMS AND DISARMS. A rule with a delay must not fire on
 *      the first sweep, must fire once the delay elapses, and must forget
 *      entirely if the condition clears in between.
 *   4. COALESCING. A hot loop must cost one statement, not forty thousand.
 */

const store = require("../../src/shared/observability/error-store");
const reporter = require("../../src/shared/observability/error-reporter");
const { parseStack } = require("../../src/shared/observability/stack-parse");
const {
  scrub,
  scrubObject,
  luhnValid,
} = require("../../src/shared/observability/scrub");
const shareSvc = require("../../src/services/platform/error-share.service");
const {
  QUERY_SCHEMAS,
  BODY_SCHEMAS,
} = require("../../src/modules/platform/errors/errors.validator");

/** The store's UPSERT puts the batch count at index 16. */
const COUNT_PARAM = 16;
const SIG_PARAM = 1;

const mkPayload = (message, extra = {}) => ({
  fingerprint: `E|${message}`,
  message,
  severity: "error",
  origin: "server",
  ts: new Date().toISOString(),
  stack: `Error: ${message}\n    at f (/app/src/modules/x/y.js:1:1)`,
  ...extra,
});

afterEach(() => store.__reset());

// ───────────────────────────────────────────────────────────────────────────
describe("stack parsing — criterion #2, exact module and line", () => {
  it("picks the first application frame, not the vendor one", () => {
    const { primary, frames } = parseStack(
      [
        "TypeError: x",
        "    at createShipment (/app/src/modules/logistics/shipments/shipment.service.js:89:14)",
        "    at async assignDriver (/app/src/modules/logistics/shipments/shipment.controller.js:142:5)",
        "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
      ].join("\n"),
    );

    expect(primary.module).toBe("shipments");
    expect(primary.file).toBe(
      "src/modules/logistics/shipments/shipment.service.js",
    );
    expect(primary.line).toBe(89);
    // node_modules frames are still KEPT — they are diagnostic — but flagged so
    // the drawer can fold them and so `primary` never lands inside express.
    expect(frames[2].vendor).toBe(true);
  });

  it("handles Firefox/Safari fn@url stacks", () => {
    const { primary } = parseStack(
      "doThing@https://app.praxisls.com/assets/main-a1b2.js:12:34",
    );
    expect(primary).not.toBeNull();
    expect(primary.line).toBe(12);
  });

  it("returns an empty result rather than throwing on null", () => {
    expect(parseStack(null)).toEqual({ frames: [], primary: null });
  });

  /**
   * ReDoS guard — CodeQL "polynomial regular expression used on uncontrolled
   * data", High, four sites.
   *
   * `POST /api/client-errors` is unauthenticated by design (a crashed page has
   * no token to present), so `stack` is attacker-controlled. The old regexes
   * paired a lazy `.+?` with an adjacent `\s+`/`@`, which is O(n²) on crafted
   * whitespace — quadratic work, 30 times a minute, on the single-threaded
   * event loop, arriving through the very path that exists to survive an
   * incident.
   *
   * A timing assertion is a blunt instrument and normally a flake risk. Here it
   * is the only thing that actually fails if someone reintroduces a lazy
   * quantifier: the parse is CORRECT either way, just catastrophically slower.
   * The threshold is ~100x the linear cost, so it cannot trip on a slow runner.
   */
  it("parses adversarial input in linear time", () => {
    const attacks = [
      `at ${" ".repeat(8000)}`,
      `at a${" ".repeat(8000)}`,
      `at a (${"a (".repeat(3000)}`,
      `${"@".repeat(8000)}`,
      `${"a@".repeat(4000)}`,
      `${" ".repeat(8000)}@`,
      `at ${"x".repeat(4000)}:1:${"9".repeat(2000)}`,
      `${":".repeat(8000)}`,
    ];

    const t0 = process.hrtime.bigint();
    for (const a of attacks) expect(() => parseStack(a)).not.toThrow();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;

    // The old V8_NAMED regex took seconds on the third case alone.
    expect(ms).toBeLessThan(250);
  });

  it("still parses every real shape after the rewrite", () => {
    // The linear parser must not have narrowed what it accepts. `Object.<anonymous>`
    // matters: a function name containing parens is why the location is taken
    // from the LAST '(' rather than the first.
    const cases = [
      [
        "    at fn (/app/src/modules/x/y.js:12:3)",
        "fn",
        "src/modules/x/y.js",
        12,
      ],
      [
        "    at async fn (/app/src/modules/x/y.js:12:3)",
        "fn",
        "src/modules/x/y.js",
        12,
      ],
      [
        "    at /app/src/modules/x/y.js:12:3",
        "(anonymous)",
        "src/modules/x/y.js",
        12,
      ],
      [
        "    at Object.<anonymous> (/app/src/a.js:1:2)",
        "Object.<anonymous>",
        "src/a.js",
        1,
      ],
      [
        "fn@https://app.praxisls.com/assets/main.js:12:34",
        "fn",
        "assets/main.js",
        12,
      ],
      [
        "@https://app.praxisls.com/assets/main.js:9:1",
        "(anonymous)",
        "assets/main.js",
        9,
      ],
    ];

    for (const [raw, fn, file, line] of cases) {
      const { frames } = parseStack(`Error: x\n${raw}`);
      expect(frames).toHaveLength(1);
      expect(frames[0].function).toBe(fn);
      expect(frames[0].file).toBe(file);
      expect(frames[0].line).toBe(line);
    }
  });

  it("rejects a frame with no position rather than inventing one", () => {
    expect(
      parseStack("Error: x\n    at fn (/app/src/a.js)").frames,
    ).toHaveLength(0);
    expect(
      parseStack("Error: x\n    at fn (/app/src/a.js:notanumber:2)").frames,
    ).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("error-store — coalescing", () => {
  it("turns a hot loop into one statement carrying its own count", async () => {
    const calls = [];
    store.__setQuery(async (_q, p) => {
      calls.push(p);
      return { rows: [] };
    });

    for (let i = 0; i < 5000; i += 1) store.persist(mkPayload("hot"));
    store.persist(mkPayload("other"));
    await store.flush();

    expect(calls).toHaveLength(2);
    const hot = calls.find((c) => c[SIG_PARAM] === "E|hot");
    expect(hot[COUNT_PARAM]).toBe(5000);
  });

  /**
   * Spec §10: "< 500ms from backend log to UI render".
   *
   * The broadcast to the console rides `flush()` — `onPersist` fires after the
   * UPSERT — so the flush window IS the realtime latency. A 2s window missed the
   * budget on every error, and the spec is immutable, so the window had to move
   * rather than the number.
   *
   * These assert the two halves of that change together, because either alone is
   * a regression: fast first sighting, and a hot loop that still costs one
   * statement.
   */
  it("flushes a FIRST sighting on the leading edge — spec §10's 500ms", async () => {
    const at = [];
    store.__setQuery(async () => {
      at.push(Date.now());
      return { rows: [] };
    });

    const t0 = Date.now();
    store.persist(mkPayload("brand-new"));
    await new Promise((r) => setTimeout(r, store.LEADING_MS + 120));

    expect(at).toHaveLength(1);
    // Budget is 500ms end to end; the write itself is the remaining slack.
    expect(at[0] - t0).toBeLessThan(500);
  });

  it("still coalesces repeats — the leading edge must not undo the storm guard", async () => {
    const calls = [];
    store.__setQuery(async (_q, p) => {
      calls.push(p);
      return { rows: [] };
    });

    // One new signature, then 4,999 repeats of it arriving in the same tick.
    for (let i = 0; i < 5000; i += 1) store.persist(mkPayload("hot"));
    await new Promise((r) => setTimeout(r, store.LEADING_MS + 120));

    expect(calls).toHaveLength(1);
    expect(calls[0][COUNT_PARAM]).toBe(5000);
  });

  it("batches a storm of DISTINCT signatures into one flush", async () => {
    // The failure mode the 250ms floor prevents: 150 different errors arriving
    // at once each buying their own immediate flush, 250ms apart, so the last
    // one lands 37 seconds late.
    //
    // 150 distinct signatures legitimately need 150 UPSERTs — there is no
    // multi-row form of this statement — so counting STATEMENTS proves nothing.
    // The property that matters is that they all happened in ONE flush cycle,
    // which is what the timestamp spread shows.
    const at = [];
    store.__setQuery(async () => {
      at.push(Date.now());
      return { rows: [] };
    });

    for (let i = 0; i < 150; i += 1) store.persist(mkPayload(`distinct-${i}`));
    await new Promise((r) => setTimeout(r, store.LEADING_MS + 200));

    expect(at).toHaveLength(150);
    // One batch: had each armed its own leading edge, the spread would be
    // 150 × 250ms. Sequential awaits inside one flush are milliseconds apart.
    expect(at[at.length - 1] - at[0]).toBeLessThan(store.LEADING_MS);
  });

  /**
   * `Module: assets` — the useless label every browser error carried.
   *
   * `moduleOf()` looks for a `modules/`/`services/`/`jobs/` anchor. A production
   * bundle has none, so it fell to the parent directory and §3.4's module filter
   * had ONE bucket holding the entire client.
   */
  describe("module attribution for browser bundles", () => {
    const MODULE_PARAM = 8;

    /** persist one payload, flush, return the module column. */
    async function moduleFor(payload) {
      const rows = [];
      store.__reset();
      store.__setQuery(async (_q, p) => {
        rows.push(p);
        return { rows: [] };
      });
      store.persist({
        fingerprint: `f-${Math.random()}`,
        message: "m",
        severity: "error",
        ts: new Date().toISOString(),
        ...payload,
      });
      await store.flush();
      return rows[0][MODULE_PARAM];
    }

    it("names the feature from the chunk, hash stripped", async () => {
      // The bounded {6,12} + `$` is what stops the hash's own hyphen
      // (`Cn8-yJdR`) swallowing `-data-page` with it.
      expect(
        await moduleFor({
          origin: "browser",
          route: "/master/suppliers",
          stack:
            "E\n    at Dt (https://x/assets/master-data-page-Cn8-yJdR.js:1:1)",
        }),
      ).toBe("master-data-page");
    });

    it("prefers the route over a generic chunk name", async () => {
      // "vendor" is true and useless: an exception inside React internals is
      // ABOUT the page that rendered them.
      expect(
        await moduleFor({
          origin: "browser",
          route: "/master/clients",
          stack: "E\n    at Vp (https://x/assets/vendor-Dx6jc4-T.js:38:1)",
        }),
      ).toBe("master");
    });

    it("falls back to the route when there are no frames at all", async () => {
      // A failed ServiceWorker update parses to zero frames — "No parsed frames
      // for this error" in the drawer — and still has a route.
      expect(
        await moduleFor({
          origin: "browser",
          route: "/master/clients",
          stack: null,
        }),
      ).toBe("master");
    });

    it("does NOT override a source-mapped stack", async () => {
      // Shipping source maps must make attribution better, not worse: a real
      // `src/...` path is what moduleOf is for.
      expect(
        await moduleFor({
          origin: "browser",
          route: "/master/x",
          stack:
            "E\n    at f (/app/src/features/masterdata/party-360.tsx:12:3)",
        }),
      ).toBe("masterdata");
    });

    it("leaves server errors alone", async () => {
      expect(
        await moduleFor({
          origin: "server",
          route: "GET /api/x",
          stack: "E\n    at f (/app/src/modules/logistics/shipments/a.js:1:1)",
        }),
      ).toBe("shipments");
    });

    it("returns null rather than guessing when there is nothing to go on", async () => {
      expect(await moduleFor({ origin: "browser", stack: null })).toBeNull();
    });
  });

  it("keeps tenants apart — one row per (tenant, signature), not per signature", async () => {
    // The buffer's key must agree with the UPSERT's conflict target,
    // `(COALESCE(tenant_id, zero-uuid), signature)`. Keyed on signature alone,
    // two tenants hitting the same fault in one flush window merged into ONE
    // statement carrying the first tenant's slug and BOTH counts — one tenant's
    // incident filed under another's name, with an inflated number.
    //
    // Unreachable until browser errors gained a real tenant: everything used to
    // arrive as tenant-null, so there was only ever one bucket.
    const rows = [];
    store.__setQuery(async (_q, p) => {
      rows.push(p);
      return { rows: [] };
    });

    const same = (tenant) => ({ ...mkPayload("shared-bug"), tenant });
    store.persist(same("smartls"));
    store.persist(same("acme"));
    store.persist(same("smartls"));
    store.persist(same(null)); // platform-wide
    await store.flush();

    expect(rows).toHaveLength(3);
    const byTenant = Object.fromEntries(
      rows.map((r) => [String(r[0]), r[COUNT_PARAM]]),
    );
    expect(byTenant).toEqual({ smartls: 2, acme: 1, null: 1 });
  });

  it("does not let one failing row discard the rest of the batch", async () => {
    const seen = [];
    store.__setQuery(async (_q, p) => {
      if (p[SIG_PARAM] === "E|bad") throw new Error("constraint violation");
      seen.push(p[SIG_PARAM]);
      return { rows: [] };
    });

    store.persist(mkPayload("good-1"));
    store.persist(mkPayload("bad"));
    store.persist(mkPayload("good-2"));
    await store.flush();

    expect(seen).toEqual(expect.arrayContaining(["E|good-1", "E|good-2"]));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("the invariant — notification is deduped, counting is not", () => {
  it("suppresses 49 of 50 notifications while persisting all 50", async () => {
    // NO jest.resetModules() here, and that is load-bearing rather than an
    // oversight. The reporter requires error-store at module scope; resetting
    // the registry would hand it a SECOND store instance, and the one this test
    // configured with __setQuery would sit there recording nothing while the
    // assertion read zero. `__reset()` clears the state without breaking the
    // identity the two modules share.
    let persisted = 0;
    store.__reset();
    store.__setQuery(async (_q, p) => {
      persisted += p[COUNT_PARAM];
      return { rows: [] };
    });
    reporter.__reset();

    const err = new Error("same");
    err.stack = "Error: same\n    at f (/app/src/modules/x/y.js:1:1)";

    const results = await Promise.all(
      Array.from({ length: 50 }, () => reporter.report(err)),
    );
    await store.flush();

    expect(results.filter((r) => r.reason === "deduped")).toHaveLength(49);
    // If this ever reads 1, every escalation threshold in §5 is dead.
    expect(persisted).toBe(50);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("scrubbing — spec §11, no PII in storage", () => {
  it("redacts an email but keeps the shape of the message", () => {
    const out = scrub(
      'duplicate key value violates unique constraint "user_email_key" Key (email)=(marie@client.cm) already exists.',
    );
    expect(out).not.toContain("marie@client.cm");
    expect(out).toContain("<email>");
    // The diagnostic half must survive, or the feed is unusable and gets ignored.
    expect(out).toContain("user_email_key");
  });

  it("strips credentials from a connection string but keeps the host", () => {
    // `user:pass` rather than a realistic-looking credential ON PURPOSE.
    //
    // The CI secret scan matches `scheme://user:password@` and this line would
    // otherwise fail it — correctly, since a scanner cannot tell a documentation
    // example from a leak. `user:pass` is one of the shapes its PLACEHOLDER
    // allow-list recognises, so the example stays readable without punching a
    // hole in the scanner. Widening the scanner instead would be the wrong fix:
    // "every entry is a hole", per its own comment.
    const out = scrub(
      "connect ECONNREFUSED postgres://user:pass@10.0.0.4:5432/tenant_x",
    );
    expect(out).toContain("<credentials>@10.0.0.4:5432/tenant_x");
    expect(out).not.toContain("user:pass");
  });

  it("redacts bearer tokens and JWTs", () => {
    expect(
      scrub("401 (Authorization: Bearer abcdef0123456789abcdef)"),
    ).toContain("Bearer <token>");
    expect(
      scrub(
        "rejected eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      ),
    ).toContain("<jwt>");
  });

  it("redacts the key names the logger already treats as sensitive", () => {
    expect(
      scrub('failed with {"password":"hunter2","api_key":"live_9f8e7d"}'),
    ).not.toContain("hunter2");
    expect(scrub("?refresh_token=abcdefghijkl&page=2")).toContain("<redacted>");
    // The rest of the query string is untouched — it is how you reproduce the bug.
    expect(scrub("?refresh_token=abcdefghijkl&page=2")).toContain("page=2");
  });

  it("leaves file paths, line numbers and uuids alone", () => {
    const stack =
      "at createShipment (/app/src/modules/logistics/shipment.service.js:89:14)";
    expect(scrub(stack)).toBe(stack);
    const msg = "shipment 41f2c0de-1111-2222-3333-444455556666 not found";
    expect(scrub(msg)).toBe(msg);
  });

  it("redacts a Luhn-valid card but not a same-length id", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(scrub("charge failed for 4242424242424242")).toContain("<card>");
    // A 16-digit run is far more often an id, an invoice number or a timestamp.
    const notACard = "reference 1234567890123456";
    expect(scrub(notACard)).toBe(notACard);
  });

  it("never throws and never returns the original on failure", () => {
    expect(scrub(null)).toBeNull();
    expect(scrub(42)).toBe(42);
    expect(scrub("")).toBe("");
  });

  it("walks nested objects for the reporter's extra payload", () => {
    const out = scrubObject({
      url: "https://app/x?token=abcdefghijkl",
      nested: { who: "paul@client.cm" },
      n: 3,
    });
    expect(out.url).toContain("<redacted>");
    expect(out.nested.who).toBe("<email>");
    expect(out.n).toBe(3);
  });

  it("collapses per-user variants onto one fingerprint", async () => {
    // The point of scrubbing BEFORE fingerprint(): "no user marie@x.cm" and
    // "no user paul@x.cm" are one problem, exactly as uuids already were.
    const a = new Error("no user marie@client.cm");
    const b = new Error("no user paul@client.cm");
    a.stack = "Error\n    at f (/app/src/x.js:1:1)";
    b.stack = "Error\n    at f (/app/src/x.js:1:1)";
    expect(
      reporter.fingerprint({
        name: "Error",
        message: scrub(a.message),
        stack: a.stack,
      }),
    ).toBe(
      reporter.fingerprint({
        name: "Error",
        message: scrub(b.message),
        stack: b.stack,
      }),
    );
  });

  it("scrubs before the error reaches the store", async () => {
    const rows = [];
    store.__reset();
    store.__setQuery(async (_q, p) => {
      rows.push(p);
      return { rows: [] };
    });
    reporter.__reset();

    await reporter.report(new Error("login failed for accountant@tenant.cm"), {
      route: "POST /auth?token=abcdefghijkl",
    });
    await store.flush();

    const message = rows[0][4];
    const route = rows[0][9];
    expect(message).not.toContain("accountant@tenant.cm");
    expect(route).not.toContain("abcdefghijkl");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("escalation — the delay clock", () => {
  const RULE = {
    id: "r-1",
    name: "fatal burst",
    level_filter: ["fatal"],
    threshold_count: 1,
    threshold_window_minutes: 10,
    escalation_delay_minutes: 10,
    repeat_interval_minutes: 60,
    tenant_id: null,
    action_email: false,
    action_inhouse: false,
    action_webhook_url: null,
    email_recipients: [],
  };

  const MATCH = {
    error_id: "e-1",
    signature: "sig-1",
    level: "fatal",
    message: "boom",
    module: "shipments",
    route: null,
    occurrence_count: 9,
    last_seen: new Date().toISOString(),
    tenant_slug: null,
  };

  /**
   * A tiny in-memory stand-in for platform.error_escalation_log. The engine's
   * whole correctness argument is that arming is a ROW rather than a Map, so
   * the fake has to behave like the table: rows survive, and the two row KINDS
   * (pending vs delivered) are distinguishable.
   */
  function fakeDb(log) {
    return async (sql, params) => {
      if (/^\s*SELECT .*FROM platform\.error_escalation_rule/s.test(sql))
        return { rows: [RULE] };
      if (/FROM platform\.error_event/s.test(sql)) return { rows: log.matches };

      if (/INSERT INTO platform\.error_escalation_log/s.test(sql)) {
        log.rows.push({
          rule_id: params[0],
          signature: params[2],
          pending:
            String(params[3] || "").includes("pending") || /pending/.test(sql),
          triggered_at: log.now(),
        });
        return { rows: [] };
      }
      if (/DELETE FROM platform\.error_escalation_log/s.test(sql)) {
        // TWO different deletes share this shape and the fake has to tell them
        // apart, or clearStaleArming eats the row disarm was meant to consume
        // and a delayed rule can never fire. The array parameter is the tell:
        //   clearStaleArming($1 rule, $2 signatures[])  — keep what still matches
        //   disarm($1 rule, $2 signature)               — drop exactly one
        const arg = params[1];
        log.rows = Array.isArray(arg)
          ? log.rows.filter((r) => !r.pending || arg.includes(r.signature))
          : log.rows.filter((r) => !(r.pending && r.signature === arg));
        return { rowCount: 0, rows: [] };
      }
      if (
        /SELECT triggered_at FROM platform\.error_escalation_log/s.test(sql)
      ) {
        const r = log.rows.find((x) => x.pending && x.signature === params[1]);
        return { rows: r ? [{ triggered_at: r.triggered_at }] : [] };
      }
      if (/SELECT 1 FROM platform\.error_escalation_log/s.test(sql)) {
        return {
          rows: log.rows
            .filter((x) => !x.pending && x.signature === params[1])
            .slice(0, 1)
            .map(() => ({})),
        };
      }
      return { rows: [] };
    };
  }

  function loadService(log) {
    jest.resetModules();
    jest.doMock("../../src/services/platform/db", () => ({
      query: fakeDb(log),
    }));

    return require("../../src/services/platform/error-escalation.service");
  }

  it("arms on the first sweep instead of notifying", async () => {
    const log = {
      rows: [],
      matches: [MATCH],
      now: () => new Date().toISOString(),
    };
    const svc = loadService(log);

    const out = await svc.evaluate();

    expect(out.fired).toHaveLength(0);
    expect(log.rows.filter((r) => r.pending)).toHaveLength(1);
  });

  it("delivers once the delay has elapsed", async () => {
    const armedAt = new Date(Date.now() - 11 * 60_000).toISOString();
    const log = {
      rows: [
        {
          rule_id: "r-1",
          signature: "sig-1",
          pending: true,
          triggered_at: armedAt,
        },
      ],
      matches: [MATCH],
      now: () => new Date().toISOString(),
    };
    const svc = loadService(log);

    const out = await svc.evaluate();

    expect(out.fired).toHaveLength(1);
    expect(out.fired[0].signature).toBe("sig-1");
  });

  it("does not deliver while the delay is still running", async () => {
    const armedAt = new Date(Date.now() - 2 * 60_000).toISOString();
    const log = {
      rows: [
        {
          rule_id: "r-1",
          signature: "sig-1",
          pending: true,
          triggered_at: armedAt,
        },
      ],
      matches: [MATCH],
      now: () => new Date().toISOString(),
    };
    const svc = loadService(log);

    expect((await svc.evaluate()).fired).toHaveLength(0);
  });

  it("forgets the armed clock when the condition clears — a blip pages nobody", async () => {
    const armedAt = new Date(Date.now() - 2 * 60_000).toISOString();
    const log = {
      rows: [
        {
          rule_id: "r-1",
          signature: "sig-1",
          pending: true,
          triggered_at: armedAt,
        },
      ],
      matches: [], // recovered
      now: () => new Date().toISOString(),
    };
    const svc = loadService(log);

    await svc.evaluate();

    expect(log.rows.filter((r) => r.pending)).toHaveLength(0);
  });

  it("a zero-delay rule still fires on the first sweep", async () => {
    const log = {
      rows: [],
      matches: [MATCH],
      now: () => new Date().toISOString(),
    };
    jest.resetModules();
    jest.doMock("../../src/services/platform/db", () => ({
      query: async (sql, params) => {
        if (/FROM platform\.error_escalation_rule/s.test(sql)) {
          return { rows: [{ ...RULE, escalation_delay_minutes: 0 }] };
        }
        return fakeDb(log)(sql, params);
      },
    }));

    const svc = require("../../src/services/platform/error-escalation.service");

    expect((await svc.evaluate()).fired).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("share templates — Appendix B, field for field", () => {
  const ROW = {
    id: "e1",
    signature: "sig",
    level: "fatal",
    origin: "server",
    name: "TypeError",
    message: "Cannot read property 'id' of undefined",
    module: "shipments",
    route: "POST /api/shipments/assign",
    file_path: "shipment.controller.js",
    line_number: 142,
    occurrence_count: 23,
    tenant_slug: "smartlog",
    first_seen: new Date(Date.now() - 3 * 3600e3).toISOString(),
    last_seen: new Date().toISOString(),
    stack_trace: [],
  };

  it("renders every WhatsApp field the spec names", () => {
    const t = shareSvc.build(ROW, { baseUrl: "https://admin.praxisls.com" });
    for (const marker of [
      "❗ Error:",
      "📦 Module:",
      "🔗 Route:",
      "📄 Location:",
      "⏱ Occurred:",
      "🔁 Count:",
      "🔗 View in Admin:",
    ]) {
      expect(t.whatsapp.text).toContain(marker);
    }
    // The spec's Appendix B writes PRAXXIS-LS (double X). That is a typo in the
    // spec; the product is PRAXIS-LS and the templates say so consistently.
    expect(t.whatsapp.text).toContain("PRAXIS-LS");
    expect(t.whatsapp.text).not.toContain("PRAXXIS");
  });

  it("builds an email subject in the documented shape", () => {
    const t = shareSvc.build(ROW, { baseUrl: "https://admin.praxisls.com" });
    expect(t.email.subject).toContain("[PRAXIS-LS] [FATAL] shipments");
  });

  it("produces a plain block suitable for pasting into an LLM", () => {
    const t = shareSvc.build(ROW, { baseUrl: "https://admin.praxisls.com" });
    expect(t.plain).toContain("shipment.controller.js:142");
    expect(t.plain).toContain("POST /api/shipments/assign");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("validators — the edge is the only place input is trusted", () => {
  it("rejects a sort value that would reach ORDER BY", () => {
    expect(
      QUERY_SCHEMAS.errorList.safeParse({ sort: "; DROP TABLE x" }).success,
    ).toBe(false);
  });

  it("rejects an unknown level and an oversized limit", () => {
    expect(QUERY_SCHEMAS.errorList.safeParse({ level: "banana" }).success).toBe(
      false,
    );
    expect(QUERY_SCHEMAS.errorList.safeParse({ limit: "5000" }).success).toBe(
      false,
    );
  });

  it("rejects webhook URLs that are an SSRF primitive", () => {
    // Credentials in the URL both leak and bypass filters; non-http schemes are
    // not something the escalation fetch should ever be pointed at.
    expect(
      BODY_SCHEMAS.ruleCreate.safeParse({
        name: "r",
        action_webhook_url: "https://u:p@evil/x",
      }).success,
    ).toBe(false);
    expect(
      BODY_SCHEMAS.ruleCreate.safeParse({
        name: "r",
        action_webhook_url: "ftp://evil/x",
      }).success,
    ).toBe(false);
  });

  it("accepts a tenant scope on preview so a dry-run matches what will be saved", () => {
    const parsed = BODY_SCHEMAS.rulePreview.safeParse({
      tenant: "smartlog",
      level_filter: ["fatal"],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data.tenant).toBe("smartlog");
  });
});
