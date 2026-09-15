import * as React from "react";

/**
 * The motion primitives — scroll scrubbing, pointer-as-light, device tilt and
 * proximity.
 *
 * ── THEY WRITE CSS CUSTOM PROPERTIES, NEVER REACT STATE ────────────────────
 *
 * This is the single most important thing in this file. A scroll scrub that
 * calls `setState` re-renders its subtree sixty times a second; on the
 * mid-range Android this app exists for, that is a dropped-frame machine and it
 * gets worse the more of the page is inside the component. Writing
 * `element.style.setProperty("--p", …)` skips React entirely and lands on the
 * compositor.
 *
 * So every hook here returns a ref to attach and nothing else. What moves is
 * declared in CSS, against a custom property. If you find yourself wanting the
 * numeric value in JSX, you want a different component, not a different hook.
 *
 * ── REDUCED MOTION IS THE SETTLED STATE, NOT A FASTER ONE ──────────────────
 *
 * `prefers-reduced-motion: reduce` means every hook here attaches no listener
 * at all and leaves its custom properties at their resting values (declared in
 * index.css, so a component reads sane numbers before any input and forever
 * after). Somebody who asked their system for less motion has not asked for
 * quicker motion. `Reveal` set this precedent and it is not negotiable —
 * `scripts/check-motion.mjs` asserts the umbrella still exists.
 *
 * ── ONE OBSERVER, ONE FRAME LOOP ───────────────────────────────────────────
 *
 * `useScrollScrub` shares a single scroll/resize listener and a single
 * `requestAnimationFrame` across every subscriber on the page, for the reason
 * `reveal.tsx` gives about IntersectionObserver: thirty listeners is thirty
 * callbacks per frame, one listener with thirty subscribers is one. Layout is
 * read once per frame for all of them, then written once — never interleaved,
 * which is what causes forced synchronous layout.
 */

/** Read once. It cannot change without a reload in practice, and reading it per
 *  element is a matchMedia call per element. */
const prefersReduced = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/* ── the shared scroll loop ─────────────────────────────────────────────────*/

type ScrubEntry = {
  el: HTMLElement;
  start: number;
  end: number;
  prop: string;
};

const scrubbers = new Set<ScrubEntry>();
let frame = 0;
let listening = false;

/**
 * One pass: measure everything, then write everything.
 *
 * The two loops are deliberately not one loop. Interleaving a
 * `getBoundingClientRect()` read with a `style.setProperty()` write forces the
 * browser to flush layout on every iteration — the classic layout thrash, and
 * it is invisible in review because it only shows up as jank with enough
 * subscribers on the page.
 */
function pass() {
  frame = 0;
  const vh = window.innerHeight || 1;
  const measured: Array<[ScrubEntry, number]> = [];
  for (const entry of scrubbers) {
    const rect = entry.el.getBoundingClientRect();
    // Progress of the element's travel: 0 when its top edge reaches `start` of
    // the viewport height, 1 when its bottom edge passes `end`.
    const span = rect.height + vh * (entry.start - entry.end);
    const travelled = vh * entry.start - rect.top;
    measured.push([entry, span <= 0 ? 0 : clamp01(travelled / span)]);
  }
  for (const [entry, value] of measured) {
    entry.el.style.setProperty(entry.prop, value.toFixed(4));
  }
}

const schedule = () => {
  if (!frame) frame = requestAnimationFrame(pass);
};

