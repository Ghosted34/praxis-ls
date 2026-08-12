"use strict";

/**
 * Platform mail — the sender behind escalation email (spec §5.3).
 *
 * This module exists because the previous implementation reported success for
 * mail it never sent. `enqueue("email-send", …)` resolved against a queue with
 * no worker, so `error_escalation_log` recorded `email: [recipients]` for a page
 * nobody received. "Why was I not called at 3am" had a confident, false answer.
 *
 * So the assertions that matter here are NEGATIVE and they are about HONESTY:
 * every failure path must return `ok:false` with a reason the operator can act
 * on, and none of them may throw — because the caller is the escalation
 * evaluator, where a raised exception would also cancel the in-house
 * notification and the webhook for the same incident.
 *
 * The clash risk is covered too. doc/EMAIL_TWO_CONFIGS.md defines exactly two
 * email configurations; this must remain a second CONSUMER of System email's
 * fallback tier rather than becoming a third config with its own transport.
 */

const path = require("path");

const MAIL = "../../src/services/platform/platform-mail.service";
const FALLBACK = path.join(
  __dirname,
  "../../src/services/platform/mail-fallback.service",
);

const CONFIGURED = {
  from: "no-reply@praxisls.com",
  from_name: "Praxis",
  support_from: "support@praxisls.com",
  reply_to: null,
  fallback_domain: "praxisls.com",
  smtp_host: "smtp.example.com",
  smtp_port: 587,
  smtp_user: "u",
  smtp_pass: "p",
  source: "platform",
};

function withFallback(resolveImpl) {
  jest.resetModules();
  jest.doMock(FALLBACK, () => ({
    resolve: resolveImpl,
    envDefaults: () => CONFIGURED,
  }));

  return require(MAIL);
}

/** A nodemailer stand-in. `sendMail` is the only surface used. */
const stubTransport = (impl) => ({ sendMail: impl });

describe("platform mail — failure is reported, never thrown", () => {
  it("refuses an empty recipient list", async () => {
    const mail = withFallback(async () => CONFIGURED);
    expect(await mail.send({ to: [], subject: "s", text: "t" })).toEqual({
      ok: false,
      reason: "no_recipients",
    });
  });

  it("filters falsy recipients rather than mailing undefined", async () => {
    const mail = withFallback(async () => CONFIGURED);
    expect(
      await mail.send({ to: [null, undefined, ""], subject: "s", text: "t" }),
    ).toEqual({ ok: false, reason: "no_recipients" });
  });

  it("says so plainly when no SMTP host is configured", async () => {
    // The common state on a fresh deployment. An operator who sees this in the
    // escalation log knows what to do; one who sees a green tick does not know
    // there is anything to do.
    const mail = withFallback(async () => ({ ...CONFIGURED, smtp_host: null }));
    const out = await mail.send({ to: ["a@b.cm"], subject: "s", text: "t" });
    expect(out).toEqual({ ok: false, reason: "no_smtp_configured" });
  });

  it("survives the platform settings lookup throwing", async () => {
    const mail = withFallback(async () => {
      throw new Error("platform db unreachable");
    });
    const out = await mail.send({ to: ["a@b.cm"], subject: "s", text: "t" });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/config_unavailable/);
  });

  it("reports an SMTP failure instead of raising it", async () => {
    // If this rejects, one dead relay takes the in-house notification and the
    // webhook down with it — three channels lost to one failure.
    const mail = withFallback(async () => CONFIGURED);
    const tx = stubTransport(async () => {
      throw new Error("535 auth failed");
    });

    const out = await mail.send(
      { to: ["a@b.cm"], subject: "s", text: "t" },
      tx,
    );

    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/535/);
  });
});

describe("platform mail — the sender identity", () => {
  it("sends from the fallback identity with its display name", async () => {
    const mail = withFallback(async () => CONFIGURED);
    let payload = null;
    const tx = stubTransport(async (p) => {
      payload = p;
      return { messageId: "<abc@praxisls.com>" };
    });

    const out = await mail.send(
      {
        to: ["ops@x.cm", "cto@x.cm"],
        subject: "[PRAXIS-LS] [FATAL] shipments",
        text: "body",
      },
      tx,
    );

    expect(out).toMatchObject({ ok: true, message_id: "<abc@praxisls.com>" });
    // G-8 — the fallback sender carries its display name.
    expect(payload.from).toBe('"Praxis" <no-reply@praxisls.com>');
    expect(payload.to).toBe("ops@x.cm, cto@x.cm");
    expect(payload.subject).toContain("[PRAXIS-LS]");
  });

  it("has no way for a caller to override From", async () => {
    // G-4, enforced by not accepting the parameter. On the fallback relay a
    // foreign From fails SPF/DKIM/DMARC, so the message would send and bounce —
    // the worst outcome for an alert.
    const mail = withFallback(async () => CONFIGURED);
    let payload = null;
    const tx = stubTransport(async (p) => {
      payload = p;
      return { messageId: "1" };
    });

    await mail.send(
      { to: ["a@b.cm"], subject: "s", text: "t", from: "spoof@evil.cm" },
      tx,
    );

    expect(payload.from).toBe('"Praxis" <no-reply@praxisls.com>');
  });

  it("carries reply_to only when the fallback defines one", async () => {
    const mail = withFallback(async () => ({
      ...CONFIGURED,
      reply_to: "oncall@praxisls.com",
    }));
    let payload = null;
    await mail.send(
      { to: ["a@b.cm"], subject: "s", text: "t" },
      stubTransport(async (p) => {
        payload = p;
        return { messageId: "1" };
      }),
    );
    expect(payload.replyTo).toBe("oncall@praxisls.com");

    const mail2 = withFallback(async () => CONFIGURED);
    let payload2 = null;
    await mail2.send(
      { to: ["a@b.cm"], subject: "s", text: "t" },
      stubTransport(async (p) => {
        payload2 = p;
        return { messageId: "1" };
      }),
    );
    expect(payload2).not.toHaveProperty("replyTo");
  });
});

describe("platform mail — no clash with the two documented email configs", () => {
  it("builds its transport with email.service's builder, not its own", async () => {
    // doc/EMAIL_TWO_CONFIGS.md defines exactly two configurations. This module
    // must stay a CONSUMER of System email's fallback tier. A second nodemailer
    // config would drift on the first TLS change, and the symptom is mail that
    // sends on one path and bounces on the other.
    jest.resetModules();
    let sawConfig = null;
    jest.doMock(
      path.join(__dirname, "../../src/services/email.service"),
      () => ({
        transportFrom: (cfg) => {
          sawConfig = cfg;
          return stubTransport(async () => ({ messageId: "1" }));
        },
      }),
    );
    jest.doMock(FALLBACK, () => ({
      resolve: async () => CONFIGURED,
      envDefaults: () => CONFIGURED,
    }));

    const mail = require(MAIL);
    await mail.send({ to: ["a@b.cm"], subject: "s", text: "t" });

    expect(sawConfig).toMatchObject({
      smtp_host: "smtp.example.com",
      smtp_port: 587,
    });
  });

  it("writes no tenant email_send_log row", async () => {
    // email_send_log is per-tenant and platform mail has no tenant. Logging it
    // under an arbitrary one would be worse than not logging it; the durable
    // record is the platform.error_escalation_log row.
    const mail = withFallback(async () => CONFIGURED);
    const repo = require("../../src/services/email.repo");
    const spy = jest.spyOn(repo, "recordSend").mockResolvedValue(undefined);

    await mail.send(
      { to: ["a@b.cm"], subject: "s", text: "t" },
      stubTransport(async () => ({ messageId: "1" })),
    );

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
