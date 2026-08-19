"use strict";
// Mail engine events (registered in migration 0480). MOD-64 = Comms surface.
module.exports = {
  MODULE: "MOD-64",
  RECEIVED: "email.received",
  SENT: "email.sent",
  ref: (id) => "email_connection:" + id,
  msgRef: (id) => "email_message:" + id,
};
