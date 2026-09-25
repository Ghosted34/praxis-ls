/**
 * Comms live bootstrap (Smart Comms PR-1, guide §4.11).
 *
 * Mounted once inside the authenticated shell, this is the app's HALF of the
 * comms socket's contract:
 *
 *   - the socket connects at APP BOOT, not when chat is opened — presence and
 *     ringing have to work from any screen (and the "online" dot has to be
 *     true from the moment the app opens, which is what the beat says),
 *   - it emits the `comms:seen` beat on first connect, return-from-background
 *     and navigation — throttled to one per 60 s, per the locked decision:
 *     open + return + navigate, and never more,
 *   - it renders the call surfaces (ring, overlay) which live HERE, outside
 *     any feature screen, because a call can be ringing while the user is in
 *     /finance or /wms,
 *   - it owns the audio keep-alive for the duration of a live call (never a
 *     screen wake lock: audit E13),
 *   - it turns terminal call events into toasts (the honest end-of-call line,
 *     including "missed" and "no answer" — a call that ended is said to have
 *     ended, in the language the user reads in).
 *
 * The socket itself is the shared singleton (lib/comms-socket): this component
 * only connects, subscribes, and unmounts cleanly on logout.
 */
import * as React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { tr, tv } from "@/lib/i18n";
import { useAuth } from "@/app/auth/auth-context";
import { useToast } from "@/components/ui/toast";
import { getCommsSocket, disconnectCommsSocket } from "@/lib/comms-socket";
import { unlockAudio, playNotifSound, isAudioBlocked } from "@/lib/notif-sound";
import {
  useCall, answer, decline, hangup, setMuted, setNoise, wireCallSocket, myUserId,
  clearSummaryNotice, initCallDeepLink, redial, dismissRedial, resumeAudio, clearElsewhere,
} from "./call/call-session";
import { parseSummaryLink } from "./call/ring-surface";
import { CallOverlay } from "./call/call-overlay";
import { IncomingRing } from "./call/incoming-ring";
import { CallRingPrompt } from "./call/call-ring-prompt";
import { startRingingTitle, stopRingingTitle } from "./call/ring-title";
import { acquireCallKeepAlive, releaseWakeLock } from "./call/wake-keepalive";
import { setOnline, useOnline, replaceOnline } from "./presence";

/** 60 s client-side throttle for the seen beat — the server upserts either
 *  way, so the throttle is about honesty (and load), not correctness. */
const SEEN_BEAT_MS = 60_000;

