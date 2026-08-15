/**
 * Boot-splash preview — the real `SplashScreen`, in a phone frame, running the
 * boot sequence on demand.
 *
 * It renders the ACTUAL component (not a mock-up of it) with `variant="preview"`,
 * and drives it through the states BootGate does: identity hidden until
 * "branding loads", then revealed with the chosen animation while the progress
 * bar eases up and fills. Replaying remounts it, which is what restarts the CSS
 * animations — there is no way to rewind a running `animation` without doing
 * that, and a preview you can only watch once is not much of a preview.
 *
 * IT DOES NOT PLAY THE FADE-OUT. The real splash lifts as soon as boot finishes;
 * reproducing that here would leave the preview resting on an empty app skeleton,
 * so the tenant would spend the whole session looking at the one frame that is
 * not their design. It plays in, then holds. Boot is simulated at a fixed 900ms
 * for the same reason: the subject is the design, not the network.
 */
import * as React from "react";
import { SplashScreen } from "@/components/splash-screen";
import { PhoneFrame } from "./previews";
import { Button } from "@/components/ui/button";
import type { EffectivePwa } from "@/lib/pwa-config";

const SIMULATED_BOOT_MS = 900;

export function SplashPreview({ cfg }: { cfg: EffectivePwa }) {
  // Bumping the key remounts the splash, restarting every CSS animation.
  const [run, setRun] = React.useState(0);
  return (
    <div className="flex flex-col items-center gap-3">
      <PhoneFrame caption="Boot splash">
        <SplashRun key={run} cfg={cfg} />
      </PhoneFrame>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRun((n) => n + 1)}
      >
        Replay
      </Button>
    </div>
  );
}

function SplashRun({ cfg }: { cfg: EffectivePwa }) {
  const [ready, setReady] = React.useState(false);
  const [progress, setProgress] = React.useState(15);

  React.useEffect(() => {
    const tick = window.setInterval(() => {
      setProgress((p) => (p < 90 ? p + Math.max(0.5, (90 - p) * 0.08) : p));
    }, 120);
    const boot = window.setTimeout(() => {
      setReady(true);
      setProgress(100);
    }, SIMULATED_BOOT_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(boot);
    };
  }, []);

  return (
    <SplashScreen
      cfg={cfg}
      ready={ready}
      progress={progress}
      fading={false}
      variant="preview"
    />
  );
}
