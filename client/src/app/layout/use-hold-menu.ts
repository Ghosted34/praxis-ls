/**
 * Press for the obvious thing; hold — or right-click — for the list.
 *
 * The gesture the rail's navigation controls share: a plain click does the one
 * action the control is named for, and holding it opens the menu of everything
 * else that direction leads to. It is the browser toolbar's own back-button
 * idiom, and it is what lets twelve steps back be one gesture instead of twelve
 * clicks.
 *
 * EXTRACTED BECAUSE THERE ARE NOW THREE OF THEM. Back and forward had this
 * logic inline in `nav-arrows.tsx`; refresh needs exactly the same gesture for
 * exactly the same reason (`nav-refresh.tsx`). None of it is obvious code — the
 * `held` latch below is the difference between "hold opens the menu" and "hold
 * opens the menu AND navigates" — so a second hand-copied version is a second
 * place for that bug to come back.
 */
import * as React from "react";

/** How long a press becomes a hold. 450ms is the platform convention for a
 *  long-press menu — short enough to discover by accident, long enough that a
 *  deliberate click never trips it. */
export const HOLD_MS = 450;

export type HoldMenu = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Spread onto the button. */
  handlers: {
    onClick: () => void;
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
  };
};

/**
 * @param hasMenu   Whether holding has anything to show. False leaves the
 *                  control a plain button — a menu with no rows is worse than
 *                  no menu, because it makes the gesture look broken.
 * @param onActivate What a plain click does. Called only for clicks that are
 *                  not the tail end of a hold.
 */
export function useHoldMenu(
  hasMenu: boolean,
  onActivate: () => void,
): HoldMenu {
  const [open, setOpen] = React.useState(false);
  const holdTimer = React.useRef<number | null>(null);
  // Set the moment a hold fires, so the pointerup that follows is not also
  // treated as a click. Without it, holding would open the menu and act.
  const held = React.useRef(false);

  const clearHold = React.useCallback(() => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  React.useEffect(() => clearHold, [clearHold]);

  const startHold = React.useCallback(
    (e: React.PointerEvent) => {
      // Primary button only — a right-click has its own path below, and a
      // middle-click should do nothing at all.
      if (e.button !== 0 || !hasMenu) return;
      held.current = false;
      clearHold();
      holdTimer.current = window.setTimeout(() => {
        held.current = true;
        setOpen(true);
      }, HOLD_MS);
    },
    [hasMenu, clearHold],
  );

  const onClick = React.useCallback(() => {
    // The click that ends a hold is the hold, not an activation.
    if (held.current) {
      held.current = false;
      return;
    }
    onActivate();
  }, [onActivate]);

  const onContextMenu = React.useCallback(
    (e: React.MouseEvent) => {
      if (!hasMenu) return;
      e.preventDefault();
      setOpen(true);
    },
    [hasMenu],
  );

  return {
    open,
    setOpen,
    handlers: {
      onClick,
      onPointerDown: startHold,
      onPointerUp: clearHold,
      onPointerLeave: clearHold,
      onPointerCancel: clearHold,
      onContextMenu,
    },
  };
}
