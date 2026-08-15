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

// `deviceInfo` is here because the punch now sends a device fingerprint with
// every clock-in (0524). A factory mock replaces the WHOLE module, so an export
// it omits is not undefined — vitest substitutes a stub that throws on access,
// and the throw surfaced as the error text rendered into the chip's own label.
// Worth remembering when adding to the component: this mock has to keep up.
vi.mock("@/lib/hr-api", () => ({
  openPunch: vi.fn(),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  getFix: vi.fn(),
  deviceInfo: vi.fn(),
}));

const mocked = vi.mocked(api);
const chip = () => screen.getByRole("button", { name: /Clock (in|out)\./ });

const DEVICE = { fingerprint: "abcdef0123456789", platform: "Win32" };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getFix.mockResolvedValue({
    latitude: 4.05,
    longitude: 9.76,
    accuracy: 12,
  });
  mocked.openPunch.mockResolvedValue(null);
  mocked.deviceInfo.mockReturnValue(DEVICE);
  mocked.clockIn.mockResolvedValue({
    attendance_id: "a1",
    within_geofence: true,
  } as never);
  mocked.clockOut.mockResolvedValue({ attendance_id: "a1" } as never);
});

describe("ClockPunchChip", () => {
  it("names the STATE, not just the verb", async () => {
    render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: "Clock in. Not clocked in" }),
    ).toBeInTheDocument();
  });

  it("reads an open shift as on the clock", async () => {
    mocked.openPunch.mockResolvedValue({
      attendance_id: "a1",
      clock_in_at: "2026-08-15T07:00:00Z",
    } as never);
    render(<ClockPunchChip />);
    expect(
      await screen.findByRole("button", { name: "Clock out. On the clock" }),
    ).toBeInTheDocument();
  });

  it("captures a location fix before punching", async () => {
    render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.clockIn).toHaveBeenCalled());
    expect(mocked.getFix).toHaveBeenCalled();
    expect(mocked.clockIn).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 4.05, longitude: 9.76 }),
    );
  });

  it("STILL PUNCHES when the fix fails, and says the location is missing", async () => {
    // The server owns the geofence policy. A client that refuses to send makes
    // that call itself — and under `warn` the punch was simply lost.
    mocked.getFix.mockRejectedValue(new Error("Location permission denied"));
    render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.clockIn).toHaveBeenCalled());
    // Asserted as the ABSENCE of coordinates rather than as an exact payload.
    // The exact-object form broke the moment the device rode along, which is a
    // test failing for a change it was never about — and the claim here is only
    // ever "it punched, and it sent no location it did not have".
    const sent = mocked.clockIn.mock.calls[0][0];
    expect(sent.latitude).toBeUndefined();
    expect(sent.longitude).toBeUndefined();
    expect(await screen.findByTitle(/no location/i)).toBeInTheDocument();
  });

  it("sends the device fingerprint with the punch", async () => {
    // Registration happens ON the punch, not as a separate call: a tenant on the
    // `block` policy would otherwise have a chicken-and-egg problem, since you
    // cannot get on the register without punching and cannot punch without
    // being on it. If this stops being sent, that policy silently refuses
    // everyone.
    render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.clockIn).toHaveBeenCalled());
    expect(mocked.clockIn.mock.calls[0][0].device).toEqual(DEVICE);
  });

  it("punches anyway when the browser cannot keep a device id", async () => {
    // Private mode / an embedded webview: `deviceInfo()` returns null. The
    // SERVER decides whether a missing fingerprint is acceptable (hr.device_policy),
    // so the client must still send the punch and let it answer.
    mocked.deviceInfo.mockReturnValue(null);
    render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    await userEvent.click(chip());
    await waitFor(() => expect(mocked.clockIn).toHaveBeenCalled());
    expect(mocked.clockIn.mock.calls[0][0].device).toBeNull();
  });

  it("flags an off-site punch rather than reporting a clean clock-in", async () => {
    mocked.clockIn.mockResolvedValue({
      attendance_id: "a1",
      within_geofence: false,
    } as never);
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
    expect(
      await screen.findByTitle(/isn't linked to an employee/i),
    ).toBeInTheDocument();
    expect(mocked.clockIn).not.toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ClockPunchChip />);
    await waitFor(() => expect(mocked.openPunch).toHaveBeenCalled());
    expect(await axe(container)).toHaveNoViolations();
  });
});
