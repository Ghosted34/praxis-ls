/**
 * Comms → Setup → Test calls: the device's half of a run (calls audit PR-7,
 * O5). The server proves the worker, the schedules, the providers and the
 * clean-up; this proves what only the runner's device can:
 *
 *   4 ring        a real ring push reaches THIS device: the service worker
 *                 echoes the run's nonce back to the page (≤ 10 s), and the
 *                 A15 device check is green
 *   5 microphone  permission, a device, a voice level while they read
 *   6 audio       sound would play; the yard noise filter loads and is not
 *                 silent over speech
 *   7 connection  STUN finds a public address; a TURN credential is minted;
 *                 a relayed call to itself connects (RTT, jitter, loss)
 *   8 recording   three short parts from the real CallRecorder, each decoded
 *                 on its own, then uploaded for the server's container check
 *
 * Every browser API is behind `DeviceDeps`, so the order, the timeouts and
 * the verdicts are tested without a microphone; the defaults are the real
 * ones (the same recorder, noise filter and device check the calls use).
 */
import { tr, tv } from "@/lib/i18n";
import type { DiagResult, IceConfig } from "@/lib/smartcomm-api";
import { checkDeviceRing, needsInstall, type DeviceRingStatus } from "../call/device-ring-check";
import { applyNoiseSuppression } from "../call/noise-suppression";
import { CallRecorder, type RecorderPart } from "../call/call-recorder";

export const RING_WAIT_MS = 10_000;
export const LEVEL_MS = 5_000;
export const PART_MS = 3_000;
export const PARTS = 3;
export const RELAY_WAIT_MS = 15_000;
export const RELAY_CALL_MS = 10_000;
/** RMS of a speaking voice at arm's length is well above this; silence is ~0. */
export const SPEECH_LEVEL = 0.02;

export type ConnectionStats = { rttMs: number | null; jitterMs: number | null; lossPct: number | null };

export type DeviceDeps = {
  checkRing: () => Promise<DeviceRingStatus>;
  /** Resolves when the service worker echoes `nonce`, or false after `ms`. */
  waitForRing: (nonce: string, ms: number) => Promise<boolean>;
  getMic: () => Promise<MediaStream>;
  /** The loudest RMS level heard on `stream` over `ms`. */
  peakLevel: (stream: MediaStream, ms: number) => Promise<number>;
  /** Whether this page may play sound now (the autoplay policy). */
  canPlay: () => Promise<boolean>;
  /** The noise filter over `stream`: its status, and its output's peak while speech goes in. */
  noiseFilter: (stream: MediaStream, ms: number) => Promise<{ status: "on" | "off" | "unavailable"; reason: string | null; inPeak: number; outPeak: number }>;
  /** A public (server-reflexive) address from the STUN servers, or null. */
  stunAddress: (ice: IceConfig) => Promise<boolean>;
  /** A call from this page to itself through the relay only. */
  relayCall: (ice: IceConfig, waitMs: number, callMs: number) => Promise<{ connected: boolean; stats: ConnectionStats }>;
  /** `n` parts of `ms` each from the real recorder. */
  record: (stream: MediaStream, n: number, ms: number) => Promise<RecorderPart[]>;
  /** Whether one part decodes on its own. */
  decodes: (blob: Blob) => Promise<boolean>;
  now: () => number;
};

export type DeviceApi = {
  ring: (endpoint: string) => Promise<{ nonce: string }>;
  ice: () => Promise<IceConfig & { turnConfigured?: boolean }>;
  report: (key: "ring" | "microphone" | "audio" | "connection" | "recording", result: DiagResult) => Promise<unknown>;
  upload: (index: number, file: File) => Promise<unknown>;
};

export type DevicePhase = "ring" | "microphone" | "audio" | "connection" | "recording" | "done";

const pass = (ms?: number, detail?: DiagResult["detail"]): DiagResult => ({ status: "pass", ms: ms ?? null, detail });

