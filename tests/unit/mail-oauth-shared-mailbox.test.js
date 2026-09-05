/**
 * Connecting a mailbox over Microsoft OAuth — including a TEAM address.
 *
 * ── THE TWO DEFECTS THIS PINS ───────────────────────────────────────────────
 *
 * 1. `completeOAuth` wrote its connection row with `owner_user_id` set and NO
 *    `kind`. `email_connection.kind` DEFAULTS to 'PERSONAL' (10723) and carries
 *    a partial unique index:
 *
 *      ux_email_connection_one_personal
 *        UNIQUE (owner_user_id) WHERE kind = 'PERSONAL' AND status <> 'ARCHIVED'
 *
 *    That is exactly the defect 82d02ec fixed on the password path — and this
 *    path never goes through `connect()`, so it still had it. Every mailbox
 *    connected by consent was somebody's personal mailbox, which meant a team
 *    address could not be connected over OAuth at all: the only people who set
 *    one up are administrators, and an administrator with a personal mailbox
 *    hit the index.
 *
 * 2. It never called `mailbox.classify`, so even had a row landed it would have
 *    had no catalogue slot, no department, no visibility and no members — the
 *    mailbox would not have appeared against the "Operations" slot that asked
 *    for it, and the person who set it up could not have added anybody to it.
 *
 * The whole point of a Microsoft 365 tenant is that the password path is CLOSED
 * to them (Basic auth gone from IMAP/POP in 2022, from SMTP AUTH in April 2026),
 * so "OAuth cannot make a shared mailbox" meant "this tenant cannot have team
 * addresses".
 *
 * NOTE: jest.mock factories are hoisted, so any var they reference must be
 * `mock`-prefixed (jest's babel-hoist rule).
 */
"use strict";

const jwt = require("jsonwebtoken");

jest.mock("../../src/modules/mail/mail/providers/microsoftOAuth", () => ({
  isConfigured: jest.fn(async () => true),
  authorizeUrl: jest.fn(async ({ state }) => `https://login.microsoftonline.com/authorize?state=${state}`),
  exchangeCode: jest.fn(async () => ({
    access_token: "at", refresh_token: "rt", expires_in: 3600,
  })),
  refresh: jest.fn(),
  credentials: jest.fn(async () => ({})),
}));
// SYNCHRONOUS `isConfigured`, because the real one is: Google reads its
// credentials straight off `config` and returns a bare boolean, while
// Microsoft's is `async` (it resolves them from the platform vault). Mocking
// this one `async` too is what let a `.catch()` on the result reach production
// — every test passed against two promises that the running system never both
// supplied. A fixture that smooths over a difference the code has to handle is
// not a cheaper fixture, it is a blind spot.
jest.mock("../../src/modules/mail/mail/providers/googleOAuth", () => ({
  isConfigured: jest.fn(() => false),
  authorizeUrl: jest.fn(),
  exchangeCode: jest.fn(),
  refresh: jest.fn(),
}));
// The consent probe: Graph tells us which mailbox actually signed in.
jest.mock("../../src/modules/mail/mail/providers/microsoftGraph.provider", () => ({
  MicrosoftGraphProvider: jest.fn().mockImplementation(() => ({
    verify: async () => ({ ok: true, email: "operations@smartls.cm" }),
  })),
}));
jest.mock("../../src/modules/mail/mail/providers/imapSmtp.provider", () => ({
  ImapSmtpProvider: jest.fn().mockImplementation(() => ({ verify: async () => ({ ok: true }) })),
}));
jest.mock("../../src/modules/security/setting/setting.service", () => ({
  SECRET_SECTION: "integration_secret",
  put: jest.fn(async () => ({})),
  readSecret: jest.fn(async () => "tok"),
  remove: jest.fn(async () => ({})),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => {}),
  audit: jest.fn(async () => {}),
  resolveActorId: async (_c, id) => id || null,
}));
jest.mock("../../src/shared/config/settings", () => ({ getSetting: jest.fn(async () => ({})) }));
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({ createDocument: jest.fn() }));
jest.mock("../../src/modules/mail/mail/autodiscover", () => ({
  ...jest.requireActual("../../src/modules/mail/mail/autodiscover"),
  hostedProviderOf: async () => null,
}));
jest.mock("sanitize-html", () => {
  const fn = (h) => h;
  fn.defaults = { allowedTags: [], allowedAttributes: {} };
  return fn;
});
jest.mock("../../src/modules/mail/mail/mail.repo", () => ({
  insertConnection: jest.fn(async (_c, d) => ({ email_connection_id: "new-1", ...d })),
  findByAddress: jest.fn(async () => null),
  getConnection: jest.fn(async () => ({
    email_connection_id: "new-1", provider: "microsoft_graph",
    email_address: "operations@smartls.cm", secret_key: "k",
  })),
  updateConnection: jest.fn(async () => ({})),
  setError: jest.fn(async () => {}),
  ensureDefaultConnection: jest.fn(async () => {}),
  claimConnectionIfUnowned: jest.fn(async () => {}),
  hasSmtpCredentials: jest.fn(async () => false),
}));
const mockConn = {
  email_connection_id: "new-1", kind: "SHARED", status: "CONNECTED",
  email_address: "operations@smartls.cm",
};
jest.mock("../../src/modules/mail/mail/mailbox.repo", () => ({
  getConnection: jest.fn(async () => ({ ...mockConn })),
  updateConnection: jest.fn(async (_c, id, p) => { Object.assign(mockConn, p); return { email_connection_id: id, ...p }; }),
  personalFor: jest.fn(async () => null),
  liveMember: jest.fn(async () => null),
  insertMember: jest.fn(async () => ({})),
  recordAccessAudit: jest.fn(async () => ({})),
}));

