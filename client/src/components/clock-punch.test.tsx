/**
 * The title-bar clock chip.
 *
 * WHAT THESE PIN, and why each one is a bug that shipped or nearly did:
 *
 *   1. The chip is a real button with the SHIFT STATE in its accessible name.
 *      The visual signal is a 8px dot; a screen-reader user who only hears
 *      "Clock out" cannot tell whether that is an instruction or a description.
 *   2. Punching captures a GPS fix FIRST and still punches when the fix fails.
 *      The tenant `hr.geofence` policy decides whether a location-less punch is
 *      accepted; the client must not make that decision by refusing to send.
 *   3. A failed fix is REPORTED. The original swallowed it, so a user under the
 *      `warn` policy punched with no location and never knew.
 *   4. A user with no linked employee still sees a clock and is told why the
 *      punch did nothing, rather than seeing a dead control.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ClockPunchChip } from "@/components/clock-punch";
import * as api from "@/lib/hr-api";

/**
 * `deviceInfo` is mocked because the chip CALLS it — `clock-punch.tsx` passes
 * `device: api.deviceInfo()` on every punch. A factory that omits an export the
 * component uses does not merely leave it undefined: vitest replaces it with a
 * getter that throws, so the punch handler died before reaching `clockIn` and
 * three tests failed on "expected spy to be called" while the real defect sat in
 * the mock. The component rendered the vitest error message as its own label.
 */
vi.mock("@/lib/hr-api", () => ({
  openPunch: vi.fn(),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  getFix: vi.fn(),
  deviceInfo: vi.fn(),
}));

const mocked = vi.mocked(api);
const chip = () => screen.getByRole("button", { name: /Clock (in|out)\./ });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getFix.mockResolvedValue({ latitude: 4.05, longitude: 9.76, accuracy: 12 });
  mocked.openPunch.mockResolvedValue(null);
  mocked.clockIn.mockResolvedValue({ attendance_id: "a1", within_geofence: true } as never);
  mocked.clockOut.mockResolvedValue({ attendance_id: "a1" } as never);
});

describe("ClockPunchChip", () => {
  it("names the STATE, not just the verb", async () => {
    render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Clock in. Not clocked in" })).toBeInTheDocument();
  });

  it("reads an open shift as on the clock", async () => {
    mocked.openPunch.mockResolvedValue({ attendance_id: "a1", clock_in_at: "2026-08-15T07:00:00Z" } as never);
    render(<ClockPunchChip />);
    expect(await screen.findByRole("button", { name: "Clock out. On the clock" })).toBeInTheDocument();
  });

  it("captures a location fix before punching", async () => {
    render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.clockIn).toHaveBeenCalled());
    expect(mocked.getFix).toHaveBeenCalled();
    expect(mocked.clockIn).toHaveBeenCalledWith(expect.objectContaining({ latitude: 4.05, longitude: 9.76 }));
  });

  it("STILL PUNCHES when the fix fails, and says the location is missing", async () => {
    // The server owns the geofence policy. A client that refuses to send makes
    // that call itself — and under `warn` the punch was simply lost.
    mocked.getFix.mockRejectedValue(new Error("Location permission denied"));
    render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.clockIn).toHaveBeenCalledWith({}));
    expect(await screen.findByTitle(/no location/i)).toBeInTheDocument();
  });

  it("flags an off-site punch rather than reporting a clean clock-in", async () => {
    mocked.clockIn.mockResolvedValue({ attendance_id: "a1", within_geofence: false } as never);
    render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    await userEvent.click(chip());
    expect(await screen.findByTitle(/off-site/i)).toBeInTheDocument();
  });

  it("tells an unlinked user why nothing happened instead of going dead", async () => {
    mocked.openPunch.mockRejectedValue(new Error("403"));
    render(<ClockPunchChip />);
    const btn = await screen.findByRole("button", { name: /Time\./ });
    await userEvent.click(btn);
    expect(await screen.findByTitle(/isn't linked to an employee/i)).toBeInTheDocument();
    expect(mocked.clockIn).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    expect(await axe(container)).toHaveNoViolations();
  });
});