/** Step 4. */
export async function ringStep(api: DeviceApi, deps: DeviceDeps): Promise<DiagResult> {
  const s = await deps.checkRing();
  if (s.permission === "denied") {
    return {
      status: "fail", code: "PUSH_DENIED",
      cause: tr("Notifications are blocked for Praxis on this device, so a call cannot ring here with the app closed."),
      fix: tr("Allow notifications for this site in the browser's settings, then run the test again."),
    };
  }
  if (s.permission === "unsupported" || !s.endpoint) {
    return {
      status: "fail", code: "PUSH_NOT_SET_UP",
      cause: s.permission === "unsupported"
        ? tr("This browser cannot receive push notifications.")
        : tr("This device is not set up to ring for calls yet."),
      fix: needsInstall(s)
        ? tr("On iPhone and iPad, add Praxis to the Home Screen and open it from there.")
        : tr("Open Settings → Calls → This device and turn ringing on."),
    };
  }
  const t0 = deps.now();
  const { nonce } = await api.ring(s.endpoint);
  const heard = await deps.waitForRing(nonce, RING_WAIT_MS);
  const ms = deps.now() - t0;
  if (!heard) {
    return {
      status: "fail", code: "RING_NOT_RECEIVED", ms,
      cause: tv("The test ring was sent but did not reach this device within {{s}} seconds.", { s: RING_WAIT_MS / 1000 }),
      fix: tr("Check that notifications are on for this site and the device is not in a focus or battery-saver mode."),
    };
  }
  if (s.soundBlocked) {
    return {
      status: "warn", code: "RING_SILENT", ms,
      cause: tr("The ring arrived, but the ring tone is silent until you tap the page once."),
      fix: tr("Tap anywhere in Praxis after opening it; the next ring will sound."),
    };
  }
  return pass(ms);
}

/** Step 5. The stream is kept for steps 6 and 8. */
export async function microphoneStep(deps: DeviceDeps): Promise<{ result: DiagResult; stream: MediaStream | null }> {
  let stream: MediaStream;
  try {
    stream = await deps.getMic();
  } catch (err) {
    const name = (err as { name?: string } | null)?.name || "";
    const blocked = name === "NotAllowedError" || name === "SecurityError";
    return {
      stream: null,
      result: {
        status: "fail", code: blocked ? "MIC_BLOCKED" : "MIC_UNAVAILABLE",
        cause: blocked
          ? tr("The microphone is blocked for Praxis in this browser.")
          : tr("No microphone could be opened on this device."),
        fix: blocked
          ? tr("Allow the microphone for this site in the browser's settings, then run the test again.")
          : tr("Plug in or select a microphone in the device's sound settings."),
      },
    };
  }
  const peak = await deps.peakLevel(stream, LEVEL_MS);
  const level = Math.round(peak * 1000) / 1000;
  return {
    stream,
    result: peak >= SPEECH_LEVEL
      ? pass(LEVEL_MS, { level })
      : {
        status: "fail", code: "MIC_SILENT", detail: { level },
        cause: tr("The microphone opened but heard no voice while you read the sentence."),
        fix: tr("Check the device is not muted and the right microphone is selected, then speak closer."),
      },
  };
}

/** Step 6. */
export async function audioStep(stream: MediaStream, deps: DeviceDeps): Promise<DiagResult> {
  const playable = await deps.canPlay();
  const filter = await deps.noiseFilter(stream, LEVEL_MS);
  const detail = { sound: playable, filter: filter.status, filter_reason: filter.reason };
  if (!playable) {
    return {
      status: "warn", code: "SOUND_BLOCKED", detail,
      cause: tr("The browser holds call sound until you tap the page."),
      fix: tr("Tap once in Praxis when a call starts; the call screen offers a Tap to hear button."),
    };
  }
  if (filter.status === "unavailable") {
    return {
      status: "warn", code: "FILTER_UNAVAILABLE", detail,
      cause: tv("The yard noise filter could not load on this device ({{reason}}); calls work without it.", { reason: filter.reason || "unknown" }),
      fix: tr("Update the browser; calls still carry the browser's own noise suppression."),
    };
  }
  if (filter.inPeak >= SPEECH_LEVEL && filter.outPeak < SPEECH_LEVEL / 10) {
    return {
      status: "fail", code: "FILTER_SILENT", detail,
      cause: tr("The noise filter sent silence while you spoke, so the other side would hear nothing with it on."),
      fix: tr("Turn the yard noise filter off for yourself in Settings → Calls, and tell support which device this is."),
    };
  }
  return pass(undefined, detail);
}