const mailRepo = require("../../src/modules/mail/mail/mail.repo");
const mailboxRepo = require("../../src/modules/mail/mail/mailbox.repo");
const msOAuth = require("../../src/modules/mail/mail/providers/microsoftOAuth");
const googleOAuth = require("../../src/modules/mail/mail/providers/googleOAuth");
const service = require("../../src/modules/mail/mail/mail.service");
const { config } = require("../../src/config/env");

/** The provider flag is read straight off `feature_state`; ON unless a test says otherwise. */
const onClient = { query: jest.fn(async () => ({ rows: [{ state: "on" }] })) };
const offClient = { query: jest.fn(async () => ({ rows: [{ state: "off" }] })) };

const START = { slug: "smartls", redirectUri: "https://app.example/cb", actor: { user_id: "u1" } };
const stateFrom = (url) => new URL(url).searchParams.get("state");
const inserted = () => mailRepo.insertConnection.mock.calls[0][1];

/** Run a whole consent round trip and hand back what the INSERT saw. */
async function roundTrip(startOpts) {
  const { url } = await service.startMicrosoftOAuth(onClient, { ...START, ...startOpts });
  const state = stateFrom(url);
  const r = await service.completeMicrosoftOAuth(onClient, { code: "c", state, slug: "smartls" });
  return { state, result: r };
}

beforeEach(() => {
  jest.clearAllMocks();
  mailRepo.findByAddress.mockResolvedValue(null);
  mailboxRepo.personalFor.mockResolvedValue(null);
  Object.assign(mockConn, {
    email_connection_id: "new-1", kind: "SHARED", status: "CONNECTED",
    email_address: "operations@smartls.cm",
  });
});

