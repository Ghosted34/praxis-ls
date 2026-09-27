/**
 * Call session (PR-1) — the wiring between server, socket and engine.
 *
 * The state machine itself is the BACKEND's (covered in
 * tests/unit/smartcomm-calls.test.js); what lives in THIS file is the tab's
 * half: a ring arrives, we buffer the offer that precedes the answer, we
 * hand the server the user's intent, and a terminal event from ANY writer
 * (this tab, the other tab, the sweep) lands the session in the row's state.
 * The fake socket and fake RTCPeerConnection are the whole world.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { FakePeerConnection, settle } from "@/test/fake-peer-connection";

// Everything the vi.mock factories need lives here: vitest hoists the
// factories above this file's consts, and they may only see hoisted values.
const W = vi.hoisted(() => {
  const ME = "11111111-1111-1111-1111-111111111111";
  const THEM = "22222222-2222-2222-2222-222222222222";
  const ICE = { iceServers: [{ urls: ["stun:stun.example.com:3478"] }], turnConfigured: false };
  const handlers: Record<string, Array<(p: unknown) => void>> = {};
  const calls: Array<[string, unknown]> = [];
  const socket = {
    on: (ev: string, fn: (p: unknown) => void) => {
      (handlers[ev] ||= []).push(fn);
    },
    off: () => {},
    emit: (ev: string, payload: unknown) => {
      calls.push([ev, payload]);
    },
    connected: true,
  };
  const row = (over: Record<string, unknown>) => ({
    call_id: "c1", group_id: "g1", caller_id: ME, callee_id: THEM,
    status: "RINGING", started_at: new Date().toISOString(), ...over,
  });
  // The api fakes are REPLACEABLE (not vi.fn — vi is not available inside
  // hoisted): a test swaps one to throw, the next test restores it.
  const api: Record<string, (id?: string) => Promise<Record<string, unknown>>> = {
    dialCall: async () => row({ ice: ICE }),
    acceptCall: async () => row({ status: "IN_CALL", connected_at: new Date().toISOString(), ice: ICE }),
    declineCall: async () => row({ status: "DECLINED", end_reason: "declined" }),
    hangupCall: async () => row({ status: "ENDED", end_reason: "hangup" }),
    reportCallFailure: async () => row({ status: "FAILED", end_reason: "ice_failed" }),
    getCall: async () => row({ status: "NO_ANSWER", end_reason: "no_answer" }),
    getRingingCalls: async () => [] as unknown as Record<string, unknown>,
    getCallTurn: async () => ICE,
  };
  const completes: Array<[string, unknown]> = [];
  const hits: Record<string, number> = {};
  return { ME, THEM, ICE, handlers, calls, socket, row, api, completes, hits, acceptOpts: undefined as unknown };
});

vi.mock("@/lib/comms-socket", () => ({
  getCommsSocket: () => W.socket,
  disconnectCommsSocket: () => {},
}));

vi.mock("@/lib/smartcomm-api", async (importOriginal) => ({
  // The real module underneath, so the keep-alive uses the real URL helper.
  ...(await importOriginal<typeof import("@/lib/smartcomm-api")>()),
  dialCall: (id: string) => ((W.hits.dialCall = (W.hits.dialCall || 0) + 1), W.api.dialCall(id)),
  acceptCall: (id: string, opts?: unknown) => ((W.hits.acceptCall = (W.hits.acceptCall || 0) + 1), (W.acceptOpts = opts), W.api.acceptCall(id)),
  declineCall: (id: string) => ((W.hits.declineCall = (W.hits.declineCall || 0) + 1), W.api.declineCall(id)),
  hangupCall: (id: string) => ((W.hits.hangupCall = (W.hits.hangupCall || 0) + 1), W.api.hangupCall(id)),
  reportCallFailure: (id: string) => ((W.hits.reportCallFailure = (W.hits.reportCallFailure || 0) + 1), W.api.reportCallFailure(id)),
  getCall: (id: string) => W.api.getCall(id),
  getRingingCalls: () => W.api.getRingingCalls(),
  getCallTurn: (id: string) => W.api.getCallTurn(id),
  completeCallRecording: async (id: string, body: unknown) => {
    W.completes.push([id, body]);
    return { call_id: id, ...(body as object), received: 0 };
  },
}));

/** The realistic fake: signalling states, negotiationneeded, rollback. */
const pcs = FakePeerConnection.instances;

