import { describe, expect, it } from "vitest";
import { uploadProfileForSlot } from "./website-assets";

describe("website asset upload profiles", () => {
  it("keeps entity covers and portraits on the photo profile", () => {
    expect(uploadProfileForSlot("entity-cover")).toBe("photo");
    expect(uploadProfileForSlot("leader-portrait")).toBe("photo");
  });

  it("keeps brand marks on the source-preserving brand profile", () => {
    expect(uploadProfileForSlot("partner-mark")).toBe("brand");
    expect(uploadProfileForSlot("credential-mark")).toBe("brand");
  });
});