/** Step 7. */
export async function connectionStep(api: DeviceApi, deps: DeviceDeps): Promise<DiagResult> {
  const t0 = deps.now();
  const ice = await api.ice();
  const stun = await deps.stunAddress(ice);
  if (!ice.turnConfigured) {
    return {
      status: stun ? "warn" : "fail", code: stun ? "NO_RELAY" : "NO_NETWORK_PATH", ms: deps.now() - t0,
      detail: { stun, relay: false },
      cause: stun
        ? tr("No call relay is configured for your company: calls between two mobile networks may not connect.")
        : tr("This device could not find its public address and no call relay is configured, so calls will not connect from this network."),
      fix: tr("Tell support to configure the call relay (TURN)."),
    };
  }
  const call = await deps.relayCall(ice, RELAY_WAIT_MS, RELAY_CALL_MS);
  const detail = {
    stun, relay: call.connected,
    rtt_ms: call.stats.rttMs, jitter_ms: call.stats.jitterMs, loss_pct: call.stats.lossPct,
  };
  if (!call.connected) {
    return {
      status: "fail", code: "RELAY_REFUSED", ms: deps.now() - t0, detail,
      cause: tv("A test call through the relay did not connect within {{s}} seconds: the relay refused the credential or its ports are blocked from this network.", { s: RELAY_WAIT_MS / 1000 }),
      fix: tr("Try another network; if it fails everywhere, tell support the relay (TURN) is refusing calls."),
    };
  }
  const slow = (call.stats.rttMs ?? 0) > 400;
  const lossy = (call.stats.lossPct ?? 0) > 5;
  if (slow || lossy) {
    return {
      status: "warn", code: slow ? "HIGH_LATENCY" : "PACKET_LOSS", ms: deps.now() - t0, detail,
      cause: slow
        ? tv("The relayed call connected, with a {{ms}} ms round trip: speech will lag.", { ms: Math.round(call.stats.rttMs ?? 0) })
        : tv("The relayed call connected, losing {{pct}}% of its audio.", { pct: Math.round(call.stats.lossPct ?? 0) }),
      fix: tr("A calmer network (Wi-Fi rather than one bar of 4G) will sound better."),
    };
  }
  return pass(deps.now() - t0, detail);
}

/** Step 8: three parts, each decoded alone, then uploaded for the server's check. */
export async function recordingStep(stream: MediaStream, api: DeviceApi, deps: DeviceDeps): Promise<DiagResult | null> {
  let parts: RecorderPart[];
  try {
    parts = await deps.record(stream, PARTS, PART_MS);
  } catch (err) {
    return {
      status: "fail", code: "RECORDER_FAILED",
      cause: tv("This browser could not record: {{msg}}", { msg: String((err as Error)?.message || err).slice(0, 120) }),
      fix: tr("Update the browser; if it persists, tell support which browser this is."),
    };
  }
  if (parts.length < PARTS) {
    return {
      status: "fail", code: "PARTS_MISSING", detail: { parts: parts.length },
      cause: tv("The recorder produced {{n}} of {{total}} parts.", { n: parts.length, total: PARTS }),
      fix: tr("Update the browser; if it persists, tell support which browser this is."),
    };
  }
  const decoded = await Promise.all(parts.map((p) => deps.decodes(p.blob)));
  const bad = decoded.map((ok, i) => (ok ? null : i + 1)).filter((x): x is number => x !== null);
  if (bad.length) {
    return {
      status: "fail", code: "PART_UNDECODABLE", detail: { undecodable: bad.join(",") },
      cause: tv("Part {{parts}} does not play on its own, so it could not be transcribed.", { parts: bad.join(", ") }),
      fix: tr("Update the browser; if it persists, tell support which browser this is."),
    };
  }
  for (const p of parts) {
    const ext = p.mimeType.includes("mp4") ? "mp4" : p.mimeType.includes("ogg") ? "ogg" : "webm";
    await api.upload(p.index, new File([p.blob], `part_${p.index}.${ext}`, { type: p.mimeType || "audio/webm" }));
  }
  // The server's container check passes the step.
  return null;
}

