"use strict";

function classifyStatus(code) {
  const c = String(code || "");
  if (/^5\./.test(c) || c.startsWith("5")) return "HARD";
  if (/^4\./.test(c) || c.startsWith("4")) return "SOFT";
  return "DELAY";
}

function parseDsn({ contentType = "", body = "", headers = {} }) {
  const ct = String(contentType);
  if (!/multipart\/report/i.test(ct) || !/delivery-status/i.test(ct)) {
    return null;
  }
  const status = (body.match(/Status:\s*([0-9.]+)/i) || [])[1] || null;
  const recipient = (body.match(/Final-Recipient:\s*rfc822;\s*(\S+)/i) || [])[1] || null;
  const originalMatch = body.match(/Original-Message-ID:\s*(<[^>]+>)/i);
  const original = (originalMatch && originalMatch[1]) || headers["in-reply-to"] || null;
  const diagnostic = (body.match(/Diagnostic-Code:\s*(.+)/i) || [])[1] || null;
  return {
    bounce_type: classifyStatus(status),
    status_code: status,
    recipient: recipient ? String(recipient).replace(/^<|>$/g, "") : null,
    original_message_id_header: original,
    diagnostic,
  };
}

module.exports = { parseDsn, classifyStatus };
