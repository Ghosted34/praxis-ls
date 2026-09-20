/**
 * The sound a notification makes.
 *
 * ── WHY SYNTHESISED AND NOT AN AUDIO FILE ──────────────────────────────────
 *
 * An .mp3 is a network request that can 404, a cache entry that can go stale,
 * and — the reason that actually decides it here — an asset a white-label
 * tenant would reasonably expect to be able to replace, which is a whole
 * feature nobody asked for. Two oscillators and a gain envelope are ~40 lines,
 * ship in the bundle, and sound identical on every device.
 *
 * ── THE AUTOPLAY PROBLEM, WHICH IS THE WHOLE DIFFICULTY ────────────────────
 *
 * Browsers create an AudioContext `suspended` and will not resume it outside a
 * user gesture. A naive implementation therefore works perfectly in every
 * manual test — you clicked something to get there — and is silent for the one
 * case that matters: a dispatcher who loaded the board at 07:00, touched
 * nothing, and needed to hear the 09:40 approval.
 *
 * So we latch onto the FIRST gesture of the session, whatever it is, and resume
 * then — long before anything arrives. The listeners are passive, capturing and
 * self-removing. `isAudioBlocked()` reports the truth so the UI can offer a
 * one-tap unlock rather than pretending the sound played.
 *
 * Adapted from the approach in the Pixie Girl Hub codebase, which solved the
 * same problem for call ringing.
 */

type Tier = "urgent" | "alert" | "silent" | "ring";

const SOUND_KEY = "praxis.notif.sound";

let audioCtx: AudioContext | null = null;
let unlockBound = false;

/** Per-viewer convenience, so it belongs in localStorage rather than on the
 *  server: it is about this device's speakers, not about the person. The
 *  per-category INTERRUPT preference — which IS about the person — is stored
 *  server-side and reaches us on the notification itself. */
export function isNotifSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    /* @silent:storage — a private window, blocked site data, or a thumbnail
       capture. Defaulting to ON is right: a missed approval costs more than an
       unexpected blip. */
    return true;
  }
}

export function setNotifSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* @silent:storage — the setting simply does not persist on this device. */
  }
}

function ctx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    type Ctor = typeof AudioContext;
    const C: Ctor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!C) return null;
    audioCtx = new C();
  } catch {
    /* @silent:teardown — no AudioContext (jsdom, a locked-down enterprise
       profile). Every caller treats null as "no sound" and carries on. */
    return null;
  }
  return audioCtx;
}

/** Resume the shared context. Safe to call repeatedly and from any gesture. */
export function unlockAudio(): void {
  const ac = ctx();
  if (ac && ac.state === "suspended") {
    void ac.resume().catch(() => {
      /* @silent:teardown — resume outside a gesture never settles; the next
         gesture rebinds. isAudioBlocked() reports the truth meanwhile. */
    });
  }
}

/** True when a notification would currently be silent because the browser has
 *  not seen a gesture yet. The honest answer, so a caller can offer a fix. */
export function isAudioBlocked(): boolean {
  if (typeof window === "undefined") return true;
  if (!audioCtx) return false; // not built yet; the first play will build it
  return audioCtx.state === "suspended";
}

const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;
function bindUnlock(): void {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;
  const handler = () => {
    unlockAudio();
    for (const evt of UNLOCK_EVENTS) {
      window.removeEventListener(evt, handler, true);
    }
  };
  for (const evt of UNLOCK_EVENTS) {
    window.addEventListener(evt, handler, { capture: true, passive: true });
  }
}
bindUnlock();

/** One sine tone with a short attack and an exponential release. Exponential
 *  rather than linear because a linear fade to zero clicks audibly, and a click
 *  on every notification is what makes people turn sound off. */
function tone(
  ac: AudioContext,
  freq: number,
  start: number,
  duration: number,
  gain: number,
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  const t0 = ac.currentTime + start;
  // exponentialRamp cannot reach or start from 0 — hence 0.0001, not 0.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/**
 * Which sound, if any.
 *
 * Only an INTERRUPT notification makes a noise at all — that decision is the
 * server's and the user's, not this module's (see
 * packages/shared/rules/notification-interrupt.js). Within that, HIGH gets a
 * three-note descending figure that reads as "deal with this" and NORMAL gets a
 * two-tone rise that reads as "something arrived".
 */
export function tierFor(n: {
  interrupt?: boolean | null;
  priority?: string | null;
}): Tier {
  if (!n.interrupt) return "silent";
  return String(n.priority || "").toUpperCase() === "HIGH" ? "urgent" : "alert";
}

export function playNotifSound(tier: Tier): void {
  if (tier === "silent" || !isNotifSoundEnabled()) return;
  const ac = ctx();
  if (!ac) return;
  if (ac.state === "suspended") {
    void ac.resume().catch(() => {
      /* @silent:teardown — see unlockAudio. */
    });
  }
  try {
    if (tier === "ring") {
      // The telephone ring, synthesised (FN-2): a two-note "ding" and a held
      // "dong", repeated by the caller's interval (comms-live, 2.5 s). Louder
      // than the notification blips on purpose — a ring is a phone, and a
      // phone must be heard across a yard.
      tone(ac, 660, 0, 0.18, 0.2);
      tone(ac, 660, 0.22, 0.18, 0.2);
      tone(ac, 520, 0.5, 0.42, 0.2);
    } else if (tier === "urgent") {
      tone(ac, 1047, 0, 0.14, 0.14);
      tone(ac, 880, 0.15, 0.14, 0.12);
      tone(ac, 698, 0.3, 0.2, 0.1);
    } else {
      tone(ac, 880, 0, 0.09, 0.12);
      tone(ac, 1318.5, 0.09, 0.16, 0.1);
    }
  } catch {
    /* @silent:teardown — an oscillator throws on a context torn down
       mid-navigation. The sound is lost; the notification is not. */
  }
}

/**
 * Play at most once per notification, and never two within a second.
 *
 * Both halves are needed. The id guard stops a reconnect that replays events
 * from chiming twice for one thing; the global cooldown stops a batch — a mail
 * sync landing eight notifications at once — from becoming eight overlapping
 * tones, which is noise rather than information.
 *
 * The seen-set is bounded. An unbounded Set here is a slow leak in a tab that
 * stays open for a working week, which is exactly how this app is used.
 */
const played = new Set<string>();
const SEEN_CAP = 500;
let lastPlayed = 0;

export function playOnce(tier: Tier, id: string): void {
  if (tier === "silent") return;
  if (id && played.has(id)) return;
  const now = Date.now();
  if (now - lastPlayed < 1000) return;
  if (id) {
    if (played.size >= SEEN_CAP) played.delete(played.values().next().value as string);
    played.add(id);
  }
  lastPlayed = now;
  playNotifSound(tier);
}