function fire(event: string, payload: unknown) {
  for (const fn of W.handlers[event] || []) fn(payload);
}

function emitted(event: string): unknown[] {
  return W.calls.filter((c) => c[0] === event).map((c) => c[1]);
}

async function fresh() {
  vi.resetModules();
  return import("./call-session");
}

/** Restore the api fakes to their defaults (tests that swapped one in). */
function resetApi() {
  const { ICE } = W;
  const row = W.row;
  W.api.dialCall = async () => row({ ice: ICE });
  W.api.acceptCall = async () => row({ status: "IN_CALL", connected_at: new Date().toISOString(), ice: ICE });
  W.api.declineCall = async () => row({ status: "DECLINED", end_reason: "declined" });
  W.api.hangupCall = async () => row({ status: "ENDED", end_reason: "hangup" });
  W.api.reportCallFailure = async () => row({ status: "FAILED", end_reason: "ice_failed" });
  W.api.getCall = async () => row({ status: "NO_ANSWER", end_reason: "no_answer" });
  W.api.getRingingCalls = async () => [] as unknown as Record<string, unknown>;
  W.api.getCallTurn = async () => ICE;
  for (const k of Object.keys(W.hits)) delete W.hits[k];
}

beforeEach(() => {
  for (const k of Object.keys(W.handlers)) delete W.handlers[k];
  W.calls.length = 0;
  W.completes.length = 0;
  pcs.length = 0;
  resetApi();
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  // jsdom's <audio> has no play(); a quiet stand-in that plays.
  vi.stubGlobal("Audio", class {
    autoplay = false;
    srcObject: unknown = null;
    setAttribute() {}
    async play() {}
    pause() {}
  });
  localStorage.setItem("praxis.user", JSON.stringify({ user_id: W.ME }));
  Object.defineProperty(window.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getAudioTracks: () => [{ enabled: true, stop: vi.fn() }],
        getTracks: () => [{ enabled: true, stop: vi.fn() }],
      })),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem("praxis.user");
});

async function ringIn(name = "Aïcha") {
  act(() =>
    fire("call:ringing", {
      call_id: "c1",
      from: { user_id: W.THEM, name },
      ring_timeout_s: 60,
    }),
  );
}

describe("call session", () => {
  it("a ring puts the session in incoming, with the caller's name and the 60 s window", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    expect(result.current.phase).toBe("idle");

    await ringIn("Aïcha Diallo");
    expect(result.current.phase).toBe("incoming");
    expect(result.current.peerName).toBe("Aïcha Diallo");
    expect(result.current.ringSecondsLeft).toBe(60);
  });

  it("the offer that precedes the answer is buffered, then applied on answer", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());

    await ringIn();
    // The caller sent the offer the moment the ring went out — we have no
    // engine yet, so it waits.
    act(() => fire("call:offer", { call_id: "c1", sdp: "CALLER_OFFER" }));
    expect(pcs).toHaveLength(0);

    await act(async () => {
      await mod.answer();
    });
    expect(pcs).toHaveLength(1);
    expect(pcs[0].remoteDescription?.sdp).toBe("CALLER_OFFER");
    // The answer went out over the socket, with the engine's SDP.
    expect(emitted("call:answer")).toEqual([{ callId: "c1", sdp: pcs[0].localDescription!.sdp }]);
    // …and the callee said it is listening (E3).
    expect(emitted("call:ready")).toEqual([{ callId: "c1" }]);

    // Media connects: the tab moves to in_call.
    act(() => pcs[0].setIceState("connected"));
    expect(result.current.phase).toBe("in_call");
  });

  it("decline asks the server and lands the session in ended", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());

    await ringIn();
    await act(async () => {
      await mod.decline();
    });
    expect(result.current.phase).toBe("ended");
    expect(result.current.endedReason).toBe("declined");
  });

  it("a terminal event from ANY writer lands the session in the row's state", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());

    await ringIn();
    // The sweep ended it while the tab was looking away.
    act(() =>
      fire("call:ended", {
        call_id: "c1",
        status: "NO_ANSWER",
        reason: "no_answer",
        duration_seconds: 0,
        ended_at: new Date().toISOString(),
      }),
    );
    expect(result.current.phase).toBe("ended");
    expect(result.current.endedReason).toBe("no_answer");
  });

  it("hang-up asks the server; a 409 (already ended) loses the race without throwing", async () => {
    const mod = await fresh();
    const { ApiError } = await import("@/lib/api-client");
    W.api.hangupCall = async () => {
      throw new ApiError("CALL_MOVED_ON", "This call has already ended", 409);
    };
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());

    await ringIn();
    await act(async () => {
      await mod.hangup();
    });
    // The row closed first: the session must not claim a call that is gone.
    expect(result.current.phase).not.toBe("in_call");
  });

  it("dial mints the offer over the socket in the same breath as the ring", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());

    await act(async () => {
      await mod.dial("g1", "Aïcha");
      await settle();
    });
    expect(result.current.phase).toBe("outgoing");
    expect(result.current.peerName).toBe("Aïcha");
    expect(emitted("call:offer")).toEqual([{ callId: "c1", sdp: pcs[0].offers[0] }]);
  });

  it("a busy dial surfaces the translated error and returns to idle", async () => {
    const mod = await fresh();
    const { ApiError } = await import("@/lib/api-client");
    W.api.dialCall = async () => {
      throw new ApiError("CALLEE_BUSY", "That person is already on a call", 409);
    };
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());

    await act(async () => {
      await mod.dial("g1", "Aïcha");
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.lastError).toBe("That person is already on a call");
  });
});

