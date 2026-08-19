import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SitePill } from "./attendance-site-pill";

describe("SitePill", () => {
  it("shouts No GPS and Off-site, mutes no-worksite", () => {
    const { rerender } = render(<SitePill status="no_gps" />);
    expect(screen.getByText("No GPS")).toBeInTheDocument();
    rerender(<SitePill status="off_site" />);
    expect(screen.getByText("Off-site")).toBeInTheDocument();
    rerender(<SitePill status="on_site" />);
    expect(screen.getByText("On-site")).toBeInTheDocument();
    rerender(<SitePill status="unfenced" />);
    expect(screen.getByText("No worksite")).toBeInTheDocument();
  });
});
