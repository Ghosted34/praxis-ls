"use strict";

const n = require("../../src/modules/notification/notification.service");

describe("notification dedupe", () => {
  beforeEach(() => n.recentDedupe.clear());

  test("the same key within 60s is suppressed", () => {
    expect(n.shouldDedupe("MENTION:note:1:u1")).toBe(false);
    expect(n.shouldDedupe("MENTION:note:1:u1")).toBe(true);
  });

  test("a different key is not suppressed", () => {
    n.shouldDedupe("MENTION:note:1:u1");
    expect(n.shouldDedupe("MENTION:note:1:u2")).toBe(false);
  });
});
