/**
 * "Your access permissions have been updated." — the GRANT half of live
 * permission invalidation.
 *
 * THERE IS NO REVOCATION BANNER, AND THAT IS THE DESIGN. Losing a module is
 * handled in `shell-providers.tsx` by clearing the local cache and hard-
 * refreshing, immediately and without asking: a user must not keep interacting
 * with a view of something they are no longer authorised to see, and a banner
 * they can ignore is not a control. Gaining one is the opposite case — it can
 * expose nothing, so there is no clock running, and reloading to announce good
 * news would throw away whatever the user is halfway through typing. So the two
 * paths are not one path with a flag; they are different behaviours, and this
 * component only ever renders the harmless one.
 *
 * ── WHY IT FLOATS ────────────────────────────────────────────────────────────
 *
 * "Must not clutter the layout or push content around." A banner in the
 * document flow moves every row of the table under it down by its own height,
 * mid-task, for a message that is explicitly not urgent — the exact opposite of
 * "let them finish what they are typing". So it is `fixed`, like
 * `ActionErrorBanner` above it, and it takes no space at all.
 *
 * Bottom-right rather than top-centre because the top of this app is three
 * bands of chrome deep and the error banner already owns the space just under
 * it; two overlays racing for the same 4.5rem would be worse than either.
 *
 * `role="status"` / `aria-live="polite"` come from `Callout` — polite is right:
 * this interrupts nothing, which is the whole point of it existing.
 */
import { Callout } from "@/components/ui/callout";
import { XIcon } from "@/components/ui/icons";
import { useShell } from "./shell-context";

export function AccessBanner() {
  const { grantNotice, dismissGrantNotice } = useShell();
  if (!grantNotice) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[65] w-[min(26rem,calc(100vw-2rem))]">
      <Callout
        tone="info"
        className="pointer-events-auto bg-card shadow-[var(--shadow-l)]"
        action={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md px-2 py-1 text-xs font-semibold text-brand-blue-ink hover:underline"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={dismissGrantNotice}
              aria-label="Dismiss"
              className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <XIcon width={14} height={14} />
            </button>
          </div>
        }
      >
        Your access permissions have been updated. Reload to apply changes.
      </Callout>
    </div>
  );
}
