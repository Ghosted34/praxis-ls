/**
 * An authenticated blob URL, fetched once and revoked on unmount.
 *
 * Chat attachments are membership-gated, so their bytes arrive through a normal
 * API call with a Bearer token rather than through an `src` attribute (see
 * `fetchObjectUrl`). That leaves the caller holding an object URL, and an
 * object URL that is never revoked pins the entire blob in memory for the life
 * of the document — a thread somebody scrolls through all day would accumulate
 * every photo it ever rendered.
 *
 * `lazy` defers the fetch until the element is near the viewport. A channel
 * with two hundred photos in its history must not fetch two hundred photos to
 * draw the last ten, and `loading="lazy"` cannot help here because the fetch is
 * ours rather than the browser's.
 */
import * as React from "react";

type State = { url: string | null; loading: boolean; error: boolean };

export function useObjectUrl(
  fetcher: ((signal: AbortSignal) => Promise<string>) | null,
  { enabled = true }: { enabled?: boolean } = {},
): State {
  const [state, setState] = React.useState<State>({ url: null, loading: false, error: false });

  // The fetcher is captured per-run rather than per-render so a call site is
  // not forced to memoise an inline arrow to avoid re-fetching on every
  // keystroke in the composer above it.
  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  // Identity for the effect: re-fetch when the thing being fetched changes,
  // not when the function that fetches it is re-created.
  const active = enabled && !!fetcher;

  React.useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    let url: string | null = null;
    let alive = true;
    setState({ url: null, loading: true, error: false });
    fetcherRef
      .current!(controller.signal)
      .then((u) => {
        url = u;
        if (alive) setState({ url: u, loading: false, error: false });
        // Unmounted between the fetch resolving and this line: revoke now,
        // because no cleanup will run for a state that was never set.
        else URL.revokeObjectURL(u);
      })
      .catch(() => {
        if (alive) setState({ url: null, loading: false, error: true });
      });
    return () => {
      alive = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [active]);

  return state;
}

/**
 * True once the element has been near the viewport at least once.
 *
 * Sticky rather than live: an image that scrolls back out must not drop its
 * bytes and re-fetch on the way back in. The margin is generous so the fetch
 * starts before the bubble is actually visible, which is the difference between
 * a photo that is there when you reach it and one that fades in after.
 */
export function useNearViewport<T extends HTMLElement>(): [React.RefObject<T>, boolean] {
  const ref = React.useRef<T>(null);
  const [near, setNear] = React.useState(false);

  React.useEffect(() => {
    if (near) return undefined;
    const el = ref.current;
    // No IntersectionObserver (jsdom, an old webview): render everything rather
    // than nothing. Degrading to eager is the safe direction.
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  return [ref, near];
}
