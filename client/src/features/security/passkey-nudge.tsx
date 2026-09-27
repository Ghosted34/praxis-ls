/**
 * "You have no passkey yet" — the standing half of passkey adoption.
 *
 * The sign-in step (login-modal) is the loud half: it interrupts once, right
 * after someone proves who they are, and offers the ceremony on the spot. This
 * is the quiet half, for the much larger group that interrupt cannot reach —
 * anyone who said "Not now", anyone already signed in when the feature
 * shipped, and anyone whose credential list was unreachable at the time.
 *
 * It POINTS rather than performs. The interrupt already offers the one-click
 * path; what someone who skipped it actually lacks is knowing where the
 * setting lives, and a second button that does the ceremony teaches them
 * nothing. So it names the route in words AND navigates there and highlights
 * the card — after which they can find it again unaided, which a modal that
 * did it for them never achieves.
 *
 * ── WHY IT SITS IN THE FLOW, NOT IN A CORNER ─────────────────────────────────
 *
 * `AccessBanner` floats bottom-right and argues well for it: a transient,
 * mid-task notice must not reflow the table under it. This is the opposite
 * kind of message — standing, not transient — and that corner is already
 * spoken for twice over: the floating action cluster anchors at
 * `bottom-[max(6rem,var(--fab-floor,0px))] right-5`, and the access banner at
 * `bottom-4 right-4`. A permanent third occupant would cover the cluster on
 * every phone, for as long as the user ignored it.
 *
 * On the dashboard it is seen on arrival — which is the moment just after
 * sign-in the request was about — and it pushes nothing around mid-task,
 * because arriving IS the task.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/app/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { XIcon } from "@/components/ui/icons";
import { passkeyOfferStore } from "@/lib/passkey-offer";
import { passkeyDeviceStore } from "@/lib/passkey-devices";
import { isPasskeySupported, platformAuthenticatorAvailable } from "@/lib/webauthn";

/** Where the setting lives, spelled the way the navigation spells it. */
export const PASSKEY_SETTING_PATH = "Configure → Security & access → My security";

/** The deep link the button follows; my-security reads `highlight`. */
export const PASSKEY_SETTING_LINK = "/security/my-security?highlight=passkey";

export function PasskeyNudge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const email = (user?.email || "").trim().toLowerCase();

  // null = not yet known. The nudge stays invisible until the answer is in, so
  // it never flashes at someone who already has a passkey.
  const [show, setShow] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let alive = true;
    if (!email || !isPasskeySupported() || passkeyOfferStore.nudgeDismissed(email)) {
      setShow(false);
      return;
    }
    // PER DEVICE, not per account: the owner's rule is that every device has
    // its own passkey — the laptop's on the laptop, the phone's on the phone —
    // so a passkey on the phone is no reason to stop suggesting one here. And
    // only where this device has an authenticator of its own to hold one.
    void (async () => {
      const [probe] = await Promise.allSettled([platformAuthenticatorAvailable()]);
      const canHold = probe.status === "fulfilled" && probe.value === true;
      if (alive) setShow(canHold && !passkeyDeviceStore.get(email));
    })();
    return () => {
      alive = false;
    };
  }, [email]);

  if (!show) return null;

  return (
    <div className="mb-4">
      <Callout tone="info" title="Unlock with one touch instead">
        <div className="flex flex-col gap-3">
          <p>
            This device has no passkey yet. Your session locks every two hours — set one up and
            getting back in is a single touch of Face ID, Touch ID or Windows Hello. Nothing to
            type, so nothing to phish. It lives under <strong>{PASSKEY_SETTING_PATH}</strong>.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => navigate(PASSKEY_SETTING_LINK)}>
              Show me where
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                passkeyOfferStore.dismissNudge(email);
                setShow(false);
              }}
            >
              <XIcon width={14} height={14} />
              Dismiss
            </Button>
          </div>
        </div>
      </Callout>
    </div>
  );
}

export default PasskeyNudge;
