"use strict";

function cancelOnReply(rows, threadId) {
  return (rows || []).map((r) => {
    if (r.email_thread_id === threadId && r.cancel_on_reply && r.status === "PENDING" && r.kind === "NO_REPLY") {
      return { ...r, status: "CANCELLED" };
    }
    return r;
  });
}

function due(rows, now = new Date()) {
  return (rows || []).filter((r) => r.status === "PENDING" && new Date(r.due_at) <= now);
}

module.exports = { cancelOnReply, due };