/* ── PR-3: the ring channel, the push deep link, the honest path ─────────── */

describe("the ring channel and the push deep link (PR-3)", () => {
  it("a visible tab acks on the socket channel — the ack that stops the push", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    renderHook(() => mod.useCall());
    await ringIn();
    // Let the ack's microtask chain run (presentRing is async, jsdom's document
    // is visible, so it resolves to "socket" without touching notifications).
    await act(async () => {
      await Promise.resolve();
    });
    expect(emitted("call:ring_ack")).toEqual([{ callId: "c1", channel: "socket" }]);
  });

  it("an expired push link offers the redial path instead of a dead ring", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());

    // The row says the call is over: the push arrived after the 60 s window.
    W.api.getCall = async () => W.row({ status: "NO_ANSWER", end_reason: "no_answer", callee_id: W.ME });
    await act(async () => {
      mod.initCallDeepLink("?ring=8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44&act=accept");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.phase).toBe("idle");
    expect(result.current.redial).toEqual({ groupId: "g1", name: null });

    // One tap on "Call again" dials the same conversation.
    await act(async () => {
      await mod.redial();
    });
    expect(result.current.phase).toBe("outgoing");
    expect(result.current.redial).toBeNull();
  });

  it("a push that woke a cold app rebuilds the ring from the row, on the push channel", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());

    W.api.getCall = async () =>
      W.row({ status: "RINGING", caller_id: W.THEM, callee_id: W.ME, caller_name: "Aïcha" });
    await act(async () => {
      mod.initCallDeepLink("?ring=8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.phase).toBe("incoming");
    expect(result.current.redial).toBeNull();
    expect(emitted("call:ring_ack")).toEqual([
      { callId: "8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44", channel: "push" },
    ]);
  });

  it("an old summary link (?call=) never rings and never offers a redial (A6)", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    // Even a row that is still RINGING must not be turned into a ring by it.
    W.api.getCall = async () =>
      W.row({ status: "RINGING", caller_id: W.THEM, callee_id: W.ME, caller_name: "Aïcha" });
    await act(async () => {
      mod.initCallDeepLink("?call=8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44&act=accept");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.redial).toBeNull();
    expect(result.current.lastError).toBeNull();
    expect(emitted("call:ring_ack")).toEqual([]);
  });

  it("a link that is not a call id is ignored, not a ring out of nowhere", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await act(async () => {
      mod.initCallDeepLink("?ring=not-a-uuid&act=accept");
      await Promise.resolve();
    });
    expect(result.current.phase).toBe("idle");
    expect(result.current.redial).toBeNull();
  });
});

/* ── A6: the summary has its own page; the socket event only says so ─────── */

describe("call:summary_ready (A6)", () => {
  it("records a notice for the toast and opens nothing", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    act(() => fire("call:summary_ready", { call_id: "c9", status: "PENDING_REVIEW" }));
    expect(result.current.summaryNotice).toEqual({ call_id: "c9", status: "PENDING_REVIEW" });
    expect("draftCallId" in result.current).toBe(false);
    act(() => mod.clearSummaryNotice());
    expect(result.current.summaryNotice).toBeNull();
  });
});