describe("the consent state carries what kind of mailbox is being connected", () => {
  test("a team address is signed into the state, slot and all", async () => {
    const { url } = await service.startMicrosoftOAuth(onClient, {
      ...START, kind: "SHARED", catalogue_key: "OPERATIONS", department: "Ops",
    });
    const claims = jwt.verify(stateFrom(url), config.JWT_ACCESS_SECRET);
    expect(claims).toMatchObject({ kind: "SHARED", catalogue_key: "OPERATIONS", department: "Ops" });
  });

  /* The callback is a bare browser redirect: no session, no body. Anything not
   * in the signed state is not knowable when the mailbox is written. */
  test("a personal connect never carries a slot, even if one is passed", async () => {
    const { url } = await service.startMicrosoftOAuth(onClient, {
      ...START, catalogue_key: "OPERATIONS", department: "Ops",
    });
    const claims = jwt.verify(stateFrom(url), config.JWT_ACCESS_SECRET);
    expect(claims).toMatchObject({ kind: "PERSONAL", catalogue_key: null, department: null });
  });

  /* The one-personal-mailbox rule is NOT applied here, and that is deliberate:
   * which mailbox is being connected is not known until Microsoft says so, and
   * re-running consent is the only way to reconnect an OAuth mailbox whose
   * tokens have gone stale. A guard here would lock a person out of repairing
   * the mailbox they already own. */
  test("does not refuse before the address is known", async () => {
    mailboxRepo.personalFor.mockResolvedValue({
      email_connection_id: "own-1", email_address: "me@smartls.cm",
    });
    await expect(service.startMicrosoftOAuth(onClient, START)).resolves.toBeTruthy();
    expect(msOAuth.authorizeUrl).toHaveBeenCalled();
  });

  test("the provider flag still gates the redirect", async () => {
    await expect(service.startMicrosoftOAuth(offClient, START))
      .rejects.toMatchObject({ code: "PROVIDER_NOT_ENABLED", status: 403 });
    expect(msOAuth.authorizeUrl).not.toHaveBeenCalled();
  });
});

describe("a team address connected by consent", () => {
  test("is INSERTed as SHARED and ownerless", async () => {
    await roundTrip({ kind: "SHARED", catalogue_key: "OPERATIONS" });
    expect(inserted()).toMatchObject({ kind: "SHARED", owner_user_id: null });
  });

  /* THE REGRESSION. The only people who set up a team address are
   * administrators, and an administrator has a personal mailbox — which is
   * precisely the row `ux_email_connection_one_personal` refuses a second of.
   * A row inserted without its kind is a second PERSONAL mailbox for its
   * creator at the moment the index is evaluated. */
  test("an owner of a personal mailbox can still connect one", async () => {
    mailboxRepo.personalFor.mockResolvedValue({
      email_connection_id: "own-1", email_address: "me@smartls.cm",
    });
    await expect(roundTrip({ kind: "SHARED", catalogue_key: "OPERATIONS" })).resolves.toBeTruthy();
    expect(inserted().kind).toBe("SHARED");
  });

  test("is stamped with its catalogue slot and department", async () => {
    await roundTrip({ kind: "SHARED", catalogue_key: "OPERATIONS", department: "Ops" });
    const patches = mailboxRepo.updateConnection.mock.calls.map((c) => c[2]);
    expect(patches).toContainEqual(expect.objectContaining({
      kind: "SHARED", catalogue_key: "OPERATIONS", department: "Ops",
    }));
  });

  /* Without the grant the person who just set the mailbox up cannot add anybody
   * to it — a team address with no team. */
  test("gives the administrator who set it up a MANAGER grant", async () => {
    await roundTrip({ kind: "SHARED", catalogue_key: "OPERATIONS" });
    expect(mailboxRepo.insertMember).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ member_role: "MANAGER", user_id: "u1" }),
    );
  });

  /* "Which mailbox do I send from by default" is a question about a person's
   * OWN mailboxes. A team address is not one, and making it somebody's default
   * silently redirects their outgoing mail through the company address. */
  test("never becomes anybody's default mailbox", async () => {
    await roundTrip({ kind: "SHARED", catalogue_key: "OPERATIONS" });
    expect(mailRepo.ensureDefaultConnection).not.toHaveBeenCalled();
  });

  test("reports its kind back, so the browser lands on the tab that asked", async () => {
    const { result } = await roundTrip({ kind: "SHARED", catalogue_key: "OPERATIONS" });
    expect(result).toMatchObject({ kind: "SHARED", email_address: "operations@smartls.cm" });
  });
});

