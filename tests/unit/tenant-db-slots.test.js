"use strict";
/**
 * Found by scripts/load-calls.js (PR-5): with 2,000 parts queued at one
 * tenant, the part jobs (8 per worker) held 8 of that tenant's connections at
 * once against a pool of 4 (TENANT_POOL_MAX), so its own ring deadline and
 * ringing reads queued behind transcription. Background call work now takes
 * at most TENANT_POOL_MAX - 2 of a tenant's connections per process.
 */
const slots = require("../../src/jobs/tenant-db-slots");
const { config } = require("../../src/config/env");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("one tenant's background work never holds more than pool - 2 connections", async () => {
  let now = 0;
  let max = 0;
  const work = () => slots.withTenantSlot("busy", async () => {
    now += 1;
    max = Math.max(max, now);
    await sleep(5);
    now -= 1;
  });
  await Promise.all(Array.from({ length: 20 }, work));
  expect(max).toBe(Math.max(1, config.TENANT_POOL_MAX - 2));
});

test("another tenant is not held behind the busy one", async () => {
  let release;
  const blocker = new Promise((r) => { release = r; });
  const busy = Array.from({ length: 5 }, () => slots.withTenantSlot("busy2", () => blocker));
  let ran = false;
  await slots.withTenantSlot("quiet", async () => { ran = true; });
  expect(ran).toBe(true);
  release();
  await Promise.all(busy);
});

test("a throwing task releases its slot", async () => {
  const cap = Math.max(1, config.TENANT_POOL_MAX - 2);
  for (let i = 0; i < cap + 2; i += 1) {
    await expect(slots.withTenantSlot("t3", async () => { throw new Error("x"); })).rejects.toThrow("x");
  }
  await expect(slots.withTenantSlot("t3", async () => 7)).resolves.toBe(7);
  expect(slots.inUse("t3")).toBe(0);
});