describe("call:summary_ready refreshes the pinned draft (O3)", () => {
  it("every event bumps the tick; a redraft is not a new notice", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    act(() => fire("call:summary_ready", { call_id: "c9", status: "PENDING_REVIEW", redraft: true }));
    expect(result.current.summaryTick).toBe(1);
    expect(result.current.summaryNotice).toBeNull();
    act(() => fire("call:summary_ready", { call_id: "c9", status: "PENDING_REVIEW" }));
    expect(result.current.summaryTick).toBe(2);
    expect(result.current.summaryNotice).toEqual({ call_id: "c9", status: "PENDING_REVIEW" });
  });
});

/* ── The side declaration (audit A2) ─────────────────────────────────────── */

describe("the recorded side is declared when the call ends (A2)", () => {
  async function connectedCall(mod: Awaited<ReturnType<typeof fresh>>) {
    await ringIn();
    W.api.acceptCall = async () =>
      W.row({ status: "IN_CALL", connected_at: new Date().toISOString(), ice: W.ICE, recording_enabled: true });
    await act(async () => {
      await mod.answer();
    });
    act(() => {
      pcs[0].iceConnectionState = "connected";
      pcs[0].oniceconnectionstatechange?.({} as Event);
    });
  }

  it("a browser that cannot record still declares its side, with zero parts, so the server need not wait", async () => {
    // jsdom has no MediaRecorder: the recorder cannot start.
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    await connectedCall(mod);
    await act(async () => {
      await mod.hangup();
    });
    await act(async () => {
      await mod.callUploads().idle();
    });
    expect(W.completes).toEqual([["c1", { side: "callee", parts: 0 }]]);
  });

  it("a call that never connected declares nothing", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    await ringIn();
    await act(async () => {
      await mod.decline();
    });
    await act(async () => {
      await mod.callUploads().idle();
    });
    expect(W.completes).toEqual([]);
  });
});

/* ── Owner decision A-1: no browser speech capture during calls ──────────── */

describe("the browser live capture is gone (A-1)", () => {
  it("a recorded call that connects never starts the browser speech recogniser", async () => {
    const constructed = vi.fn();
    class FakeRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onresult: unknown = null;
      onerror: unknown = null;
      onend: unknown = null;
      constructor() {
        constructed();
      }
      start() {}
      stop() {}
      abort() {}
    }
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);

    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await ringIn();
    W.api.acceptCall = async () =>
      W.row({ status: "IN_CALL", connected_at: new Date().toISOString(), ice: W.ICE, recording_enabled: true });
    await act(async () => {
      await mod.answer();
    });
    act(() => {
      pcs[0].iceConnectionState = "connected";
      pcs[0].oniceconnectionstatechange?.({} as Event);
    });
    expect(result.current.phase).toBe("in_call");
    expect(constructed).not.toHaveBeenCalled();

    await act(async () => {
      await mod.hangup();
    });
  });
});

/* ── PR-3: the overlay's noise switch (§4.4) ─────────────────────────────── */

describe("the noise switch (PR-3)", () => {
  it("off is instant; on is the engine's answer, and is never claimed early", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());

    // Taken before any call, the switch still means something: it is the
    // preference the NEXT call resolves, so it lands on the state at once.
    await act(async () => {
      await mod.setNoise(false);
    });
    expect(result.current.noise).toEqual({ enabled: false, status: "off", reason: null });

    await act(async () => {
      await mod.dial("g1", "Aïcha");
    });
    expect(result.current.phase).toBe("outgoing");

    // Mid-call, ON: this jsdom has no WebAudio, so the engine cannot build the
    // worklet graph. The session has to report THAT — unavailable, with the
    // reason — rather than a hopeful "on" the overlay would render as a lie.
    await act(async () => {
      await mod.setNoise(true);
    });
    expect(result.current.noise).toEqual({
      enabled: true,
      status: "unavailable",
      reason: "no_audio_context",
    });
  });
});

/* ── FN-1: the page going away ends the server row at once ───────────────── */

