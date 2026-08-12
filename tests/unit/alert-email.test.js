/**
 * Ops alerts — the EMAIL destination (WS-ER1).
 *
 * WHY THIS WAS ADDED
 *
 *   `ALERT_EMAIL` existed in the schema, in `.env.example`, and in the boot
 *   warning in server.js — and nothing anywhere sent an email. Filling it in
 *   SILENCED the "no alert destination configured" warning while delivering
 *   nothing: a control that is counted but does not bite, and the worst possible
 *   version of it, because the control being silenced is the one whose entire
 *   job is to say "nobody will be told".
 *
 *   It became real rather than being deleted, on the argument that a webhook and
 *   the chat product behind it fail together — an outage, a revoked integration,
 *   an archived workspace — and `page` severity means a failed backup or a tenant
 *   that cannot serve. One channel is a single point of failure on the one night
 *   it matters.
 *
 * THE PROPERTY THAT MATTERS is that channels are INDEPENDENT: every configured
 * destination is attempted, and one failing does not stop the other. Delivering
 * to the first that works would throw away the entire reason for having two.
 */
"use strict";

/* `config` is frozen at load — correctly, and this file must not fight that.
 * The env FALLBACK is half the resolution order being tested, so the settings
 * are injected through a mock object the test can move rather than by assigning
 * to the real one, which throws. The logger is mocked alongside it because it
 * reads config at require time and this replaces that module. */
jest.mock("../../src/config/env", () => ({
  config: {
    ALERT_WEBHOOK_URL: "",
    ALERT_WEBHOOK_PAGE_URL: "",
    ALERT_EMAIL: "",
    APP_BASE_DOMAIN: "praxisls.com",
  },
}));
jest.mock("../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../src/services/platform/settings.service", () => ({
  resolve: jest.fn(),
}));
jest.mock("../../src/services/platform/platform-mail.service", () => ({
  send: jest.fn(),
}));

const settings = require("../../src/services/platform/settings.service");
const mail = require("../../src/services/platform/platform-mail.service");
const alerts = require("../../src/services/platform/alert-routing.service");
const { config } = require("../../src/config/env");

/** Stub the vault: `alerts.default` / `alerts.page` hold secrets, `alerts.email` a value. */
function vault({ webhook = null, page = null, email = null }) {
  settings.resolve.mockImplementation(async (section, key) => {
    if (section !== "alerts") return null;
    if (key === "default") return webhook ? { value: {}, secret: webhook } : null;
    if (key === "page") return page ? { value: {}, secret: page } : null;
    if (key === "email") return email ? { value: { to: email }, secret: null } : null;
    return null;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Env fallbacks empty by default: every case below configures its destinations
  // through the vault, which is the primary store. The two tests that care about
  // the env path set it explicitly.
  config.ALERT_WEBHOOK_URL = "";
  config.ALERT_WEBHOOK_PAGE_URL = "";
  config.ALERT_EMAIL = "";
  global.fetch = jest.fn(async () => ({ ok: true, status: 200 }));
  mail.send.mockResolvedValue({ ok: true, message_id: "<test@praxis>" });
});

describe("email as an alert destination", () => {
  test("an address in the vault is a destination", async () => {
    vault({ email: "ops@example.com" });
    expect(await alerts.emailDestination()).toBe("ops@example.com");
  });

  test("both channels are returned when both are configured", async () => {
    vault({ webhook: "https://hooks.example.com/x", email: "ops@example.com" });
    const dests = await alerts.destinationsFor("page");
    expect(dests.map((d) => d.kind).sort()).toEqual(["email", "webhook"]);
  });

  test("an alert reaches BOTH channels, not the first that works", async () => {
    vault({ webhook: "https://hooks.example.com/x", email: "ops@example.com" });

    const r = await alerts.raise({ event: "backup.failed", subject: "nightly dump failed" });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(r.delivered).toBe(true);
    expect(r.channels.sort()).toEqual(["default", "email"]);
  });

  test("the webhook failing does not stop the email — this is the whole point", async () => {
    vault({ webhook: "https://hooks.example.com/x", email: "ops@example.com" });
    global.fetch.mockRejectedValue(new Error("slack is down"));

    const r = await alerts.raise({ event: "tenant.red", subject: "smartls cannot serve" });

    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(r.delivered).toBe(true);          // email got through
    expect(r.channels).toEqual(["email"]);
    expect(r.failed).toHaveLength(1);        // and the failure is still reported
  });

  test("the email failing does not stop the webhook", async () => {
    vault({ webhook: "https://hooks.example.com/x", email: "ops@example.com" });
    // platform-mail never throws; it reports ok:false. Both shapes must be safe.
    mail.send.mockResolvedValue({ ok: false, reason: "no_smtp_configured" });

    const r = await alerts.raise({ event: "backup.failed", subject: "nightly dump failed" });

    expect(r.delivered).toBe(true);
    expect(r.channels).toEqual(["default"]);
  });

  test("both failing reports undelivered, with the reasons", async () => {
    vault({ webhook: "https://hooks.example.com/x", email: "ops@example.com" });
    global.fetch.mockRejectedValue(new Error("slack is down"));
    mail.send.mockResolvedValue({ ok: false, reason: "no_smtp_configured" });

    const r = await alerts.raise({ event: "backup.failed", subject: "nightly dump failed" });

    expect(r.delivered).toBe(false);
    expect(r.reason).toMatch(/no_smtp_configured/);
  });

  test("email alone is enough — a deployment with no webhook is still covered", async () => {
    vault({ email: "ops@example.com" });

    const r = await alerts.raise({ event: "restore.drill.failed", subject: "drill failed" });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(r.delivered).toBe(true);
    expect(r.channels).toEqual(["email"]);
  });

  test("no destination at all still reports honestly rather than throwing", async () => {
    vault({});

    const r = await alerts.raise({ event: "backup.failed", subject: "nightly dump failed" });

    expect(r.delivered).toBe(false);
    expect(r.reason).toBe("no destination configured");
  });

  test("a `log` severity still sends nothing anywhere", async () => {
    vault({ webhook: "https://hooks.example.com/x", email: "ops@example.com" });
    const r = await alerts.raise({ event: "maintenance.started", subject: "window opened" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
    expect(r.delivered).toBe(false);
  });

  test("the subject carries severity, event and tenant — it is read on a phone", async () => {
    vault({ email: "ops@example.com" });

    await alerts.raise({ event: "tenant.red", subject: "cannot serve", tenant: "smartls" });

    const { subject } = mail.send.mock.calls[0][0];
    expect(subject).toContain("PAGE");
    expect(subject).toContain("tenant.red");
    expect(subject).toContain("smartls");
  });
});
