"use strict";
const { parseDsn } = require("../../src/modules/mail/triage/bounce-parse");

describe("RFC 3464 DSN", () => {
  test("a 5.1.1 is a hard bounce correlated by Original-Message-ID", () => {
    const r = parseDsn({
      contentType: "multipart/report; report-type=delivery-status",
      body: "Final-Recipient: rfc822; x@y.cm\nStatus: 5.1.1\nOriginal-Message-ID: <abc@praxis>\nDiagnostic-Code: smtp; 550 mailbox does not exist",
    });
    expect(r.bounce_type).toBe("HARD");
    expect(r.status_code).toBe("5.1.1");
    expect(r.recipient).toBe("x@y.cm");
    expect(r.original_message_id_header).toBe("<abc@praxis>");
  });

  test("ordinary mail is not parsed as a DSN", () => {
    expect(parseDsn({ contentType: "text/plain", body: "hello" })).toBeNull();
  });
});
