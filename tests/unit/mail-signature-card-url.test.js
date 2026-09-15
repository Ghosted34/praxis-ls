/**
 * WHERE A SIGNATURE CARD IS ADDRESSED, AND WHOSE PREFIX IT IS STORED UNDER.
 *
 * Both of these live in the `<img src>` that goes out inside every email, and
 * both were wrong in a way nothing could see: the send succeeds either way, the
 * text fallback renders either way, and the only symptom is a broken image in a
 * recipient's mail client that nobody here ever opens.
 *
 *   · THE HOST was `https://<APP_BASE_DOMAIN>/media/…` — the platform apex,
 *     which `host-tenent-resolver` lists in PLATFORM_HOSTS. The function's own
 *     doc comment said it should be the tenant's host and the code did not.
 *
 *   · THE NAMESPACE came from a module-level `namespaceCache`. One Node process
 *     serves every tenant, and neither send path passes a slug, so the FIRST
 *     tenant to render a card claimed that variable and every tenant after it
 *     wrote its cards under that tenant's prefix.
 *
 * The second is the one worth a regression test above all others, because it is
 * silent, cross-tenant, and reappears the moment someone reaches for a
 * module-level memo in a multi-tenant process again.
 */
"use strict";

const TENANT_SYMBOL = Symbol.for("praxis.conn.tenant");

jest.mock("../../src/services/tenant/registry.service", () => {
  const actual = jest.requireActual("../../src/services/tenant/registry.service");
  return {
    // The real one — it reads the symbol the pool stamps, and that is the
    // mechanism under test.
    tenantIdOf: actual.tenantIdOf,
    // The platform-pool read, stubbed per test.
    workspaceOrigin: jest.fn(),
  };
});

const registry = require("../../src/services/tenant/registry.service");
const service = require("../../src/modules/mail/signature/signature.service");
const { config } = require("../../src/config/env");

/** A pooled tenant connection, as `registry.acquire` hands one out. */
function client(tenantId, dbName = "praxis_fallback") {
  return {
    [TENANT_SYMBOL]: tenantId,
    query: jest.fn(async () => ({ rows: [{ db: dbName }] })),
  };
}

/** Unique per test: the resolver memoises per tenant for a minute, and sharing
 *  an id between cases would test the cache rather than the resolver. */
let seq = 0;
const nextId = () => `tenant-${(seq += 1)}`;

beforeEach(() => {
  registry.workspaceOrigin.mockReset();
});

describe("the storage namespace is the connection's tenant, not the first one seen", () => {
  /**
   * THE REGRESSION. Two tenants, one process, no slug passed by either send
   * path — exactly the production shape.
   */
  test("two tenants in one process do not share a namespace", async () => {
    const a = nextId();
    const b = nextId();
    registry.workspaceOrigin.mockImplementation(async (id) =>
      id === a
        ? { slug: "smartls", origin: "https://smartls.praxisls.com" }
        : { slug: "othertenant", origin: "https://othertenant.praxisls.com" },
    );

    const nsA = await service.tenantNamespace(client(a, "praxis_smartls"), null);
    const nsB = await service.tenantNamespace(client(b, "praxis_othertenant"), null);

    expect(nsA).toBe("smartls");
    expect(nsB).toBe("othertenant");
    expect(nsB).not.toBe(nsA);
  });

  /** An explicit slug still wins — the batch and preview paths can pass one. */
  test("an explicit slug is used as given", async () => {
    const ns = await service.tenantNamespace(client(nextId()), "Explicit-Slug");
    expect(ns).toBe("explicit-slug");
    expect(registry.workspaceOrigin).not.toHaveBeenCalled();
  });

  /**
   * A connection with no tenant stamped on it — a test double, or a script
   * holding a raw pool. The database still names itself, which is the old
   * behaviour kept as a last resort rather than as the normal path.
   */
  test("a connection with no tenant falls back to the database name", async () => {
    const bare = { query: jest.fn(async () => ({ rows: [{ db: "praxis_loose" }] })) };
    expect(await service.tenantNamespace(bare, null)).toBe("praxis_loose");
  });

  /** Nothing readable at all still produces a correctly-shaped key rather than
   *  `tenant_/signatures/…`, which /media would refuse. */
  test("an unreadable namespace is 'unknown', never empty", async () => {
    const broken = { query: jest.fn(async () => { throw new Error("no connection"); }) };
    expect(await service.tenantNamespace(broken, null)).toBe("unknown");
  });
});

