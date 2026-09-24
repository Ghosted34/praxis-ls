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
  };
  const completes: Array<[string, unknown]> = [];
  return { ME, THEM, ICE, handlers, calls, socket, row, api, completes };
});

vi.mock("@/lib/comms-socket", () => ({
  getCommsSocket: () => W.socket,
  disconnectCommsSocket: () => {},
}));

vi.mock("@/lib/smartcomm-api", async (importOriginal) => ({
  // The real module underneath, so the keep-alive uses the real URL helper.
  ...(await importOriginal<typeof import("@/lib/smartcomm-api")>()),
  dialCall: (id: string) => W.api.dialCall(id),
  acceptCall: (id: string) => W.api.acceptCall(id),
  declineCall: (id: string) => W.api.declineCall(id),
  hangupCall: (id: string) => W.api.hangupCall(id),
  reportCallFailure: (id: string) => W.api.reportCallFailure(id),
  getCall: (id: string) => W.api.getCall(id),
  completeCallRecording: async (id: string, body: unknown) => {
    W.completes.push([id, body]);
    return { call_id: id, ...(body as object), received: 0 };
  },
}));

/** Minimal RTCPeerConnection for jsdom: SDP in/out and the one state
 *  transition the session can observe. */
type FakePc = {
  iceConnectionState: string;
  onicecandidate: ((e: { candidate: unknown | null }) => void) | null;
  ontrack: ((e: { streams: MediaStream[] }) => void) | null;
  oniceconnectionstatechange: ((e: Event) => void) | null;
  localSdp: string | null;
  remoteSdp: string | null;
  closed: boolean;
};
const pcs: FakePc[] = [];
class FakePCT {
  iceConnectionState = "new";
  onicecandidate: FakePc["onicecandidate"] = null;
  ontrack: FakePc["ontrack"] = null;
  oniceconnectionstatechange: FakePc["oniceconnectionstatechange"] = null;
  localSdp: string | null = null;
  remoteSdp: string | null = null;
  closed = false;
  constructor() {
    pcs.push(this as unknown as FakePc);
  }
  async setRemoteDescription(d: { type: string; sdp: string }) {
    this.remoteSdp = d.sdp;
  }
  async createOffer() {
    return { sdp: "OFFER" };
  }
  async createAnswer() {
    return { sdp: "ANSWER" };
  }
  async setLocalDescription(d: { type: string; sdp: string }) {
    this.localSdp = d.sdp;
  }
  addTrack() {
    return {};
  }
  async addIceCandidate() {}
  close() {
    this.closed = true;
  }
}

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
}

beforeEach(() => {
  for (const k of Object.keys(W.handlers)) delete W.handlers[k];
  W.calls.length = 0;
  W.completes.length = 0;
  pcs.length = 0;
  resetApi();
  vi.stubGlobal("RTCPeerConnection", FakePCT);
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
    expect(pcs[0].remoteSdp).toBe("CALLER_OFFER");
    // The answer went out over the socket, with the engine's SDP.
    expect(emitted("call:answer")).toEqual([{ callId: "c1", sdp: "ANSWER" }]);

    // Media connects: the tab moves to in_call.
    act(() => {
      pcs[0].iceConnectionState = "connected";
      pcs[0].oniceconnectionstatechange?.({} as Event);
    });
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
    });
    expect(result.current.phase).toBe("outgoing");
    expect(result.current.peerName).toBe("Aïcha");
    expect(emitted("call:offer")).toEqual([{ callId: "c1", sdp: "OFFER" }]);
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
    expect(init.body).toBe(JSON.stringify({ reason: "hangup" }));
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
});