describe("a personal mailbox connected by consent", () => {
  test("is still INSERTed as PERSONAL, owned by the person who consented", async () => {
    await roundTrip({});
    expect(inserted()).toMatchObject({ kind: "PERSONAL", owner_user_id: "u1" });
  });

  test("still gets a default mailbox resolved", async () => {
    await roundTrip({});
    expect(mailRepo.ensureDefaultConnection).toHaveBeenCalledWith(expect.anything(), "u1");
  });

  /* Applied where the address is known, so the refusal can name the mailbox
   * already held rather than arriving as a 23505 the browser renders as "A
   * record with these values already exists". */
  test("a SECOND one is refused by name once Microsoft has said which mailbox it is", async () => {
    mailboxRepo.personalFor.mockResolvedValue({
      email_connection_id: "own-1", email_address: "me@smartls.cm",
    });
    await expect(roundTrip({})).rejects.toMatchObject({
      code: "PERSONAL_MAILBOX_EXISTS", status: 409,
    });
    expect(mailRepo.insertConnection).not.toHaveBeenCalled();
  });

  /* THE REPAIR PATH. An OAuth mailbox has no password to re-enter, so consent
   * IS its reconnect. Refusing it because the person already owns it would
   * leave a broken mailbox with no way to fix it. */
  test("re-consenting to a mailbox you already own reconnects it", async () => {
    mailboxRepo.personalFor.mockResolvedValue({
      email_connection_id: "new-1", email_address: "operations@smartls.cm",
    });
    mailRepo.findByAddress.mockResolvedValue({
      email_connection_id: "new-1", status: "ERROR", kind: "PERSONAL",
    });
    const { result } = await roundTrip({});
    expect(result).toMatchObject({ status: "CONNECTED", kind: "PERSONAL" });
  });

  /* A team address is not somebody's personal mailbox, so the rule is not
   * theirs to trip: an administrator who owns one must still be able to stand
   * one up. */
  test("does not stand in the way of a team address", async () => {
    mailboxRepo.personalFor.mockResolvedValue({
      email_connection_id: "own-1", email_address: "me@smartls.cm",
    });
    await expect(roundTrip({ kind: "SHARED", catalogue_key: "OPERATIONS" })).resolves.toBeTruthy();
  });
});

/**
 * A RECONNECT must not be able to change what a mailbox IS.
 *
 * Both directions are a real disclosure: a personal mailbox re-stamped SHARED
 * exposes one person's correspondence to whoever holds the slot, and a team
 * address re-stamped PERSONAL loses its slot and its department and becomes the
 * reconnecting user's own. Converting one into the other is `mailbox.handover`
 * — deliberate, audited — and must not be reachable by picking the other
 * button on the chooser.
 */
describe("reconnecting an existing mailbox", () => {
  beforeEach(() => {
    mailRepo.findByAddress.mockResolvedValue({
      email_connection_id: "new-1", status: "ERROR", kind: "PERSONAL",
    });
  });

  test("does not re-classify it", async () => {
    await roundTrip({ kind: "SHARED", catalogue_key: "OPERATIONS" });
    const patches = mailboxRepo.updateConnection.mock.calls.map((c) => c[2]);
    expect(patches).not.toContainEqual(expect.objectContaining({ kind: "SHARED" }));
  });

  test("does not claim a team address for whoever reconnected it", async () => {
    await roundTrip({ kind: "SHARED", catalogue_key: "OPERATIONS" });
    expect(mailRepo.claimConnectionIfUnowned).not.toHaveBeenCalled();
  });

  test("still claims an unowned PERSONAL mailbox on reconnect", async () => {
    await roundTrip({});
    expect(mailRepo.claimConnectionIfUnowned).toHaveBeenCalledWith(expect.anything(), "new-1", "u1");
  });
});

/**
 * What the chooser asks before it draws the Microsoft option. The two
 * prerequisites fail independently and are fixed by different people — a
 * tenant feature flag versus an Entra app registration whose secret expires —
 * so a single "unavailable" would send an administrator hunting for a switch
 * that is already on.
 */