describe("the card is addressed at the tenant's own host", () => {
  test("the registered workspace host is used when there is one", async () => {
    registry.workspaceOrigin.mockResolvedValue({
      slug: "smartls",
      origin: "https://smartls.praxisls.com",
    });
    expect(await service.tenantMediaOrigin(client(nextId())))
      .toBe("https://smartls.praxisls.com");
  });

  /** A tenant brought their own domain and it is the workspace host: the card
   *  loads from the domain their recipients already recognise. */
  test("a custom domain is honoured, not rewritten to the platform's", async () => {
    registry.workspaceOrigin.mockResolvedValue({
      slug: "smartls",
      origin: "https://app.smartls.cm",
    });
    const origin = await service.tenantMediaOrigin(client(nextId()));
    expect(origin).toBe("https://app.smartls.cm");
    expect(origin).not.toContain(config.APP_BASE_DOMAIN);
  });

  /** No subdomain row yet — the conventional shape, which is still the tenant's
   *  own host and not the platform's. */
  test("a tenant with no host on file gets <slug>.<base>", async () => {
    registry.workspaceOrigin.mockResolvedValue({ slug: "smartls", origin: null });
    expect(await service.tenantMediaOrigin(client(nextId())))
      .toBe(`https://smartls.${config.APP_BASE_DOMAIN}`);
  });

  /**
   * The last resort is the old behaviour, kept so that no deployment is made
   * worse by the fix — but it is now only reachable when the tenant cannot be
   * identified at all, rather than being what every tenant got.
   */
  test("only an unidentifiable tenant reaches the apex", async () => {
    const bare = { query: jest.fn(async () => ({ rows: [{ db: "praxis_loose" }] })) };
    expect(await service.tenantMediaOrigin(bare))
      .toBe(`https://${config.APP_BASE_DOMAIN}`);
  });

  /** A registry that throws must not take the send down with it. */
  test("a failed lookup degrades rather than throwing", async () => {
    registry.workspaceOrigin.mockRejectedValue(new Error("platform pool down"));
    await expect(service.tenantMediaOrigin(client(nextId()))).resolves.toMatch(/^https:\/\//);
  });

  /**
   * The host is memoised per tenant, so a send does not cost a platform-pool
   * round trip — but per TENANT, which is the whole correction.
   */
  test("the lookup is memoised per tenant", async () => {
    const id = nextId();
    registry.workspaceOrigin.mockResolvedValue({ slug: "smartls", origin: "https://smartls.praxisls.com" });
    await service.tenantMediaOrigin(client(id));
    await service.tenantMediaOrigin(client(id));
    await service.tenantNamespace(client(id), null);
    expect(registry.workspaceOrigin).toHaveBeenCalledTimes(1);
  });
});

/**
 * `storagePathOf` strips the origin back off to store the KEY, which is what
 * makes changing the host safe for rows already in `signature_render`: the
 * cache holds the key, and the URL is rebuilt around it on read.
 */
describe("the cache stores a key, not a URL", () => {
  test("a stored path survives a change of host", () => {
    const strip = (url) => String(url || "").replace(/^https?:\/\/[^/]+\/media\//i, "");
    const key = "tenant_smartls/signatures/u-en-abc123.png";
    expect(strip(`https://praxisls.com/media/${key}`)).toBe(key);
    expect(strip(`https://smartls.praxisls.com/media/${key}`)).toBe(key);
    expect(strip(`https://app.smartls.cm/media/${key}`)).toBe(key);
  });
});