/**
 * Steps 4–8 in order. Each is reported as it finishes; one that throws is
 * reported as failed with the error, and the run goes on to the next.
 */
export async function runDeviceSteps(
  api: DeviceApi,
  deps: DeviceDeps,
  onPhase: (p: DevicePhase) => void = () => {},
): Promise<void> {
  const guard = async (key: "ring" | "microphone" | "audio" | "connection" | "recording", fn: () => Promise<DiagResult | null>) => {
    onPhase(key);
    let result: DiagResult | null;
    try {
      result = await fn();
    } catch (err) {
      result = {
        status: "fail", code: "DEVICE_ERROR",
        cause: String((err as Error)?.message || err).slice(0, 300),
        fix: tr("Run the test again; if it repeats, copy the report for support."),
      };
    }
    if (result) await api.report(key, result);
  };

  await guard("ring", () => ringStep(api, deps));
  let stream: MediaStream | null = null;
  await guard("microphone", async () => {
    const out = await microphoneStep(deps);
    stream = out.stream;
    return out.result;
  });
  const mic = stream as MediaStream | null;
  if (mic) {
    await guard("audio", () => audioStep(mic, deps));
  } else {
    await guard("audio", async () => ({ status: "skipped", cause: tr("Needs the microphone (step 5).") }));
  }
  await guard("connection", () => connectionStep(api, deps));
  if (mic) {
    await guard("recording", () => recordingStep(mic, api, deps));
    mic.getTracks().forEach((t) => t.stop());
  } else {
    await guard("recording", async () => ({ status: "skipped", cause: tr("Needs the microphone (step 5).") }));
  }
  onPhase("done");
}

// ── The real browser ────────────────────────────────────────────────────────

function audioContext(): AudioContext | null {
  const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  return Ctor ? new Ctor() : null;
}

async function peakOf(stream: MediaStream, ms: number): Promise<number> {
  const ctx = audioContext();
  if (!ctx) return 0;
  try {
    if (ctx.state === "suspended") await ctx.resume().catch(() => {
      /* @silent:teardown — a context that stays suspended measures 0, which the step reports. */
    });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      peak = Math.max(peak, Math.sqrt(sum / buf.length));
      await new Promise((r) => setTimeout(r, 100));
    }
    return peak;
  } finally {
    void ctx.close();
  }
}

async function statsOf(pc: RTCPeerConnection): Promise<ConnectionStats> {
  let rttMs: number | null = null;
  let jitterMs: number | null = null;
  let lossPct: number | null = null;
  const report = await pc.getStats();
  report.forEach((s) => {
    const r = s as Record<string, unknown>;
    if (r.type === "candidate-pair" && r.state === "succeeded" && typeof r.currentRoundTripTime === "number") {
      rttMs = (r.currentRoundTripTime as number) * 1000;
    }
    if (r.type === "inbound-rtp" && r.kind === "audio") {
      if (typeof r.jitter === "number") jitterMs = (r.jitter as number) * 1000;
      const lost = Number(r.packetsLost || 0);
      const got = Number(r.packetsReceived || 0);
      if (lost + got > 0) lossPct = (lost / (lost + got)) * 100;
    }
  });
  return { rttMs, jitterMs, lossPct };
}

