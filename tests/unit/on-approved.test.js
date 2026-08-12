"use strict";
/** Approval dispatcher (BUILD_CONVENTIONS §2/§5). */
const onApproved = require("../../src/services/workflow/on-approved");

describe("on-approved dispatcher", () => {
  afterEach(() => onApproved._handlers.clear());

  it("routes an entity_ref to its registered handler with parsed id", async () => {
    const seen = [];
    onApproved.register("invoice", async (client, { id, entityRef }) => {
      seen.push({ id, entityRef });
      return { posted: true };
    });
    const r = await onApproved.dispatch({}, "invoice:abc-123", {
      user_id: "u1",
    });
    expect(r.dispatched).toBe(true);
    expect(r.result).toEqual({ posted: true });
    expect(seen).toEqual([{ id: "abc-123", entityRef: "invoice:abc-123" }]);
  });

  it("is a no-op when no handler is registered", async () => {
    const r = await onApproved.dispatch({}, "widget:1");
    expect(r.dispatched).toBe(false);
  });
});