describe("the page goes away mid-call (FN-1)", () => {
  // Every `fresh()` in this file registers its own pagehide listener on
  // window, and listeners outlive their test. A call id unique to each test
  // lets the assertion tell THIS tab's report from the leftovers' — and the
  // first test must end its call, or its listener stays armed for the whole
  // rest of the file.

  function pageHideAndCollect(callId: string) {
    const fakeFetch = vi.fn(
      async (_url: string | URL, _init?: RequestInit) => ({ status: 200 }),
    );
    const prevFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fakeFetch);
    try {
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
    } finally {
      // Restore exactly the previous state (possibly "no fetch") — unstubbing
      // all globals here would drop beforeEach's RTCPeerConnection stub.
      vi.stubGlobal("fetch", prevFetch);
    }
    return fakeFetch.mock.calls.filter(([url]) =>
      String(url).includes(`/${callId}/hangup`),
    );
  }

  it("an active call sends the keep-alive hang-up on pagehide", async () => {
    const mod = await fresh();
    const PH_ID = "c-pagehide-active";
    W.api.dialCall = async () => W.row({ call_id: PH_ID, ice: W.ICE });
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());

    await act(async () => {
      await mod.dial("g1", "Aïcha");
    });
    expect(result.current.phase).toBe("outgoing");

    const hangups = pageHideAndCollect(PH_ID);
    expect(hangups.length).toBeGreaterThanOrEqual(1);
    // A10: this was /api/tenant/comms/calls/…, a route that does not exist, so
    // every closed tab left a 30-minute phantom call.
    expect(String(hangups[0][0])).toBe(`/api/tenant/smartcomm/calls/${PH_ID}/hangup`);
    const init = hangups[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    // keepalive is the whole point: it is the only network call a dying page
    // is owed, and without it the row is left to the 30-minute cap.
    expect(init.keepalive).toBe(true);
    // B9: the server decides how a call ended; the client sends no reason.
    expect(init.body).toBe("{}");
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    // The env header rides from the token store, whatever the session set it
    // to — a keep-alive that dials the wrong schema would be a silent miss.
    expect(headers.get("X-Praxis-Env")).toMatch(/^(live|sandbox)$/);

    // Disarm this instance's listener for the rest of the file.
    await act(async () => {
      await mod.hangup();
    });
    expect(result.current.phase).toBe("ended");
  });

  it("an idle tab sends nothing when the page goes", async () => {
    await fresh();
    const hangups = pageHideAndCollect("c-pagehide-idle");
    expect(hangups).toEqual([]);
  });

  it("a tab that is only ringing sends nothing: that would decline the call on every device (A12)", async () => {
    const mod = await fresh();
    const PH_ID = "c-pagehide-ringing";
    act(() => mod.wireCallSocket());
    act(() => fire("call:ringing", { call_id: PH_ID, from: { user_id: W.THEM, name: "A" }, ring_timeout_s: 60 }));
    const hangups = pageHideAndCollect(PH_ID);
    expect(hangups).toEqual([]);
    await act(async () => {
      await mod.decline();
    });
  });
});

/* ── PR-4: failures, races and rings on every device ────────────────────── */

const CALL_ID = "8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44";

function ringingRow(over: Record<string, unknown> = {}) {
  return {
    ...W.row({ call_id: CALL_ID, caller_id: W.THEM, callee_id: W.ME, status: "RINGING" }),
    caller_name: "Aïcha",
    ring_seconds_left: 50,
    recording_enabled: false,
    noise_suppression: false,
    ...over,
  };
}

/** A service worker that pages can hear from (jsdom has none). */
function fakeServiceWorker() {
  const target = new EventTarget();
  Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: target });
  return {
    post: (data: unknown) => target.dispatchEvent(Object.assign(new Event("message"), { data })),
    remove: () => Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: undefined }),
  };
}

