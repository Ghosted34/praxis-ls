import { describe, expect, it } from "vitest";
import {
  addTenantDays,
  addWallMinutes,
  dateFromTenantDay,
  tenantDateTimeFmt,
  tenantDay,
  tenantToday,
  tenantWallInput,
} from "./time";

describe("tenant Workspace time boundary", () => {
  const instant = "2026-09-18T22:30:00.000Z";

  it("uses the tenant day rather than the browser day", () => {
    expect(tenantDay(instant, "Africa/Douala")).toBe("2026-09-18");
    expect(tenantDay(instant, "Asia/Tokyo")).toBe("2026-09-19");
  });

  it("seeds a zoneless input with the tenant wall clock", () => {
    expect(tenantWallInput(instant, "Africa/Douala")).toBe("2026-09-18T23:30");
    expect(tenantWallInput(instant, "America/New_York")).toBe(
      "2026-09-18T18:30",
    );
  });

  it("formats the same instant in the tenant timezone", () => {
    expect(tenantDateTimeFmt(instant, "Africa/Douala")).toContain("23:30");
  });

  it("moves calendar dates without letting DST or the browser timezone intervene", () => {
    expect(addTenantDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(addTenantDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(dateFromTenantDay("2026-09-18")?.getDate()).toBe(18);
  });

  it("keeps a form default on the wall clock", () => {
    expect(addWallMinutes("2026-09-18T23:30", 60)).toBe("2026-09-19T00:30");
    expect(tenantToday("Asia/Tokyo", new Date(instant))).toBe("2026-09-19");
  });
});