export const browserDeps: DeviceDeps = {
  checkRing: () => checkDeviceRing(),
  waitForRing: (nonce, ms) => new Promise((resolve) => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw) return resolve(false);
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; nonce?: string } | null;
      if (d && d.type === "praxis:call-test" && d.nonce === nonce) {
        clearTimeout(timer);
        sw.removeEventListener("message", onMessage);
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      sw.removeEventListener("message", onMessage);
      resolve(false);
    }, ms);
    sw.addEventListener("message", onMessage);
  }),
  getMic: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }),
  peakLevel: peakOf,
  canPlay: async () => {
    const ctx = audioContext();
    if (!ctx) return false;
    try {
      if (ctx.state === "suspended") await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
      return ctx.state === "running";
    } finally {
      void ctx.close();
    }
  },
  noiseFilter: async (stream, ms) => {
    const out = await applyNoiseSuppression(stream.clone(), {});
    try {
      if (out.status !== "on") return { status: out.status, reason: out.reason, inPeak: 0, outPeak: 0 };
      const [inPeak, outPeak] = await Promise.all([peakOf(stream, ms), peakOf(out.stream, ms)]);
      return { status: "on", reason: null, inPeak, outPeak };
    } finally {
      out.stop();
    }
  },
  stunAddress: async (ice) => {
    const stunOnly = ice.iceServers.filter((s) => [s.urls].flat().some((u) => String(u).startsWith("stun:")));
    if (!stunOnly.length) return false;
    const pc = new RTCPeerConnection({ iceServers: stunOnly });
    try {
      pc.createDataChannel("probe");
      const found = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 5000);
        pc.onicecandidate = (e) => {
          if (e.candidate && / typ srflx /.test(e.candidate.candidate)) {
            clearTimeout(timer);
            resolve(true);
          } else if (!e.candidate) {
            clearTimeout(timer);
            resolve(false);
          }
        };
      });
      await pc.setLocalDescription(await pc.createOffer());
      return await found;
    } finally {
      pc.close();
    }
  },
  relayCall: async (ice, waitMs, callMs) => {
    const cfg: RTCConfiguration = { iceServers: ice.iceServers, iceTransportPolicy: "relay" };
    const a = new RTCPeerConnection(cfg);
    const b = new RTCPeerConnection(cfg);
    const ctx = audioContext();
    try {
      a.onicecandidate = (e) => { if (e.candidate) void b.addIceCandidate(e.candidate); };
      b.onicecandidate = (e) => { if (e.candidate) void a.addIceCandidate(e.candidate); };
      if (ctx) {
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest);
        osc.start();
        dest.stream.getTracks().forEach((t) => a.addTrack(t, dest.stream));
      } else {
        a.createDataChannel("probe");
      }
      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(a.localDescription!);
      await b.setLocalDescription(await b.createAnswer());
      await a.setRemoteDescription(b.localDescription!);
      const connected = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), waitMs);
        const check = () => {
          if (b.iceConnectionState === "connected" || b.iceConnectionState === "completed") {
            clearTimeout(timer);
            resolve(true);
          } else if (b.iceConnectionState === "failed") {
            clearTimeout(timer);
            resolve(false);
          }
        };
        b.oniceconnectionstatechange = check;
        check();
      });
      if (!connected) return { connected, stats: { rttMs: null, jitterMs: null, lossPct: null } };
      await new Promise((r) => setTimeout(r, callMs));
      const [sa, sb] = await Promise.all([statsOf(a), statsOf(b)]);
      return { connected, stats: { rttMs: sa.rttMs ?? sb.rttMs, jitterMs: sb.jitterMs, lossPct: sb.lossPct } };
    } finally {
      a.close();
      b.close();
      if (ctx) void ctx.close();
    }
  },
  record: async (stream, n, ms) => {
    // The calls' own recorder, with a part every `ms` instead of every 2 min.
    const parts: RecorderPart[] = [];
    const rec = new CallRecorder({
      callId: "diagnostics",
      side: "caller",
      language: "en",
      deps: { onPart: (p) => { parts.push(p); }, partMs: ms },
    });
    await rec.arm(stream);
    // Stop just before the n-th boundary, so finish() closes part n.
    await new Promise((r) => setTimeout(r, n * ms - 250));
    await rec.finish();
    return parts.slice(0, n);
  },
  decodes: async (blob) => {
    const ctx = audioContext();
    if (!ctx) return false;
    try {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      return buf.duration > 0.5;
    } catch {
      /* @silent:parse — "does not decode" is exactly the answer being asked for. */
      return false;
    } finally {
      void ctx.close();
    }
  },
  now: () => Date.now(),
};
