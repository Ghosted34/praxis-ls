/**
 * Origin tagging (PR-0). The stamp that tells apart mail we sent from mail the
 * user sent on their phone.
 *
 * These are worth testing exhaustively because the tag cannot be inferred
 * afterwards: it is stamped at send time or it is never known. A bug here is not
 * a wrong badge, it is a permanently unclassifiable message.
 */
"use strict";

const origin = require("../../src/modules/mail/mail/origin");

describe("buildOriginHeaders", () => {
  test("stamps only what it was given", () => {
    expect(origin.buildOriginHeaders({})).toEqual({
      "X-Praxis-Origin": "praxis-ls",
    });
  });

  test("carries tenant, user, send point and connection", () => {
    const h = origin.buildOriginHeaders({
      tenantSlug: "smartls",
      userId: "11111111-1111-1111-1111-111111111111",
      sendPoint: "invoice.issued",
      connectionId: "22222222-2222-2222-2222-222222222222",
    });
    expect(h["X-Praxis-Origin"]).toBe("praxis-ls");
    expect(h["X-Praxis-Tenant"]).toBe("smartls");
    expect(h["X-Praxis-User"]).toBe("11111111-1111-1111-1111-111111111111");
    expect(h["X-Praxis-Send-Point"]).toBe("invoice.issued");
    expect(h["X-Praxis-Connection"]).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
  });
});

describe("generateMessageId", () => {
  test("uses the sender's own domain, so the id is one we can claim", () => {
    expect(origin.generateMessageId("blake@smartlogistics.cm")).toMatch(
      /^<[0-9a-f-]{36}@smartlogistics\.cm>$/,
    );
  });

  test("falls back to praxisls.com rather than emitting a malformed domain", () => {
    for (const bad of [
      "",
      null,
      "not-an-address",
      "a@localhost",
      "a@bad domain.com",
    ]) {
      expect(origin.generateMessageId(bad)).toMatch(/@praxisls\.com>$/);
    }
  });

  test("is unique per call", () => {
    const a = origin.generateMessageId("x@y.cm");
    const b = origin.generateMessageId("x@y.cm");
    expect(a).not.toBe(b);
  });
});

describe("headerValue reads every shape a provider hands back", () => {
  const cases = [
    ["lowercase object (imapflow)", { "x-praxis-origin": "praxis-ls" }],
    ["exact-case object", { "X-Praxis-Origin": "praxis-ls" }],
    ["shouty object", { "X-PRAXIS-ORIGIN": "praxis-ls" }],
    [
      "name/value array (Gmail)",
      [{ name: "X-Praxis-Origin", value: "praxis-ls" }],
    ],
    ["Map (mailparser)", new Map([["x-praxis-origin", "praxis-ls"]])],
    ["array value", { "x-praxis-origin": ["praxis-ls"] }],
  ];
  test.each(cases)("%s", (_label, headers) => {
    expect(origin.classifyOutbound(headers)).toBe("PRAXIS");
  });

  test("absent header means somebody else sent it", () => {
    expect(origin.classifyOutbound({ subject: "hello" })).toBe("EXTERNAL");
    expect(origin.classifyOutbound(null)).toBe("EXTERNAL");
    expect(origin.classifyOutbound({})).toBe("EXTERNAL");
  });

  test("a different value is not our stamp", () => {
    expect(
      origin.classifyOutbound({ "x-praxis-origin": "something-else" }),
    ).toBe("EXTERNAL");
  });
});

describe("originFieldsFor", () => {
  test("an inbound message is never attributed to one of our users", () => {
    const f = origin.originFieldsFor({
      direction: "IN",
      headers: {
        "X-Praxis-Origin": "praxis-ls",
        "X-Praxis-User": "11111111-1111-1111-1111-111111111111",
      },
      messageIdHeader: "<a@b.cm>",
    });
    // The 10727 CHECK constraint forbids it; refusing here is the other half.
    expect(f).toEqual({
      sent_via: null,
      origin_user_id: null,
      origin_send_point: null,
      message_id_header: "<a@b.cm>",
    });
  });

  test("our own outbound carries its attribution", () => {
    const f = origin.originFieldsFor({
      direction: "OUT",
      headers: {
        "X-Praxis-Origin": "praxis-ls",
        "X-Praxis-User": "11111111-1111-1111-1111-111111111111",
        "X-Praxis-Send-Point": "invoice.issued",
      },
      messageIdHeader: "<a@b.cm>",
    });
    expect(f.sent_via).toBe("PRAXIS");
    expect(f.origin_user_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(f.origin_send_point).toBe("invoice.issued");
  });

  test("outbound with no stamp is EXTERNAL and attributed to nobody", () => {
    const f = origin.originFieldsFor({
      direction: "OUT",
      headers: { subject: "sent from my phone" },
    });
    expect(f.sent_via).toBe("EXTERNAL");
    // Attributing it to the connection owner would misattribute somebody's phone
    // reply to whoever happens to own the mailbox.
    expect(f.origin_user_id).toBeNull();
    expect(f.origin_send_point).toBeNull();
  });

  test("a non-uuid X-Praxis-User is dropped, not inserted", () => {
    // The header is attacker-influencable: anyone can put X-Praxis-User on a
    // message they send us. A malformed value would 22P02 the insert.
    const f = origin.originFieldsFor({
      direction: "OUT",
      headers: {
        "X-Praxis-Origin": "praxis-ls",
        "X-Praxis-User": "'; DROP TABLE app_user; --",
      },
    });
    expect(f.sent_via).toBe("PRAXIS");
    expect(f.origin_user_id).toBeNull();
  });

  test("a very long send point is truncated rather than rejected", () => {
    const f = origin.originFieldsFor({
      direction: "OUT",
      headers: {
        "X-Praxis-Origin": "praxis-ls",
        "X-Praxis-Send-Point": "x".repeat(500),
      },
    });
    expect(f.origin_send_point).toHaveLength(64);
  });
});
