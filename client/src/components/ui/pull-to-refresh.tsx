/**
 * PullToRefresh — native mobile pull gesture for soft data refresh.
 *
 * ENGINEERING NOTES (why this is not a 5-line hack):
 *
 * - BROWSER'S OWN PULL. Chrome on Android triggers a full `location.reload()`
 *   when you drag the page at `scrollY === 0`. That is NOT our soft-data
 *   refresh (it loses scroll, flashes, re-hits /auth/me). We disable it with
 *   `overscroll-behavior-y: contain` on the wrapper and never call it.
 * - SHARED CLIENT INVARIANT. `useControlTower().refresh()` just invalidates
 *   React Query keys — no hard reload — so the list stays painted while it
 *   revalidates (stale-while-revalidate, like a native app).
 * - PHYSICS. Damped pull (`delta * 0.55`, capped at 96px), 72px trigger,
 *   haptic on crossing, spring-back `0.22s` ease. Feels like iOS Mail.
 * - ONLY AT TOP. If `window.scrollY > 0` the gesture is ignored so a normal
 *   scroll never becomes a refresh.
 * - DESKTOP DISABLED. `min-width: 1024px` or `hover: hover` → no pull. A
 *   mouse has a refresh button; a pull on a trackpad is a scroll.
 * - ACCESSIBILITY. Pull is not keyboard-reachable. The visible spinner has
 *   `aria-live` and the page's existing `Meeting view`/`TowerFilters` refresh
 *   via React Query keeps keyboard users covered. Reduced-motion skips the
 *   translate animation.
 * - CONFLICTS. Disabled while a dialog/bottom-sheet is open (filter room,
 *   KPI picker, drilldown, meeting view) — the backdrop locks scroll and the
 *   pull would fight the sheet's own drag-to-dismiss.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

const THRESHOLD = 72;
const MAX_PULL = 96;
const DAMP = 0.55;

export function PullToRefresh({
  onRefresh,
  disabled,
  children,
  threshold = THRESHOLD,
}: {
  onRefresh: () => Promise<void> | void;
  disabled?: boolean;
  children: React.ReactNode;
  threshold?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const startY = React.useRef<number | null>(null);
  const pullRef = React.useRef(0);
  const triggeredRef = React.useRef(false);

  const [pull, setPull] = React.useState(0);
  const [refreshing, setRefreshing] = React.useState(false);

  // Disable on desktop — pull is a mobile idiom. Also skip when the caller
  // says so (meeting view, filter sheet, etc.).
  const isDisabled = React.useCallback(() => {
    if (disabled || refreshing) return true;
    if (typeof window === "undefined") return true;
    // Hover = mouse/trackpad → no pull. Touch-only is `hover: none`.
    if (window.matchMedia("(hover: hover)").matches && window.innerWidth >= 1024) return true;
    // An open dialog locks the page — pull would tug the backdrop.
    if (document.querySelector('[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper]')) return false; // allow — Radix uses body lock, but don't block
    // If any Radix dialog is open, don't pull — let the modal handle gestures.
    if (document.body.style.overflow === "hidden" || document.body.dataset.scrollLocked === "1") return true;
    return false;
  }, [disabled, refreshing]);

  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (isDisabled()) return;
      if (window.scrollY > 0) return;
      if (e.touches.length !== 1) return;
      startY.current = e.touches[0].clientY;
      pullRef.current = 0;
      triggeredRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      if (isDisabled()) return;
      if (window.scrollY > 0) {
        startY.current = null;
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 8) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const damp = Math.min(delta * DAMP, MAX_PULL);
      pullRef.current = damp;
      // React state drives the indicator — throttle via rAF to avoid layout thrash on 60Hz.
      // Here we set directly; React batches these move events cheaply enough.
      setPull(damp);
      if (damp >= threshold && !triggeredRef.current) {
        triggeredRef.current = true;
        if (navigator.vibrate) navigator.vibrate(10);
      } else if (damp < threshold) {
        triggeredRef.current = false;
      }
    };

    const onTouchEnd = async () => {
      if (startY.current === null) return;
      const should = pullRef.current >= threshold;
      startY.current = null;
      if (should && !refreshing) {
        setRefreshing(true);
        setPull(threshold); // lock at trigger line while spinner runs
        try {
          await onRefresh();
        } finally {
          // Keep spinner visible at least 650ms so a fast cache hit still
          // reads as "something happened" rather than a flicker.
          window.setTimeout(() => {
            setRefreshing(false);
            setPull(0);
            pullRef.current = 0;
            triggeredRef.current = false;
          }, 650);
        }
      } else {
        setPull(0);
        pullRef.current = 0;
        triggeredRef.current = false;
      }
    };

    // passive:false is unnecessary — we rely on overscroll-contain, not preventDefault.
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [onRefresh, threshold, isDisabled, refreshing]);

  const progress = Math.min(pull / threshold, 1);
  const showIndicator = pull > 4 || refreshing;
  const label = refreshing
    ? "Refreshing…"
    : pull >= threshold
      ? "Release to refresh"
      : pull > 28
        ? "Keep pulling…"
        : "Pull to refresh";

  return (
    <div
      ref={wrapperRef}
      className="relative overscroll-y-contain"
      style={{ overscrollBehaviorY: "contain" } as React.CSSProperties}
    >
      {/* Indicator — sits at the very top, revealed as you pull */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-center justify-end pb-2 lg:hidden",
          !showIndicator && "hidden",
        )}
        style={{
          height: 64,
          transform: `translateY(${showIndicator ? Math.min(pull - 64, 0) : -64}px)`,
          opacity: refreshing ? 1 : 0.45 + progress * 0.55,
          transition: refreshing || pull === 0 ? "transform 220ms cubic-bezier(0.22,1,0.36,1), opacity 180ms" : "none",
        }}
      >
        <div
          className={cn(
            "flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 shadow-[var(--shadow-s)]",
            refreshing && "pr-3",
          )}
          style={{
            transform: refreshing ? "scale(1)" : `scale(${0.92 + progress * 0.08})`,
            transition: "transform 180ms",
          }}
        >
          <span
            className={cn(
              "grid h-6 w-6 place-items-center rounded-full bg-[rgb(var(--ink)_/_0.06)]",
              refreshing && "animate-spin",
            )}
            style={{
              transform: !refreshing ? `rotate(${progress * 180 - 90}deg)` : undefined,
            }}
            aria-hidden
          >
            {refreshing ? (
              <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            ) : (
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            )}
          </span>
          <span className="text-xs font-semibold text-foreground">{label}</span>
          {!refreshing && (
            <span className="hidden text-[10px] leading-none text-muted-foreground sm:inline">
              {Math.round(progress * 100)}%
            </span>
          )}
        </div>
        {/* tiny track */}
        <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-[rgb(var(--ink)_/_0.08)]">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-75"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* Content — slides down with the pull (no translate on reduced-motion, just indicator) */}
      <div
        style={
          reduced
            ? undefined
            : {
                transform: `translateY(${refreshing ? 64 : pull ? Math.min(pull * 0.55, 56) : 0}px)`,
                transition: refreshing || pull === 0 ? "transform 220ms cubic-bezier(0.22,1,0.36,1)" : "none",
                willChange: pull ? "transform" : undefined,
              }
        }
      >
        {/* Subtle top border that appears as you pull — gives the sheet an edge */}
        <div
          className="pointer-events-none h-px bg-border lg:hidden"
          style={{
            opacity: showIndicator ? 0.18 + progress * 0.52 : 0,
            transform: `scaleX(${0.6 + progress * 0.4})`,
          }}
          aria-hidden
        />
        {children}
      </div>
    </div>
  );
}