describe("dial and answer open the mic first, and a double tap is one call (E6, E7)", () => {
  it("a double tap dials once: the phase is `dialing` before the first await", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await act(async () => {
      // Both taps land before the first await of the first one resolves.
      await Promise.all([mod.dial("g1", "Aïcha"), mod.dial("g1", "Aïcha")]);
    });
    expect(W.hits.dialCall).toBe(1);
    expect(result.current.phase).toBe("outgoing");
  });

  it("a refused microphone rings nobody: no dial reaches the server", async () => {
    const mod = await fresh();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await act(async () => {
      await mod.dial("g1", "Aïcha");
    });
    expect(W.hits.dialCall).toBeUndefined();
    expect(result.current.phase).toBe("idle");
    expect(result.current.lastError).toMatch(/Microphone blocked/);
  });

  it("an engine that fails after the dial hangs the call up, so the callee stops ringing", async () => {
    const mod = await fresh();
    vi.stubGlobal("RTCPeerConnection", class {
      constructor() {
        throw new Error("no WebRTC here");
      }
    });
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await act(async () => {
      await mod.dial("g1", "Aïcha");
    });
    expect(W.hits.dialCall).toBe(1);
    expect(W.hits.hangupCall).toBe(1);
    expect(result.current.phase).toBe("idle");
  });

  it("hanging up while the dial is in flight cancels the call the server creates", async () => {
    const mod = await fresh();
    let release: () => void = () => {};
    W.api.dialCall = () => new Promise((r) => {
      release = () => r(W.row({ ice: W.ICE }));
    });
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    let dialing: Promise<void> = Promise.resolve();
    await act(async () => {
      dialing = mod.dial("g1", "Aïcha");
      await settle();
    });
    await act(async () => {
      await mod.hangup();
      release();
      await dialing;
    });
    expect(W.hits.hangupCall).toBe(1);
    expect(result.current.phase).toBe("idle");
    expect(pcs).toHaveLength(0);
  });

  it("a refused microphone on answer leaves the call ringing for the person's other devices", async () => {
    const mod = await fresh();
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await ringIn();
    await act(async () => {
      await mod.answer();
    });
    expect(W.hits.acceptCall).toBeUndefined();
    expect(W.hits.declineCall).toBeUndefined();
    expect(result.current.phase).toBe("idle");
    expect(result.current.lastError).toMatch(/Microphone blocked/);
  });

  it("an engine that fails after the accept reports the failure, so nobody is left IN_CALL", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await ringIn();
    vi.stubGlobal("RTCPeerConnection", class {
      constructor() {
        throw new Error("no WebRTC here");
      }
    });
    await act(async () => {
      await mod.answer();
    });
    expect(W.hits.acceptCall).toBe(1);
    expect(W.hits.reportCallFailure).toBe(1);
    expect(result.current.phase).toBe("ended");
  });
});

describe("negotiation across the socket (E1–E3)", () => {
  it("call:accepted no longer re-sends the offer; call:ready does, only while unanswered", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    await act(async () => {
      await mod.dial("g1", "Aïcha");
      await settle();
    });
    expect(emitted("call:offer")).toHaveLength(1);

    act(() => fire("call:accepted", { call_id: "c1" }));
    expect(emitted("call:offer")).toHaveLength(1);

    act(() => fire("call:ready", { call_id: "c1" }));
    expect(emitted("call:offer")).toHaveLength(2);
    expect(emitted("call:offer")[1]).toEqual(emitted("call:offer")[0]);

    // Answered: ready again changes nothing.
    await act(async () => {
      fire("call:answer", { call_id: "c1", sdp: "answer-remote-1" });
      await settle();
    });
    act(() => fire("call:ready", { call_id: "c1" }));
    expect(emitted("call:offer")).toHaveLength(2);
  });

  it("the caller's candidates that arrive while ringing are applied after the answer (E2)", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    await ringIn();
    act(() => {
      fire("call:ice", { call_id: "c1", candidate: { candidate: "early-1" } });
      fire("call:offer", { call_id: "c1", sdp: "CALLER_OFFER" });
      fire("call:ice", { call_id: "c1", candidate: { candidate: "early-2" } });
    });
    await act(async () => {
      await mod.answer();
      await settle();
    });
    expect(pcs[0].candidates).toEqual([{ candidate: "early-1" }, { candidate: "early-2" }]);
  });

  it("the other side's voice that autoplay refuses surfaces as audioBlocked (E4)", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    const refused = vi.fn(async () => {
      throw new DOMException("not allowed", "NotAllowedError");
    });
    vi.stubGlobal("Audio", class {
      autoplay = false;
      srcObject: unknown = null;
      setAttribute() {}
      play = refused;
      pause() {}
    });
    await act(async () => {
      await mod.dial("g1", "Aïcha");
      await settle();
    });
    await act(async () => {
      pcs[0].ontrack?.({ streams: [{} as MediaStream] });
      await settle();
    });
    expect(result.current.audioBlocked).toBe(true);
  });
});

