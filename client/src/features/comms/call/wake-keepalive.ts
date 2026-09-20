/**
 * Wake keep-alive for a live call (Smart Comms PR-1, guide §4.4).
 *
 * A call that the screen-saver kills is a call that ends mid-sentence, and on
 * the yard phone (screen left on at the dock) that is the norm, not the
 * corner case. The Web Wake Lock API is the honest tool when the browser has
 * it (Chrome/Edge/Safari 16.4+); on iOS the PWA wake lock landed in 18.4 and
 * REGRESSED in 26.1, so this is feature-detected, not assumed — when the lock
 * is unavailable the fallback is the classic trick: play an inaudible loop
 * through a WebAudio node, which keeps the audio session alive on iOS and is
 * silent to the caller's own ear (0 gain).
 *
 * Neither mechanism is a PROMISE that the screen stays on — the battery
 * settings and the user can override both. That is why the guide pairs this
 * with the truth-telling presence model: a dropped call shows as what it was,
 * never as a fake "still connected" dot.
 */

type WakeLockSentinel = { release?: () => Promise<void> } | null;

let sentinel: WakeLockSentinel = null;
let visibilityHandler: (() => void) | null = null;
let audioCtx: AudioContext | null = null;
let gainNode: GainNode | null = null;

/** Request a wake lock for the duration of a call. Safe to call when the
 *  platform has no wake lock (falls back to the audio keep-alive). */
export async function acquireWakeLock(): Promise<void> {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
  };
  try {
    if (nav.wakeLock) {
      sentinel = await nav.wakeLock.request("screen");
      // The lock drops silently on tab hide; re-request on visible.
      visibilityHandler = () => {
        if (document.visibilityState === "visible" && sentinel === null) {
          nav.wakeLock
            ?.request("screen")
            .then((s) => {
              sentinel = s;
            })
            .catch(() => {
              /* @silent:teardown — re-acquiring a dropped lock can race the
                 call ending; if it loses, the call is over anyway. */
            });
        }
      };
      document.addEventListener("visibilitychange", visibilityHandler);
      return;
    }
  } catch {
    /* @silent:teardown — a denied or half-implemented wake lock falls
       through to the audio keep-alive, which is the fallback this
       function exists to pick. */
  }
  startAudioKeepAlive();
}

/** Release everything. Idempotent. */
export function releaseWakeLock(): void {
  if (sentinel) {
    sentinel
      ?.release?.()
      .catch(() => {
        /* @silent:teardown — releasing an already-released lock is a no-op. */
      })
      .finally(() => {
        sentinel = null;
      });
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  stopAudioKeepAlive();
}

/** The iOS path: an inaudible (zero-gain) looping tone. Some browsers pause
 *  background audio entirely — nothing we can do about that class, and the
 *  server sweep ends the call server-side regardless. */
function startAudioKeepAlive(): void {
  if (audioCtx || typeof window === "undefined" || !window.AudioContext) return;
  try {
    audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 0; // inaudible; the point is the session, not sound
    osc.frequency.value = 20; // below most phone speakers' response
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
  } catch {
    audioCtx = null;
    gainNode = null;
  }
}

function stopAudioKeepAlive(): void {
  if (audioCtx) {
    void audioCtx.close().catch(() => {
      /* @silent:teardown — closing a closed context is a no-op. */
    });
  }
  audioCtx = null;
  gainNode = null;
}
