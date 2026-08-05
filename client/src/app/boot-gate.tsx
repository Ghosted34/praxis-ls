/**
 * Boot gate — shows the branded SplashScreen during boot, then fades it out. The
 * splash stays up until BOTH boot steps finish: BrandingProvider fetching the
 * tenant's colour/logo/name, and AuthProvider restoring the session. Crucially
 * the splash shows NO name/logo/colour until branding is `ready` (see
 * SplashScreen) — so the default "Praxis LS" never flashes before the tenant's
 * own branding; the splash just reveals the tenant identity once it's loaded.
 * Because the splash covers the app the whole time, the login underneath is
 * already correctly branded when the splash lifts. bootSignal fires on unmount
 * so the login only autofocuses once the splash is gone.
 */
import * as React from "react";
import { useAuth } from "@/app/auth/auth-context";
import { useBranding } from "@/app/branding/branding-context";
import { SplashScreen } from "@/components/splash-screen";
import { bootSignal } from "@/lib/boot-signal";

const FADE_MS = 400;

export function BootGate({ children }: { children: React.ReactNode }) {
  const { ready: brandingReady, pwa } = useBranding();
  const { status } = useAuth();
  const bootDone = brandingReady && status !== "loading";

  // How long the splash stays up at minimum, so it doesn't flicker on a warm
  // cache. Tenant-configurable (Settings › App & PWA › Splash) because it is the
  // difference between "the app blinked" and "the app introduced itself" — and
  // because a tenant who wants NO splash sets 0 and gets straight to work. It is
  // wall time, not motion: the animations themselves are fixed by their preset.
  const MIN_MS = pwa.splashEnabled ? pwa.splashDuration : 0;

  const [mounted, setMounted] = React.useState(true);
  const [fading, setFading] = React.useState(false);
  const [progress, setProgress] = React.useState(15);
  const startRef = React.useRef(Date.now());

  // Ease the bar up to ~90% while booting.
  React.useEffect(() => {
    if (bootDone) return;
    const id = window.setInterval(() => {
      setProgress((p) => (p < 90 ? p + Math.max(0.5, (90 - p) * 0.08) : p));
    }, 120);
    return () => window.clearInterval(id);
  }, [bootDone]);

  // On completion: fill, honour the minimum, fade, unmount. With the splash
  // turned off there is nothing to fade, so the boot signal fires immediately
  // rather than making the login wait 400ms to autofocus for an invisible
  // element's benefit.
  React.useEffect(() => {
    if (!bootDone) return;
    setProgress(100);
    const fadeMs = pwa.splashEnabled ? FADE_MS : 0;
    const wait = Math.max(0, MIN_MS - (Date.now() - startRef.current));
    const t1 = window.setTimeout(() => setFading(true), wait);
    const t2 = window.setTimeout(() => {
      setMounted(false);
      bootSignal.markDone();
    }, wait + fadeMs);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [bootDone, MIN_MS, pwa.splashEnabled]);

  return (
    <>
      {children}
      {mounted && pwa.splashEnabled && (
        <SplashScreen cfg={pwa} ready={brandingReady} progress={progress} fading={fading} />
      )}
    </>
  );
}