function subscribe(entry: ScrubEntry): () => void {
  scrubbers.add(entry);
  if (!listening) {
    listening = true;
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
  }
  schedule();
  return () => {
    scrubbers.delete(entry);
    entry.el.style.removeProperty(entry.prop);
    if (scrubbers.size === 0 && listening) {
      listening = false;
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

/**
 * Drive a custom property from an element's travel through the viewport.
 *
 * `start` and `end` are fractions of the viewport height: the default (1 → 0)
 * means "begins when the element's top touches the bottom of the screen, ends
 * when its bottom leaves the top". Narrow them for a scrub that should complete
 * while the element is still comfortably on screen.
 *
 * Under reduced motion the property is set ONCE to `settled` and no listener is
 * attached — the animation's end state, rendered immediately.
 */
export function useScrollScrub<T extends HTMLElement>(options?: {
  start?: number;
  end?: number;
  prop?: string;
  settled?: number;
}): React.RefObject<T> {
  const ref = React.useRef<T | null>(null);
  const start = options?.start ?? 1;
  const end = options?.end ?? 0;
  const prop = options?.prop ?? "--scrub";
  const settled = options?.settled ?? 1;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (prefersReduced()) {
      el.style.setProperty(prop, String(settled));
      return () => el.style.removeProperty(prop);
    }
    return subscribe({ el, start, end, prop });
  }, [start, end, prop, settled]);

  return ref as React.RefObject<T>;
}

/* ── pointer as a light source ──────────────────────────────────────────────*/

/**
 * Write `--lx` / `--ly` (0…1) from the pointer's position inside the element.
 *
 * THIS IS THE "GAZE" MECHANISM. Q5 settled that this product will never ask for
 * a camera: a permission prompt on a freight site, on a tenant's own domain, in
 * front of a procurement officer checking a bill of lading, costs trust that no
 * effect earns back. On a desktop the cursor already IS attention — people move
 * the pointer toward what they are looking at — so lighting a scene from the
 * pointer delivers what gaze tracking promises, for nothing, with no prompt and
 * no WASM.
 *
 * Idles back to centre after `idleMs` of stillness, so a page left alone
 * settles into its designed composition rather than freezing mid-gesture with
 * the light stuck in a corner.
 *
 * Coarse pointers are skipped entirely — a touch device has no hover, and
 * `useTilt` is the equivalent there.
 */
export function usePointerLight<T extends HTMLElement>(options?: {
  idleMs?: number;
}): React.RefObject<T> {
  const ref = React.useRef<T | null>(null);
  const idleMs = options?.idleMs ?? 2000;

  React.useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return undefined;
    if (
      typeof window.matchMedia === "function" &&
      !window.matchMedia("(pointer: fine)").matches
    ) {
      return undefined;
    }

    let raf = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let next: { x: number; y: number } | null = null;

    const write = () => {
      raf = 0;
      if (!next) return;
      el.style.setProperty("--lx", next.x.toFixed(4));
      el.style.setProperty("--ly", next.y.toFixed(4));
    };

    const recentre = () => {
      next = { x: 0.5, y: 0.5 };
      if (!raf) raf = requestAnimationFrame(write);
    };

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      next = {
        x: clamp01((event.clientX - rect.left) / rect.width),
        y: clamp01((event.clientY - rect.top) / rect.height),
      };
      if (!raf) raf = requestAnimationFrame(write);
      if (idle) clearTimeout(idle);
      idle = setTimeout(recentre, idleMs);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (idle) clearTimeout(idle);
      if (raf) cancelAnimationFrame(raf);
      el.style.removeProperty("--lx");
      el.style.removeProperty("--ly");
    };
  }, [idleMs]);

  return ref as React.RefObject<T>;
}

/* ── device tilt ────────────────────────────────────────────────────────────*/

/**
 * The mobile counterpart of `usePointerLight`: the gyroscope writes the same
 * `--lx` / `--ly` contract, so a component consumes ONE interface and does not
 * care which input it came from.
 *
 * ── THE iOS PERMISSION, AND WHY IT IS NOT REQUESTED HERE ───────────────────
 *
 * Android Chrome fires `deviceorientation` with no permission at all. iOS 13+
 * requires `DeviceOrientationEvent.requestPermission()`, which must be called
 * from a USER GESTURE and shows a system prompt. So this hook never requests:
 * it attaches if permission is already granted, and otherwise reports
 * `needsPermission` so a component can offer an explicit affordance the visitor
 * chooses to press. A permission dialog nobody asked for is the thing Q5 ruled
 * out, and it does not become acceptable because the sensor is cheaper than a
 * camera.
 *
 * `enable()` is what that affordance calls.
 */
type TiltState = { needsPermission: boolean; active: boolean };

type OrientationEventCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function useTilt<T extends HTMLElement>(options?: { max?: number }): {
  ref: React.RefObject<T>;
  state: TiltState;
  enable: () => void;
} {
  const ref = React.useRef<T | null>(null);
  const max = options?.max ?? 22;
  const [state, setState] = React.useState<TiltState>({
    needsPermission: false,
    active: false,
  });
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return undefined;
    if (typeof window.DeviceOrientationEvent === "undefined") return undefined;

    const ctor = window.DeviceOrientationEvent as OrientationEventCtor;
    // iOS gates the sensor behind a gesture-initiated prompt. Report it and
    // wait to be asked; never prompt on mount.
    if (typeof ctor.requestPermission === "function" && !armed) {
      setState({ needsPermission: true, active: false });
      return undefined;
    }

    let raf = 0;
    let next: { x: number; y: number } | null = null;
    const write = () => {
      raf = 0;
      if (!next) return;
      el.style.setProperty("--lx", next.x.toFixed(4));
      el.style.setProperty("--ly", next.y.toFixed(4));
    };

    const onOrient = (event: DeviceOrientationEvent) => {
      // gamma is left/right tilt, beta front/back. Both are mapped through the
      // same 0…1 contract the pointer writes, clamped so a phone held at a
      // steep angle pins rather than wraps.
      const gamma = event.gamma ?? 0;
      const beta = event.beta ?? 0;
      next = {
        x: clamp01(0.5 + gamma / (max * 2)),
        y: clamp01(0.5 + (beta - 45) / (max * 2)),
      };
      if (!raf) raf = requestAnimationFrame(write);
    };

    window.addEventListener("deviceorientation", onOrient, { passive: true });
    setState({ needsPermission: false, active: true });
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      if (raf) cancelAnimationFrame(raf);
      el.style.removeProperty("--lx");
      el.style.removeProperty("--ly");
    };
  }, [max, armed]);

  const enable = React.useCallback(() => {
    const ctor = window.DeviceOrientationEvent as OrientationEventCtor | undefined;
    if (ctor && typeof ctor.requestPermission === "function") {
      // Called from a click handler, which is the only context iOS accepts.
      ctor
        .requestPermission()
        .then((result) => {
          if (result === "granted") setArmed(true);
          else setState({ needsPermission: false, active: false });
        })
        .catch(() => setState({ needsPermission: false, active: false }));
      return;
    }
    setArmed(true);
  }, []);

  return { ref: ref as React.RefObject<T>, state, enable };
}

/* ── proximity ──────────────────────────────────────────────────────────────*/

/**
 * Write `--near` (0…1) as the pointer APPROACHES an element, rather than when
 * it arrives on it.
 *
 * Hover is binary and it is late: by the time it fires, the person has already
 * committed. Responding to approach is what makes an interface feel like it
 * noticed you, and it is most of the difference between a page that feels alive
 * and one that feels like a document with `:hover` rules.
 */
export function useProximity<T extends HTMLElement>(options?: {
  radius?: number;
}): React.RefObject<T> {
  const ref = React.useRef<T | null>(null);
  const radius = options?.radius ?? 320;

  React.useEffect(() => {
    const el = ref.current;
    if (!el || prefersReduced()) return undefined;
    if (
      typeof window.matchMedia === "function" &&
      !window.matchMedia("(pointer: fine)").matches
    ) {
      return undefined;
    }

    let raf = 0;
    let value = 0;
    const write = () => {
      raf = 0;
      el.style.setProperty("--near", value.toFixed(4));
    };

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      // Distance to the element's nearest edge, not to its centre: a wide card
      // measured from its centre reports "far" while the pointer is sitting on
      // its corner.
      const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
      const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
      const distance = Math.hypot(dx, dy);
      value = clamp01(1 - distance / radius);
      if (!raf) raf = requestAnimationFrame(write);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
      el.style.removeProperty("--near");
    };
  }, [radius]);

  return ref as React.RefObject<T>;
}

/** Exported for tests and for components that need to branch structurally
 *  rather than stylistically (rendering a static image instead of a canvas,
 *  say) — which is a different decision from "animate less". */
export const motionReduced = prefersReduced;