export function CommsLive() {
  const { status, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  // Read through a ref: the socket effect below must not re-run (and reconnect)
  // every time navigation hands out a new `navigate`.
  const navigateRef = React.useRef(navigate);
  navigateRef.current = navigate;
  const toast = useToast();
  const call = useCall();
  const lastBeat = React.useRef(0);
  const beatRef = React.useRef<() => void>(() => {});
  const toastedCall = React.useRef<string | null>(null);
  const toastedError = React.useRef<string | null>(null);
  const authed = status === "authed" && !!user;
  // The peer's device: for the honest-offline sentence on the outgoing overlay
  // (§4.8's iOS closed-app case). `myUserId()` tells us which side we are.
  const peerId = call.call
    ? myUserId() === call.call.caller_id
      ? call.call.callee_id
      : call.call.caller_id
    : null;
  const peerOnline = useOnline(peerId);

  /* ── Socket boot: connect, wire presence + calls, start the beat ─────── */
  React.useEffect(() => {
    if (!authed) return;
    const s = getCommsSocket();
    wireCallSocket();
    // A ring push lands as `/comms?ring=<id>&act=…`; the session decides
    // whether it can still be answered. `/comms?call=<id>` is the OLD summary
    // notification link, still in people's shades: it opens the call's page
    // and is never treated as a ring (audit A6).
    const legacySummary = parseSummaryLink(window.location.search);
    if (legacySummary) navigateRef.current(`/comms/calls/${legacySummary}`, { replace: true });
    else initCallDeepLink(window.location.search);

    const onPresence = (p: { user_id: string; online: boolean }) => {
      setOnline(p.user_id, p.online);
    };
    s.on("comms:presence", onPresence);
    // The server's snapshot on every (re)connect seeds the dots (audit E12);
    // a disconnect clears them, since nothing keeps them true meanwhile.
    const onSnapshot = (p: { users?: Record<string, boolean> }) => replaceOnline(p?.users ?? {});
    const onDrop = () => replaceOnline({});
    s.on("comms:presence_snapshot", onSnapshot);
    s.on("disconnect", onDrop);

    const beat = () => {
      const now = Date.now();
      if (now - lastBeat.current < SEEN_BEAT_MS) return;
      lastBeat.current = now;
      s.emit("comms:seen", {});
    };
    beatRef.current = beat;

    const onConnect = () => beat();
    s.on("connect", onConnect);
    if (s.connected) beat();

    const onVis = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVis);

    // The service worker opens a place in THIS window (an expired ring's
    // conversation) through the router, not a reload that would drop a call.
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    const onWorker = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; url?: string } | null;
      if (msg?.type === "praxis:navigate" && typeof msg.url === "string"
          && msg.url.startsWith("/") && !msg.url.startsWith("//")) {
        navigateRef.current(msg.url);
      }
    };
    sw?.addEventListener?.("message", onWorker);

    return () => {
      s.off("comms:presence", onPresence);
      s.off("comms:presence_snapshot", onSnapshot);
      s.off("disconnect", onDrop);
      s.off("connect", onConnect);
      document.removeEventListener("visibilitychange", onVis);
      sw?.removeEventListener?.("message", onWorker);
      beatRef.current = () => {};
      // Logout: the socket is authenticated as THIS user, and the next user
      // on this browser (shift change) must not inherit the old user's ring.
      disconnectCommsSocket();
    };
  }, [authed]);

  /* ── Navigation beat (the third of the three: open, return, navigate) ─── */
  React.useEffect(() => {
    if (authed) beatRef.current();
  }, [location.pathname, authed]);

  /* ── Ringtone while an incoming call rings ────────────────────────────
         The NOTIFICATION tier moved into the session's ring handler (PR-3,
         §4.6) because it has to be announced to the server: the ack carries
         which channel actually landed, and a notification raised here — after
         the ack was already sent — would make the log claim `socket` for a
         ring the person only ever saw in the shade. The tone stays, because it
         is local to this tab and needs no server round trip. */
  const [ringSoundBlocked, setRingSoundBlocked] = React.useState(false);
  React.useEffect(() => {
    if (call.phase !== "incoming") return;
    unlockAudio();
    // The telephone ring, not the notification blip (FN-2): this tab is alive
    // even when hidden, and an alive tab may play audio — that is what makes a
    // backgrounded app ring like a phone. A CLOSED page cannot play anything;
    // that is the platform's ceiling and the notification tier's job.
    playNotifSound("ring");
    setRingSoundBlocked(isAudioBlocked());
    const t = setInterval(() => {
      playNotifSound("ring");
      setRingSoundBlocked(isAudioBlocked());
    }, 2500);
    // The tab title says who is calling, for a ringing tab among many.
    startRingingTitle(call.peerName ? tv("📞 {{name}} is calling", { name: call.peerName }) : tr("📞 Incoming call"));
    return () => {
      clearInterval(t);
      stopRingingTitle();
    };
  }, [call.phase, call.peerName]);

  /* ── Audio keep-alive for the duration of live media (no screen lock) ── */
  React.useEffect(() => {
    if (call.phase === "in_call") acquireCallKeepAlive();
    else releaseWakeLock();
  }, [call.phase]);

  /* ── Terminal toasts: the honest end-of-call line ────────────────────── */
  React.useEffect(() => {
    if (call.phase !== "ended" || !call.call) return;
    if (toastedCall.current === call.call.call_id) return;
    toastedCall.current = call.call.call_id;
    const name = call.peerName || "";
    const r = call.endedReason;
    const iWasCaller = myUserId() === call.call.caller_id;
    if (r === "answered_elsewhere") {
      toast.info(tr("Answered on another device"));
    } else if (r === "no_answer") {
      if (iWasCaller) toast.info(tv("No answer", {}));
      else toast.info(tv("Missed call — {{name}}", { name }));
    } else if (r === "cancelled") {
      toast.info(tr("Call cancelled"));
    } else if (r === "declined") {
      toast.info(tr("Call declined"));
    } else if (r === "ice_failed" || r === "busy") {
      toast.error(tr("Could not connect the call"));
    } else if (r === "disconnected") {
      toast.info(tr("The call was lost — the connection ended"));
    } else {
      toast.info(tr("Call ended"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.phase, call.call?.call_id]);

  /* ── A summary gained an update: say where it is ──────────────────────
         Only the update: a first draft also arrives as a notification, whose
         toast already honours the user's interrupt preference, and a second
         toast here would ignore it. An update has no notification of its own. */
  React.useEffect(() => {
    const n = call.summaryNotice;
    if (!n) return;
    if (n.status === "UPDATE_AVAILABLE") {
      toast.info(tr("An updated call summary is available. Open Comms › Calls to post it."));
    }
    clearSummaryNotice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.summaryNotice]);

  /* ── Dial failures the user should hear (busy, no mic, …) ────────────── */
  React.useEffect(() => {
    if (call.phase !== "idle" || !call.lastError) return;
    if (toastedError.current === call.lastError) return;
    toastedError.current = call.lastError;
    toast.error(call.lastError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.phase, call.lastError]);

  if (!authed) return null;

  return (
    <>
      {call.phase === "incoming" && (
        <IncomingRing
          name={call.peerName}
          secondsLeft={call.ringSecondsLeft}
          onAccept={() => void answer()}
          onDecline={() => void decline()}
          soundBlocked={ringSoundBlocked}
          onEnableSound={() => {
            unlockAudio();
            setRingSoundBlocked(false);
          }}
        />
      )}
      {(call.phase === "dialing" || call.phase === "outgoing" || call.phase === "connecting" || call.phase === "in_call") && (
        <CallOverlay
          name={call.peerName}
          phase={call.phase}
          audioBlocked={call.audioBlocked}
          onTapToHear={() => void resumeAudio()}
          elapsedS={call.elapsedS}
          warning={call.warning}
          muted={call.muted}
          recordingEnabled={call.recordingEnabled}
          recordingLost={call.recordingLost}
          quality={call.quality}
          recovering={call.recovering}
          noise={call.noise}
          peerOffline={!peerOnline}
          onHangup={() => void hangup()}
          onMute={() => setMuted(!call.muted)}
          onToggleNoise={(on) => void setNoise(on)}
        />
      )}
      {/* §4.6's expired-push path: the call is over, so there is no ring to
          show — but there IS a person who just tapped "Answer", and a one-tap
          way to call back is the honest ending. It sits above the toasts and
          below the call surfaces, and it says the call ended rather than
          showing a screen for a call that cannot happen. */}
      {/* The same person is on a call on another of their devices. A line,
          not a call screen: this tab is not in that call. */}
      {call.elsewhere && call.phase === "idle" && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[64] flex w-[92vw] max-w-md -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-l)] animate-fade-in"
        >
          <p className="min-w-0 flex-1 text-sm text-foreground">
            {call.elsewhere.peerName
              ? tv("On a call with {{name}} on another device", { name: call.elsewhere.peerName })
              : tr("On a call on another device")}
          </p>
          <button
            type="button"
            onClick={clearElsewhere}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={tr("Dismiss")}
          >
            ×
          </button>
        </div>
      )}
      <CallRingPrompt callsAvailable={call.callsAvailable} />
      {call.redial && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[65] flex w-[92vw] max-w-md -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-[var(--shadow-l)] animate-fade-in"
        >
          <p className="min-w-0 flex-1 text-sm text-foreground">
            {tr("That call has already ended")}
          </p>
          <button
            type="button"
            onClick={() => void redial()}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
          >
            {tr("Call again")}
          </button>
          <button
            type="button"
            onClick={dismissRedial}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            aria-label={tr("Dismiss")}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
