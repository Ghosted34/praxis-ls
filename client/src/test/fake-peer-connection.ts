/**
 * A fake RTCPeerConnection with the parts of the spec perfect negotiation
 * depends on (calls audit E1–E3): the signalling state machine, rollback,
 * `negotiationneeded` after addTrack and restartIce, implicit
 * setLocalDescription(), and addIceCandidate refusing a candidate before
 * there is a remote description. Its refusals are the real ones
 * (InvalidStateError), so code that only works when the browser forgives it
 * fails here too.
 *
 * `linkPeers(a, b)` is the network: what one side signals, the other
 * receives, one macrotask later.
 */
type Desc = { type: "offer" | "answer" | "rollback"; sdp?: string };

let seq = 0;

function invalidState(message: string): Error {
  const err = new Error(message);
  err.name = "InvalidStateError";
  return err;
}

export class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  /** Set to false to model a browser without implicit setLocalDescription(). */
  static implicitSld = true;

  readonly id = ++seq;
  config: RTCConfiguration;
  configHistory: RTCConfiguration[] = [];
  signalingState: RTCSignalingState = "stable";
  iceConnectionState: RTCIceConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  candidates: unknown[] = [];
  senders: Array<{ track: unknown; replaceTrack: (t: unknown) => Promise<void> }> = [];
  closed = false;
  /** Every offer this side put on the wire, in order. */
  offers: string[] = [];
  onicecandidate: ((e: { candidate: unknown | null }) => void) | null = null;
  ontrack: ((e: { streams: MediaStream[] }) => void) | null = null;
  oniceconnectionstatechange: ((e: Event) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  private needsNegotiation = false;
  private restartPending = false;
  private negotiationQueued = false;
  private counter = 0;

  constructor(config: RTCConfiguration = {}) {
    this.config = config;
    FakePeerConnection.instances.push(this);
  }

  getConfiguration() {
    return this.config;
  }
  setConfiguration(config: RTCConfiguration) {
    this.configHistory.push(config);
    this.config = config;
  }

  addTrack(track: unknown) {
    const sender = {
      track,
      replaceTrack: async (t: unknown) => {
        sender.track = t;
      },
    };
    this.senders.push(sender);
    // A track added before the remote offer is matched to the offer's m-line
    // when it arrives (JSEP 5.10), so only an unanswered side needs to offer.
    if (!this.remoteDescription) this.markNegotiationNeeded();
    return sender;
  }
  getSenders() {
    return this.senders;
  }
  getReceivers() {
    return [];
  }

  restartIce() {
    this.restartPending = true;
    this.markNegotiationNeeded();
  }

  async createOffer(options: { iceRestart?: boolean } = {}) {
    const restart = options.iceRestart || this.restartPending;
    return { type: "offer" as const, sdp: `offer-${this.id}-${++this.counter}${restart ? "-ice-restart" : ""}` };
  }
  async createAnswer() {
    if (this.signalingState !== "have-remote-offer") throw invalidState("createAnswer outside have-remote-offer");
    return { type: "answer" as const, sdp: `answer-${this.id}-${++this.counter}` };
  }

  async setLocalDescription(desc?: Desc) {
    await Promise.resolve();
    if (this.closed) throw invalidState("closed");
    if (!desc) {
      if (!FakePeerConnection.implicitSld) throw new TypeError("setLocalDescription needs a description");
      desc = this.signalingState === "have-remote-offer" ? await this.createAnswer() : await this.createOffer();
    }
    if (desc.type === "rollback") {
      if (this.signalingState !== "have-local-offer") throw invalidState("nothing to roll back");
      this.signalingState = "stable";
      this.localDescription = null;
      return;
    }
    if (desc.type === "offer") {
      if (this.signalingState !== "stable" && this.signalingState !== "have-local-offer") {
        throw invalidState(`offer in ${this.signalingState}`);
      }
      this.signalingState = "have-local-offer";
      this.localDescription = { type: "offer", sdp: desc.sdp! };
      this.offers.push(desc.sdp!);
      this.needsNegotiation = false;
      this.restartPending = false;
    } else {
      if (this.signalingState !== "have-remote-offer") throw invalidState(`answer in ${this.signalingState}`);
      this.signalingState = "stable";
      this.localDescription = { type: "answer", sdp: desc.sdp! };
      this.afterStable();
    }
    queueMicrotask(() => this.onicecandidate?.({ candidate: { candidate: `host-${this.id}` } }));
  }

  async setRemoteDescription(desc: { type: "offer" | "answer"; sdp: string }) {
    await Promise.resolve();
    if (this.closed) throw invalidState("closed");
    if (desc.type === "offer") {
      if (this.signalingState !== "stable") throw invalidState(`remote offer in ${this.signalingState}`);
      this.signalingState = "have-remote-offer";
      this.remoteDescription = { ...desc };
      this.needsNegotiation = false;
    } else {
      if (this.signalingState !== "have-local-offer") throw invalidState(`remote answer in ${this.signalingState}`);
      this.signalingState = "stable";
      this.remoteDescription = { ...desc };
      this.afterStable();
    }
  }

  async addIceCandidate(candidate?: unknown) {
    await Promise.resolve();
    if (!this.remoteDescription) throw invalidState("no remote description");
    this.candidates.push(candidate === undefined ? null : candidate);
  }

  getStats = undefined;

  close() {
    this.closed = true;
    this.signalingState = "closed";
  }

  /** Drive ICE from a test. */
  setIceState(state: RTCIceConnectionState) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.({} as Event);
  }

  private markNegotiationNeeded() {
    this.needsNegotiation = true;
    this.queueNegotiation();
  }
  private afterStable() {
    if (this.needsNegotiation || this.restartPending) this.queueNegotiation();
  }
  private queueNegotiation() {
    if (this.negotiationQueued) return;
    this.negotiationQueued = true;
    setTimeout(() => {
      this.negotiationQueued = false;
      if (this.closed || this.signalingState !== "stable") return;
      if (this.needsNegotiation || this.restartPending) this.onnegotiationneeded?.();
    }, 0);
  }
}

/** Let every queued macrotask and microtask run (the fake's "network"). */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((r) => setTimeout(r, 0));
}
