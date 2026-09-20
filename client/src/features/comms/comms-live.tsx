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
 *   - it owns the wake keep-alive for the duration of a live call,
 *   - it turns terminal call events into toasts (the honest end-of-call line,
 *     including "missed" and "no answer" — a call that ended is said to have
 *     ended, in the language the user reads in).
 *
 * The socket itself is the shared singleton (lib/comms-socket): this component
 * only connects, subscribes, and unmounts cleanly on logout.
 */
import * as React from "react";
import { useLocation } from "react-router-dom";
import { tr, tv } from "@/lib/i18n";
import { useAuth } from "@/app/auth/auth-context";
import { useToast } from "@/components/ui/toast";
import { getCommsSocket, disconnectCommsSocket } from "@/lib/comms-socket";
import { unlockAudio, playNotifSound } from "@/lib/notif-sound";
import {
  useCall, answer, decline, hangup, setMuted, setNoise, wireCallSocket, myUserId,
  closeSummaryDraft, initCallDeepLink, redial, dismissRedial,
} from "./call/call-session";
import { CallOverlay } from "./call/call-overlay";
import { IncomingRing } from "./call/incoming-ring";
import { CallSummaryPanel } from "./call/summary-draft";
import { acquireWakeLock, releaseWakeLock } from "./call/wake-keepalive";
import { setOnline, useOnline } from "./presence";

/** 60 s client-side throttle for the seen beat — the server upserts either
 *  way, so the throttle is about honesty (and load), not correctness. */
const SEEN_BEAT_MS = 60_000;

export function CommsLive() {
  const { status, user } = useAuth();
  const location = useLocation();
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
    // §4.6: a push tap lands here — `/comms?call=<id>&act=accept|decline`. The
    // session decides whether that call is still answerable or has expired
    // (the redial path); this only hands it the link.
    initCallDeepLink(window.location.search);

    const onPresence = (p: { user_id: string; online: boolean }) => {
      setOnline(p.user_id, p.online);
    };
    s.on("comms:presence", onPresence);

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

    return () => {
      s.off("comms:presence", onPresence);
      s.off("connect", onConnect);
      document.removeEventListener("visibilitychange", onVis);
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
  React.useEffect(() => {
    if (call.phase !== "incoming") return;
    unlockAudio();
    playNotifSound("urgent");
    const t = setInterval(() => playNotifSound("urgent"), 2500);
    return () => clearInterval(t);
  }, [call.phase, call.peerName]);

  /* ── Wake keep-alive for the duration of live media ──────────────────── */
  React.useEffect(() => {
    if (call.phase === "in_call") void acquireWakeLock();
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
    if (r === "no_answer") {
      if (iWasCaller) toast.info(tv("No answer", {}));
      else toast.info(tv("Missed call — {{name}}", { name }));
    } else if (r === "cancelled") {
      toast.info(tr("Call cancelled"));
    } else if (r === "declined") {
      toast.info(tr("Call declined"));
    } else if (r === "ice_failed" || r === "busy") {
      toast.error(tr("Could not connect the call"));
    } else {
      toast.info(tr("Call ended"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.phase, call.call?.call_id]);

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
        />
      )}
      {(call.phase === "outgoing" || call.phase === "connecting" || call.phase === "in_call") && (
        <CallOverlay
          name={call.peerName}
          phase={call.phase}
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
      {/* The caller's draft, opened by the socket event that says it is ready.
          It is a panel rather than a screen because the caller may be anywhere
          when the summary lands — exactly like the call itself. */}
      {call.draftCallId && (
        <CallSummaryPanel
          callId={call.draftCallId}
          onClose={closeSummaryDraft}
        />
      )}
    </>
  );
}