describe("rings on every device, and they stop everywhere (A12, A13, E8)", () => {
  it("another device's ring ack does not silence this one (A12)", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await ringIn();
    act(() => fire("call:ring_ack", { call_id: "c1", channel: "socket" }));
    expect(result.current.phase).toBe("incoming");
  });

  it("answered on another device: this one stops ringing and says so, not 'missed' (E8)", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await ringIn();
    act(() => fire("call:accepted", { call_id: "c1", by: { user_id: W.ME } }));
    expect(result.current.phase).toBe("ended");
    expect(result.current.endedReason).toBe("answered_elsewhere");
  });

  it("the device that answered is not told it answered elsewhere", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await ringIn();
    await act(async () => {
      const answering = mod.answer();
      fire("call:accepted", { call_id: "c1", by: { user_id: W.ME } });
      await answering;
    });
    expect(result.current.phase).toBe("connecting");
  });

  it("the caller's other tabs learn a call is ringing from another device, until it ends", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    act(() => fire("call:ringing_sent", { call_id: "c9", to: { user_id: W.THEM, name: "Aïcha" } }));
    expect(result.current.elsewhere).toEqual({ callId: "c9", peerName: "Aïcha", status: "ringing" });
    act(() => fire("call:accepted", { call_id: "c9" }));
    expect(result.current.elsewhere?.status).toBe("in_call");
    act(() => fire("call:ended", { call_id: "c9", status: "ENDED", reason: "hangup" }));
    expect(result.current.elsewhere).toBeNull();
    expect(result.current.phase).toBe("idle");
  });

  it("an app opened mid-ring shows the ring the socket never delivered (A13)", async () => {
    const mod = await fresh();
    W.api.getRingingCalls = async () => [ringingRow()] as unknown as Record<string, unknown>;
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await act(async () => {
      fire("connect", undefined);
      await settle();
    });
    expect(result.current.phase).toBe("incoming");
    expect(result.current.peerName).toBe("Aïcha");
    expect(result.current.ringSecondsLeft).toBe(50);
    expect(result.current.callsAvailable).toBe(true);
    expect(emitted("call:ring_ack")).toEqual([{ callId: CALL_ID, channel: "socket" }]);
  });

  it("a ring the server no longer lists ends on the next read (A13)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const mod = await fresh();
      W.api.getRingingCalls = async () => [ringingRow()] as unknown as Record<string, unknown>;
      act(() => mod.wireCallSocket());
      const { result } = renderHook(() => mod.useCall());
      await act(async () => {
        fire("connect", undefined);
        await settle();
      });
      expect(result.current.phase).toBe("incoming");
      W.api.getRingingCalls = async () => [] as unknown as Record<string, unknown>;
      W.api.getCall = async () => W.row({ call_id: CALL_ID, status: "CANCELLED", end_reason: "cancelled" });
      vi.advanceTimersByTime(5_000);
      await act(async () => {
        await mod.reconcileRinging(true);
        await settle();
      });
      expect(result.current.phase).toBe("ended");
      expect(result.current.endedReason).toBe("cancelled");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a ring whose row still says RINGING after its window ends here anyway (A13: never sticks)", async () => {
    vi.useFakeTimers();
    try {
      const mod = await fresh();
      W.api.getCall = async () => W.row({ status: "RINGING" });
      act(() => mod.wireCallSocket());
      const { result } = renderHook(() => mod.useCall());
      act(() => fire("call:ringing", { call_id: "c1", from: { user_id: W.THEM, name: "A" }, ring_timeout_s: 2 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(result.current.phase).toBe("incoming");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(mod.RING_EXPIRY_GRACE_MS);
      });
      expect(result.current.phase).toBe("ended");
      expect(result.current.endedReason).toBe("no_answer");
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls that are off for this person are known, so nothing offers to ring", async () => {
    const mod = await fresh();
    const { ApiError } = await import("@/lib/api-client");
    W.api.getRingingCalls = async () => {
      throw new ApiError("FEATURE_DISABLED", "Calls are off", 403);
    };
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await act(async () => {
      fire("connect", undefined);
      await settle();
    });
    expect(result.current.callsAvailable).toBe(false);
  });
});

