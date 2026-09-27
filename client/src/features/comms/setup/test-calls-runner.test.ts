/**
 * Test calls, the device's half (calls audit PR-7): each device step turns
 * red on its own failure — push denied, a ring that never arrives, a blocked
 * microphone, a relay that refuses, a part that does not decode — and the run
 * carries on to the next step, skipping only what needs the missing piece.
 */
import { describe, it, expect, vi } from "vitest";
import { runDeviceSteps, SPEECH_LEVEL, type DeviceApi, type DeviceDeps } from "./test-calls-runner";
import type { DiagResult } from "@/lib/smartcomm-api";

const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
const ICE = { iceServers: [{ urls: ["stun:turn.example.test:3478"] }], turnConfigured: true };

function deps(over: Partial<DeviceDeps> = {}): DeviceDeps {
  let t = 1000;
  return {
    checkRing: async () => ({ permission: "granted", subscribed: true, endpoint: "https://push.test/e", installed: true, ios: false, soundBlocked: false }),
    waitForRing: async () => true,
    getMic: async () => stream,
    peakLevel: async () => 0.2,
    canPlay: async () => true,
    noiseFilter: async () => ({ status: "on", reason: null, inPeak: 0.2, outPeak: 0.15 }),
    stunAddress: async () => true,
    relayCall: async () => ({ connected: true, stats: { rttMs: 80, jitterMs: 5, lossPct: 0 } }),
    record: async () => [1, 2, 3].map((index) => ({ index, blob: new Blob(["x"]), durationMs: 3000, mimeType: "audio/webm" })),
    decodes: async () => true,
    now: () => (t += 50),
    ...over,
  };
}

function api(over: Partial<DeviceApi> = {}) {
  const reports: Record<string, DiagResult> = {};
  const uploads: number[] = [];
  const a: DeviceApi = {
    ring: async () => ({ nonce: "n1" }),
    ice: async () => ICE,
    report: async (key, result) => {
      reports[key] = result;
    },
    upload: async (index) => {
      uploads.push(index);
    },
    ...over,
  };
  return { a, reports, uploads };
}

const red = (reports: Record<string, DiagResult>) =>
  Object.entries(reports).filter(([, r]) => r.status === "fail").map(([k]) => k).sort();

describe("the device steps", () => {
  it("a healthy device passes 4–7 and uploads three parts for the server's check", async () => {
    const { a, reports, uploads } = api();
    await runDeviceSteps(a, deps());
    expect(Object.fromEntries(Object.entries(reports).map(([k, r]) => [k, r.status])))
      .toEqual({ ring: "pass", microphone: "pass", audio: "pass", connection: "pass" });
    expect(uploads).toEqual([1, 2, 3]);
    expect(reports.connection.detail).toMatchObject({ rtt_ms: 80, relay: true, stun: true });
  });

  it("push denied: only step 4, naming the fix", async () => {
    const { a, reports } = api();
    await runDeviceSteps(a, deps({ checkRing: async () => ({ permission: "denied", subscribed: false, endpoint: null, installed: true, ios: false, soundBlocked: false }) }));
    expect(red(reports)).toEqual(["ring"]);
    expect(reports.ring.code).toBe("PUSH_DENIED");
  });

  it("a ring that never reaches the device: step 4, after the wait", async () => {
    const waitForRing = vi.fn(async () => false);
    const { a, reports } = api();
    await runDeviceSteps(a, deps({ waitForRing }));
    expect(waitForRing).toHaveBeenCalledWith("n1", 10_000);
    expect(red(reports)).toEqual(["ring"]);
    expect(reports.ring.code).toBe("RING_NOT_RECEIVED");
  });

  it("a blocked microphone: step 5 red, 6 and 8 skipped, 7 still runs", async () => {
    const { a, reports, uploads } = api();
    await runDeviceSteps(a, deps({ getMic: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); } }));
    expect(red(reports)).toEqual(["microphone"]);
    expect(reports.microphone.code).toBe("MIC_BLOCKED");
    expect(reports.audio.status).toBe("skipped");
    expect(reports.recording.status).toBe("skipped");
    expect(reports.connection.status).toBe("pass");
    expect(uploads).toEqual([]);
  });

  it("a silent microphone is named as silent, not blocked", async () => {
    const { a, reports } = api();
    await runDeviceSteps(a, deps({ peakLevel: async () => SPEECH_LEVEL / 4 }));
    expect(reports.microphone.code).toBe("MIC_SILENT");
  });

  it("a relay that refuses (a wrong TURN secret): step 7 only", async () => {
    const { a, reports } = api();
    await runDeviceSteps(a, deps({ relayCall: async () => ({ connected: false, stats: { rttMs: null, jitterMs: null, lossPct: null } }) }));
    expect(red(reports)).toEqual(["connection"]);
    expect(reports.connection.code).toBe("RELAY_REFUSED");
  });

  it("no relay configured is a warning when STUN works", async () => {
    const { a, reports } = api({ ice: async () => ({ ...ICE, turnConfigured: false }) });
    await runDeviceSteps(a, deps());
    expect(reports.connection).toMatchObject({ status: "warn", code: "NO_RELAY" });
  });

  it("a noise filter that sends silence over speech: step 6", async () => {
    const { a, reports } = api();
    await runDeviceSteps(a, deps({ noiseFilter: async () => ({ status: "on", reason: null, inPeak: 0.2, outPeak: 0 }) }));
    expect(red(reports)).toEqual(["audio"]);
    expect(reports.audio.code).toBe("FILTER_SILENT");
  });

  it("a part that does not decode alone: step 8, and nothing is uploaded", async () => {
    const { a, reports, uploads } = api();
    await runDeviceSteps(a, deps({ decodes: vi.fn(async (b: Blob) => b.size !== 2) as DeviceDeps["decodes"], record: async () => [
      { index: 1, blob: new Blob(["x"]), durationMs: 3000, mimeType: "audio/webm" },
      { index: 2, blob: new Blob(["xy"]), durationMs: 3000, mimeType: "audio/webm" },
      { index: 3, blob: new Blob(["x"]), durationMs: 3000, mimeType: "audio/webm" },
    ] }));
    expect(red(reports)).toEqual(["recording"]);
    expect(reports.recording.code).toBe("PART_UNDECODABLE");
    expect(uploads).toEqual([]);
  });

  it("a step that throws is reported as failed and the run goes on", async () => {
    const { a, reports } = api({ ice: async () => { throw new Error("network down"); } });
    await runDeviceSteps(a, deps());
    expect(reports.connection).toMatchObject({ status: "fail", code: "DEVICE_ERROR" });
    expect(reports.ring.status).toBe("pass");
  });
});