describe("which connect methods a tenant may use", () => {
  test("IMAP/SMTP is always offered", async () => {
    const m = await service.listConnectMethods(onClient);
    expect(m.imap_smtp.available).toBe(true);
  });

  test("Microsoft is available when the flag is on and the app is registered", async () => {
    const m = await service.listConnectMethods(onClient);
    expect(m.microsoft_graph).toMatchObject({ available: true, reason: null });
  });

  test("a flag that is off reads NOT_ENABLED", async () => {
    const m = await service.listConnectMethods(offClient);
    expect(m.microsoft_graph).toMatchObject({ available: false, reason: "NOT_ENABLED" });
  });

  test("a deployment with no Entra app reads NOT_CONFIGURED", async () => {
    msOAuth.isConfigured.mockResolvedValueOnce(false);
    const m = await service.listConnectMethods(onClient);
    expect(m.microsoft_graph).toMatchObject({
      available: false, enabled: true, configured: false, reason: "NOT_CONFIGURED",
    });
  });

  /*
   * ── THE CRASH, PINNED ────────────────────────────────────────────────────
   *
   * `idp.isConfigured().catch(() => false)` took the entire endpoint down with
   * "TypeError: idp.isConfigured(...).catch is not a function", so the chooser
   * could not be drawn on any surface for any tenant. The two adapters
   * genuinely differ — Microsoft's `isConfigured` is `async` because it reads
   * the platform vault, Google's is a synchronous boolean off `.env` — and a
   * boolean has no `.catch`. These four say the reader must survive every
   * combination it can actually meet.
   */
  test("a synchronous isConfigured does not blow the endpoint up", async () => {
    // Exactly the real Google adapter: a bare boolean, no promise in sight.
    googleOAuth.isConfigured.mockReturnValueOnce(true);
    const m = await service.listConnectMethods(onClient);
    expect(m.google_gmail).toMatchObject({ configured: true });
  });

  test("both adapters are read in one call, whatever shape each answers in", async () => {
    msOAuth.isConfigured.mockResolvedValueOnce(true);   // async
    googleOAuth.isConfigured.mockReturnValueOnce(false); // sync
    const m = await service.listConnectMethods(onClient);
    expect(m.microsoft_graph.configured).toBe(true);
    expect(m.google_gmail).toMatchObject({ configured: false, reason: "NOT_CONFIGURED" });
  });

  /* A synchronous THROW is the failure `.catch()` could never have caught
   * either — it is raised before any promise exists. */
  test("a provider that throws synchronously reads unavailable, not 500", async () => {
    googleOAuth.isConfigured.mockImplementationOnce(() => { throw new Error("no config"); });
    const m = await service.listConnectMethods(onClient);
    expect(m.google_gmail).toMatchObject({ available: false, configured: false, reason: "NOT_CONFIGURED" });
  });

  /* And the one it WAS written for: the vault read rejecting. Failing to
   * `false` is the honest answer — a provider whose configuration cannot be
   * read is one this tenant cannot connect through — and the endpoint still
   * answers, so the page that was meant to explain the problem can render. */
  test("a vault read that rejects reads unavailable, and IMAP/SMTP still stands", async () => {
    msOAuth.isConfigured.mockRejectedValueOnce(new Error("vault unreachable"));
    const m = await service.listConnectMethods(onClient);
    expect(m.microsoft_graph).toMatchObject({ available: false, configured: false, reason: "NOT_CONFIGURED" });
    expect(m.imap_smtp.available).toBe(true);
  });
});

/**
 * The redirect hint. Only ever decides which tab the browser lands on — never
 * authorises anything — but it verifies the signature all the same, because an
 * unverified decode would let a crafted state steer the redirect.
 */
describe("reading the kind back off a state, for the return redirect", () => {
  test("answers SHARED for a team-address consent", async () => {
    const { url } = await service.startMicrosoftOAuth(onClient, { ...START, kind: "SHARED" });
    expect(service.readOAuthStateKind(stateFrom(url))).toBe("SHARED");
  });

  test("answers null rather than throwing on a state it cannot verify", () => {
    expect(service.readOAuthStateKind("not-a-token")).toBeNull();
    expect(service.readOAuthStateKind(undefined)).toBeNull();
    expect(service.readOAuthStateKind(jwt.sign({ kind: "SHARED" }, "a-different-secret"))).toBeNull();
  });
});