describe("the service worker's hand-offs (A8, A14, step 6–7)", () => {
  it("Answer on the notification, with this window open, answers without a reload", async () => {
    const sw = fakeServiceWorker();
    try {
      const mod = await fresh();
      act(() => mod.wireCallSocket());
      const { result } = renderHook(() => mod.useCall());
      W.api.getCall = async () => ringingRow();
      act(() => fire("call:ringing", { call_id: CALL_ID, from: { user_id: W.THEM, name: "Aïcha" }, ring_timeout_s: 60 }));
      await act(async () => {
        sw.post({ type: "praxis:call-action", call_id: CALL_ID, act: "accept" });
        await settle();
      });
      expect(W.hits.acceptCall).toBe(1);
      expect(result.current.phase).toBe("connecting");
    } finally {
      sw.remove();
    }
  });

  it("a cancel push ends the ring in this window with the outcome it names", async () => {
    const sw = fakeServiceWorker();
    try {
      const mod = await fresh();
      act(() => mod.wireCallSocket());
      const { result } = renderHook(() => mod.useCall());
      act(() => fire("call:ringing", { call_id: CALL_ID, from: { user_id: W.THEM, name: "Aïcha" }, ring_timeout_s: 60 }));
      act(() => sw.post({ type: "praxis:call-cancel", data: { call_id: CALL_ID, outcome: "answered" } }));
      expect(result.current.phase).toBe("ended");
      expect(result.current.endedReason).toBe("answered_elsewhere");
    } finally {
      sw.remove();
    }
  });

  it("a ring push handed to a visible page rings in-app from the server's list", async () => {
    const sw = fakeServiceWorker();
    try {
      const mod = await fresh();
      W.api.getRingingCalls = async () => [ringingRow()] as unknown as Record<string, unknown>;
      act(() => mod.wireCallSocket());
      const { result } = renderHook(() => mod.useCall());
      await act(async () => {
        sw.post({ type: "praxis:call-ring", data: { call_id: CALL_ID } });
        await settle();
      });
      expect(result.current.phase).toBe("incoming");
    } finally {
      sw.remove();
    }
  });

  it("Decline from a cold app declines without showing a ring screen", async () => {
    const mod = await fresh();
    W.api.getCall = async () => ringingRow();
    W.api.declineCall = async () => W.row({ call_id: CALL_ID, status: "DECLINED", end_reason: "declined" });
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await act(async () => {
      mod.initCallDeepLink(`?ring=${CALL_ID}&act=decline`);
      await settle();
    });
    expect(W.hits.declineCall).toBe(1);
    // No ring was presented on the way: a presented ring acks its channel.
    expect(emitted("call:ring_ack")).toEqual([]);
    expect(result.current.phase).toBe("ended");
    expect(result.current.endedReason).toBe("declined");
  });

  it("the intent survives a login redirect: kept at boot, acted on after sign-in", async () => {
    const { captureCallIntent } = await import("./call-intent");
    captureCallIntent(`?ring=${CALL_ID}&act=accept`);
    const mod = await fresh();
    W.api.getCall = async () => ringingRow();
    act(() => mod.wireCallSocket());
    const { result } = renderHook(() => mod.useCall());
    await act(async () => {
      // After login the URL is plain /comms: the kept intent is what remains.
      mod.initCallDeepLink("");
      await settle();
    });
    expect(W.hits.acceptCall).toBe(1);
    expect(result.current.phase).toBe("connecting");
  });
});

describe("the ringing read on a fresh load (A13)", () => {
  it("runs when the session is wired, even if the socket connected first", async () => {
    const mod = await fresh();
    W.api.getRingingCalls = async () => [ringingRow()] as unknown as Record<string, unknown>;
    const { result } = renderHook(() => mod.useCall());
    await act(async () => {
      mod.wireCallSocket(); // no `connect` event: it already happened
      await settle();
    });
    expect(result.current.phase).toBe("incoming");
  });
});

describe("answer without recording (PR-6, audit G5)", () => {
  it("the callee's choice reaches the server, and this side neither records nor shows the banner", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    await ringIn();
    W.api.acceptCall = async () =>
      W.row({ status: "IN_CALL", connected_at: new Date().toISOString(), ice: W.ICE, recording_enabled: false });
    await act(async () => {
      await mod.answer({ record: false });
    });
    expect(W.acceptOpts).toEqual({ record: false });
    const { result } = renderHook(() => mod.useCall());
    expect(result.current.recordingEnabled).toBe(false);
  });

  it("a plain answer asks for nothing special", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    await ringIn();
    await act(async () => {
      await mod.answer();
    });
    expect(W.acceptOpts).toEqual({ record: undefined });
  });

  it("the caller learns from call:accepted that the callee declined the recording", async () => {
    const mod = await fresh();
    act(() => mod.wireCallSocket());
    W.api.dialCall = async () => W.row({ ice: W.ICE, recording_enabled: true, caller_id: W.ME, callee_id: W.THEM });
    await act(async () => {
      await mod.dial("g1", "Bruno");
    });
    const { result } = renderHook(() => mod.useCall());
    expect(result.current.recordingEnabled).toBe(true);
    act(() => fire("call:accepted", { call_id: "c1", recording_enabled: false }));
    expect(result.current.recordingEnabled).toBe(false);
    expect(result.current.call?.recording_enabled).toBe(false);
  });
});
